import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { ChatMessageDto, RedpacketWhoDto } from "../../../lib/types";
import { sanitizeHttpUrl } from "../../../lib/markdown";
import { userCardProps } from "../../usercard/hover";
import {
  dispatchRedpacketOpen,
  dispatchRedpacketResend,
  redpacketCardOf,
  toRedpacketResendDetail,
  whoFromCardOrStatus,
} from "../redpacketEvents";
import { UserContextMenu } from "./UserContextMenu";
import { FISHPI_REDPACKET_RESULT_EVENT } from "../redpacketEvents";
import { readSelfSession, parseOpenPayload } from "../../redpacket/api";
import type { RedPacketInfo } from "../../redpacket/types";
import { GesturePicker } from "../../redpacket/parts";
import { RedPacketIcon } from "./RedPacketIcon";

const TYPE_LABEL: Record<string, string> = {
  random: "拼手气红包",
  average: "普通红包",
  specify: "专属红包",
  heartbeat: "心跳红包",
  rockPaperScissors: "猜拳红包",
};

type RedpacketCardProps = {
  message: ChatMessageDto;
  selfUserName: string | null;
  mine: boolean;
  statusWho?: RedpacketWhoDto[];
};

type RedpacketWhoRowProps = {
  message: ChatMessageDto;
  selfUserName: string | null;
  statusWho?: RedpacketWhoDto[];
  userAvatarMap?: Map<string, string>;
  onMention: (userName: string) => void;
};

function avatarLetter(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1) : "?";
}

function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? "红包";
}

/**
 * 对齐旧 chatroom-item 红包卡：留言、类型栏、积分、已领完/已领取灰态。
 * 猜拳用真实 type/got/who，不靠 rawHint 近似。
 * 领取人行由 RedpacketWhoRow 画在气泡外，避免被包进 chat-msg-content。
 */
export function RedpacketCard({
  message,
  selfUserName,
  mine,
  statusWho,
}: RedpacketCardProps) {
  const opened = useConfirmedResult(message.id, selfUserName);
  const card = redpacketCardOf(message);
  const type = card?.type ?? "";
  const got = Math.max(card?.got ?? 0, opened?.info.got ?? 0);
  const count = opened?.info.count || card?.count || 0;
  const money = card?.money ?? 0;
  const msg = card?.msg?.trim() || message.rawHint?.trim() || "恭喜发财";
  const who = whoFromCardOrStatus(card, [...(statusWho ?? []), ...(opened?.who ?? [])]);
  const empty = count > 0 && got >= count;
  const alreadyGot =
    (selfUserName != null &&
      selfUserName.length > 0 &&
      who.some((entry) => entry.userName === selfUserName));
  const done = empty || alreadyGot;
  const isRps = type === "rockPaperScissors";
  const gestureVisible = isRps && !mine && !empty && !alreadyGot && !message.revoked;

  function openCard(): void {
    if (message.revoked) {
      return;
    }
    if (isRps && !mine && !empty && !alreadyGot) {
      return;
    }
    dispatchRedpacketOpen(message, { detailOnly: mine || empty || alreadyGot });
  }

  function pickGesture(gesture: 0 | 1 | 2): void {
    if (message.revoked || !gestureVisible) return;
    dispatchRedpacketOpen(message, { type: "rockPaperScissors", gesture });
  }

  const title = empty ? "红包已领完" : alreadyGot ? "红包已领取" : "快快点击领取红包";

  return (
    <div className="chat-rp-wrap">
      <Button
        type="button"
        variant="ghost"
        className={done ? "chat-msg-redpacket is-done" : "chat-msg-redpacket"}
        title={title}
        onClick={openCard}
      >
        <div className="chat-rp-main">
          <span className="chat-rp-icon" aria-hidden="true">
            <RedPacketIcon />
          </span>
          <span className="chat-rp-msg">{msg}</span>
        </div>
        <div className="chat-rp-type">
          <span>{typeLabel(type)}</span>
          <span className="chat-rp-money">{money > 0 ? money : ""}</span>
        </div>
        {done ? (
          <span className="chat-rp-status">{empty ? "已领完" : "已领取"}</span>
        ) : null}
      </Button>
      {gestureVisible ? (
        <div className="chat-gesture" title="猜猜我出什么呢~">
          <GesturePicker onChange={pickGesture} />
        </div>
      ) : null}
    </div>
  );
}

/** 领取人头像行：对齐旧 .redpacket-users，画在气泡下方。 */
export function RedpacketWhoRow({
  message,
  selfUserName,
  statusWho,
  userAvatarMap,
  onMention,
}: RedpacketWhoRowProps) {
  const opened = useConfirmedResult(message.id, selfUserName);
  if (message.revoked) {
    return null;
  }
  const who = whoFromCardOrStatus(redpacketCardOf(message),
    [...(statusWho ?? []), ...(opened?.who ?? [])]);
  if (who.length === 0) {
    return null;
  }
  return (
    <div className="chat-redpacket-who">
      {who.map((entry, index) => {
        if (!entry.userName) {
          return null;
        }
        const src = sanitizeHttpUrl(
          entry.avatar || userAvatarMap?.get(entry.userName),
        );
        const inner = (
          <Avatar className="size-[22px]">
            {src ? <AvatarImage src={src} alt="" /> : null}
            <AvatarFallback>{avatarLetter(entry.userName)}</AvatarFallback>
          </Avatar>
        );
        const key = `${entry.userId ?? entry.userName}-${index}`;
        if (entry.userName === selfUserName) {
          return (
            <span key={key} className="chat-redpacket-user" title={entry.userName}>
              {inner}
            </span>
          );
        }
        return (
          <ContextMenu key={key}>
            <ContextMenuTrigger asChild>
              <span
                className="chat-redpacket-user"
                title={entry.userName}
                {...userCardProps(entry.userName)}
              >
                {inner}
              </span>
            </ContextMenuTrigger>
            <UserContextMenu userName={entry.userName} onMention={onMention} />
          </ContextMenu>
        );
      })}
      <span className="chat-redpacket-word">领取了</span>
    </div>
  );
}

/** 右键「再发一个」：猜拳按旧版 money/0.95 还原后直接重发。 */
export function resendRedpacket(message: ChatMessageDto): boolean {
  const detail = toRedpacketResendDetail(message);
  if (!detail) {
    return false;
  }
  dispatchRedpacketResend(detail);
  return true;
}

function useConfirmedResult(messageId: string, selfUserName: string | null): RedPacketInfo | null {
  const [result, setResult] = useState<RedPacketInfo | null>(null);
  useEffect(() => {
    let stopped = false;
    setResult(null);
    function onResult(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.messageId !== messageId) return;
      const data = parseOpenPayload(detail);
      if (!data) return;
      void readSelfSession().then((me) => {
        if (!stopped && me?.sessionGeneration === data.sessionGeneration &&
          me.user?.userName === selfUserName) {
          setResult(data);
        }
      });
    }
    window.addEventListener(FISHPI_REDPACKET_RESULT_EVENT, onResult);
    return () => {
      stopped = true;
      window.removeEventListener(FISHPI_REDPACKET_RESULT_EVENT, onResult);
    };
  }, [messageId, selfUserName]);
  return result;
}
