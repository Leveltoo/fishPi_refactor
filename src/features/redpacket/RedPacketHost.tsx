import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";

import { openRedPacket, readSelfUserName, sendRedPacket } from "./api";
import { DEFAULT_BLESSING } from "./constants";
import {
  parseOpenEvent,
  parseSendEvent,
  REDPACKET_OPEN_EVENT,
  REDPACKET_SEND_EVENT,
} from "./events";
import { OpenRedPacketDialog } from "./OpenRedPacketDialog";
import { SendRedPacketDialog } from "./SendRedPacketDialog";
import { validateSendForm, type SendFormValues } from "./sendForm";
import type {
  GestureIndex,
  OpenOutcome,
  OpenSession,
  SendSession,
} from "./types";
import "./redpacket.css";

/**
 * 常驻宿主：无必填 props。自己监听 window 自定义事件，决定是否弹出 dialog。
 */
export function RedPacketHost() {
  const [selfUserName, setSelfUserName] = useState("");
  const [openSession, setOpenSession] = useState<OpenSession | null>(null);
  const [sendSession, setSendSession] = useState<SendSession | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [sendSubmitting, setSendSubmitting] = useState(false);
  const [openOutcome, setOpenOutcome] = useState<OpenOutcome | null>(null);
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [openGesture, setOpenGesture] = useState<GestureIndex | undefined>();
  const openGen = useRef(0);
  const sendGen = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void readSelfUserName().then((name) => {
      if (!cancelled) {
        setSelfUserName(name);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onOpen(event: Event) {
      const session = parseOpenEvent(event);
      if (!session) {
        toast.error("缺少红包消息 ID，无法打开。");
        return;
      }
      openGen.current += 1;
      sendGen.current += 1;
      setSendSession(null);
      setOpenOutcome(null);
      setOpenLoading(false);
      setOpenGesture(session.gesture);
      setOpenSession(session);
    }

    function onSend(event: Event) {
      const session = parseSendEvent(event);
      openGen.current += 1;
      sendGen.current += 1;
      setOpenSession(null);
      setSendNotice(null);
      setSendSubmitting(false);
      if (session.selfUserName) {
        const fromEvent = session.selfUserName;
        setSelfUserName((current) => current || fromEvent);
      }
      setSendSession(session);
    }

    window.addEventListener(REDPACKET_OPEN_EVENT, onOpen);
    window.addEventListener(REDPACKET_SEND_EVENT, onSend);
    const unlistenSend = listen(REDPACKET_SEND_EVENT, (event) => {
      const synthetic = new CustomEvent(REDPACKET_SEND_EVENT, {
        detail: event.payload,
      });
      onSend(synthetic);
    });
    return () => {
      window.removeEventListener(REDPACKET_OPEN_EVENT, onOpen);
      window.removeEventListener(REDPACKET_SEND_EVENT, onSend);
      void unlistenSend.then((fn) => fn());
    };
  }, []);

  const closeOpen = useCallback(() => {
    if (openLoading) {
      return;
    }
    setOpenSession(null);
    setOpenOutcome(null);
    setOpenGesture(undefined);
  }, [openLoading]);

  const closeSend = useCallback(() => {
    if (sendSubmitting) {
      return;
    }
    setSendSession(null);
    setSendNotice(null);
  }, [sendSubmitting]);

  const claim = useCallback(async () => {
    if (!openSession || openLoading) {
      return;
    }
    const gen = openGen.current;
    setOpenLoading(true);
    const outcome = await openRedPacket({
      oId: openSession.oId,
      gesture: openGesture,
    });
    if (gen !== openGen.current) {
      return;
    }
    setOpenOutcome(outcome);
    setOpenLoading(false);
    if (outcome.status === "ok") {
      toast.success("已打开红包");
      return;
    }
    if (outcome.status === "outcome_unknown") {
      toast.warning(outcome.message);
      return;
    }
    toast.error(outcome.message);
  }, [openGesture, openLoading, openSession]);

  const submitSend = useCallback(
    async (form: SendFormValues) => {
      if (sendSubmitting) {
        return;
      }
      const validated = validateSendForm({
        ...form,
        message: form.message.trim() || DEFAULT_BLESSING[form.type],
      });
      if (!validated.ok) {
        setSendNotice(Object.values(validated.errors)[0] ?? "请检查红包内容");
        return;
      }
      const gen = sendGen.current;
      setSendSubmitting(true);
      setSendNotice(null);
      const outcome = await sendRedPacket(validated.request);
      if (gen !== sendGen.current) {
        return;
      }
      setSendSubmitting(false);
      if (outcome.status === "accepted") {
        toast.success(outcome.message);
        setSendSession(null);
        return;
      }
      if (outcome.status === "outcome_unknown") {
        toast.warning(outcome.message);
        setSendSession(null);
        return;
      }
      setSendNotice(outcome.message);
      toast.error(outcome.message);
    },
    [sendSubmitting],
  );

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
          onClaim={() => {
            void claim();
          }}
          onClose={closeOpen}
        />
      ) : null}
      {sendSession ? (
        <SendRedPacketDialog
          session={sendSession}
          submitting={sendSubmitting}
          notice={sendNotice}
          onSubmit={(form) => {
            void submitSend(form);
          }}
          onClose={closeSend}
        />
      ) : null}
    </>
  );
}
