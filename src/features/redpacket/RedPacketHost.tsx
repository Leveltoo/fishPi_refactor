import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";

import { encodeRedPacketMessage, openRedPacket, readSelfSession, sendRedPacket } from "./api";
import {
  parseOpenEvent,
  parseResendEvent,
  parseSendEvent,
  publishOpenResult,
  REDPACKET_OPEN_EVENT,
  REDPACKET_RESEND_EVENT,
  REDPACKET_SEND_EVENT,
} from "./events";
import { OpenRedPacketDialog } from "./OpenRedPacketDialog";
import { SendRedPacketDialog } from "./SendRedPacketDialog";
import { validateSendForm, type SendFormValues } from "./sendForm";
import { resolveSenderGesture } from "./resultCopy";
import type { GestureIndex, OpenOutcome, OpenSession, SendRedPacketRequest, SendSession } from "./types";
import "./redpacket.css";

export function RedPacketHost() {
  const [selfUserName, setSelfUserName] = useState("");
  const [openSession, setOpenSession] = useState<OpenSession | null>(null);
  const [sendSession, setSendSession] = useState<SendSession | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [sendSubmitting, setSendSubmitting] = useState(false);
  const [openOutcome, setOpenOutcome] = useState<OpenOutcome | null>(null);
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [sendUncertain, setSendUncertain] = useState(false);
  const [openGesture, setOpenGesture] = useState<GestureIndex | undefined>();
  const viewGeneration = useRef(0);
  const busy = useRef(false);
  const sendVisible = useRef(false);
  const mounted = useRef(false);
  const unknownOpens = useRef(new Map<string, OpenOutcome>());
  const unknownSends = useRef(new Set<string>());

  function close() {
    viewGeneration.current += 1;
    sendVisible.current = false;
    setOpenSession(null);
    setSendSession(null);
    setOpenOutcome(null);
    setSendNotice(null);
  }

  async function claim(session: OpenSession, gesture?: GestureIndex) {
    if (busy.current || (session.packetType === "rockPaperScissors" &&
      !session.detailOnly && gesture === undefined)) {
      return;
    }
    const uncertain = unknownOpens.current.get(session.oId);
    if (uncertain) {
      setOpenOutcome(uncertain);
      return;
    }
    busy.current = true;
    const generation = viewGeneration.current;
    setOpenLoading(true);
    try {
      const outcome = await openRedPacket({ oId: session.oId, gesture });
      if (!mounted.current) return;
      if (outcome.status === "outcome_unknown") {
        unknownOpens.current.set(session.oId, outcome);
      }
      if (outcome.status === "ok") {
        if (session.packetType === "rockPaperScissors") {
          outcome.data.info.gesture = resolveSenderGesture(outcome.data, gesture, outcome.selfUserName);
        }
        publishOpenResult(session.oId, outcome.data);
        setSelfUserName(outcome.selfUserName);
      }
      if (generation !== viewGeneration.current) return;
      setOpenOutcome(outcome);
      if (outcome.status === "outcome_unknown") toast.warning(outcome.message);
      else if (outcome.status !== "ok") toast.error(outcome.message);
    } finally {
      busy.current = false;
      if (mounted.current) setOpenLoading(false);
    }
  }

  async function send(request: SendRedPacketRequest, direct: boolean) {
    if (busy.current) return;
    // 随机猜拳手势不能绕过同一笔不确定发送的保护。
    const key = encodeRedPacketMessage({ ...request, gesture: undefined });
    if (unknownSends.current.has(key)) {
      const notice = "上次发送结果待确认，请先在聊天室核对，勿重复提交。";
      if (!direct) {
        setSendNotice(notice);
        setSendUncertain(true);
      }
      toast.warning(notice);
      return;
    }
    busy.current = true;
    const generation = viewGeneration.current;
    setSendSubmitting(true);
    setSendNotice(null);
    try {
      const outcome = await sendRedPacket(request);
      if (!mounted.current) return;
      if (outcome.status === "outcome_unknown") unknownSends.current.add(key);
      if (generation !== viewGeneration.current) return;
      if (outcome.status === "accepted") {
        toast.success(outcome.message);
        if (!direct) {
          sendVisible.current = false;
          setSendSession(null);
        }
      } else if (outcome.status === "outcome_unknown") {
        toast.warning(outcome.message);
        if (!direct) {
          setSendUncertain(true);
          setSendNotice(outcome.message);
        }
      } else {
        if (!direct) setSendNotice(outcome.message);
        toast.error(outcome.message);
      }
    } finally {
      busy.current = false;
      if (mounted.current) setSendSubmitting(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    function onOpen(event: Event) {
      if (busy.current) return;
      const session = parseOpenEvent(event);
      if (!session) {
        toast.error("红包消息 ID 无效，无法打开。");
        return;
      }
      viewGeneration.current += 1;
      sendVisible.current = false;
      setSendSession(null);
      setOpenOutcome(null);
      setOpenGesture(session.gesture);
      setOpenSession(session);
      // 旧窗口挂载即打开红包；新猜拳参与者缺手势时等待本人选择。
      void claim(session, session.gesture);
    }
    function onSend(event: Event) {
      if (busy.current || sendVisible.current) return;
      viewGeneration.current += 1;
      sendVisible.current = true;
      const session = parseSendEvent(event);
      setOpenSession(null);
      setSendNotice(null);
      setSendUncertain(false);
      setSendSession(session);
      void readSelfSession().then((me) => {
        if (mounted.current) setSelfUserName(me?.user?.userName ?? "");
      });
    }
    function onResend(event: Event) {
      if (busy.current) return;
      const request = parseResendEvent(event);
      if (!request) {
        toast.error("这条红包缺少有效原参数，无法重发。");
        return;
      }
      void send(request, true);
    }
    window.addEventListener(REDPACKET_OPEN_EVENT, onOpen);
    window.addEventListener(REDPACKET_SEND_EVENT, onSend);
    window.addEventListener(REDPACKET_RESEND_EVENT, onResend);
    const unlistenSend = listen(REDPACKET_SEND_EVENT, (event) => {
      onSend(new CustomEvent(REDPACKET_SEND_EVENT, { detail: event.payload }));
    }).catch(() => null);
    return () => {
      mounted.current = false;
      viewGeneration.current += 1;
      window.removeEventListener(REDPACKET_OPEN_EVENT, onOpen);
      window.removeEventListener(REDPACKET_SEND_EVENT, onSend);
      window.removeEventListener(REDPACKET_RESEND_EVENT, onResend);
      void unlistenSend.then((unlisten) => unlisten?.());
    };
  }, []);

  function submitSend(form: SendFormValues) {
    if (sendUncertain) return;
    const validated = validateSendForm(form);
    if (!validated.ok) {
      setSendNotice(Object.values(validated.errors)[0] ?? "请检查红包内容");
      return;
    }
    void send(validated.request, false);
  }

  return (
    <>
      {openSession ? (
        <OpenRedPacketDialog
          session={openSession}
          selfUserName={selfUserName}
          loading={openLoading}
          outcome={openOutcome}
          selectedGesture={openGesture}
          onGestureChange={setOpenGesture}
          onClaim={() => void claim(openSession, openGesture)}
          onClose={close}
        />
      ) : null}
      {sendSession ? (
        <SendRedPacketDialog
          key={viewGeneration.current}
          session={sendSession}
          submitting={sendSubmitting}
          uncertain={sendUncertain}
          notice={sendNotice}
          onSubmit={submitSend}
          onClose={close}
        />
      ) : null}
    </>
  );
}
