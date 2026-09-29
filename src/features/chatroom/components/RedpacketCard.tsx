import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  whoFromCardOrStatus,
} from "../redpacketEvents";
import { UserContextMenu } from "./UserContextMenu";

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
  const [claimed, setClaimed] = useState(false);
  const card = redpacketCardOf(message);
  const type = card?.type ?? "";
  const got = card?.got ?? 0;
  const count = card?.count ?? 0;
  const money = card?.money ?? 0;
  const msg = card?.msg?.trim() || message.rawHint?.trim() || "恭喜发财";
  const who = whoFromCardOrStatus(card, statusWho);
  const empty = count > 0 && got >= count;
  const alreadyGot =
    claimed ||
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
    dispatchRedpacketOpen(message);
    if (!isRps) {
      setClaimed(true);
    }
  }

  function pickGesture(gesture: 0 | 1 | 2): void {
    dispatchRedpacketOpen(message, { type: "rockPaperScissors", gesture });
    setClaimed(true);
  }

  const title = empty ? "红包已领完" : alreadyGot ? "红包已领取" : "快快点击领取红包";

  return (
    <div className="chat-rp-wrap">
      <button
        type="button"
        className={done ? "chat-msg-redpacket is-done" : "chat-msg-redpacket"}
        title={title}
        onClick={openCard}
      >
        <div className="chat-rp-main">
          <span className="chat-rp-icon" aria-hidden="true">
            🧧
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
      </button>
      {gestureVisible ? (
        <div className="chat-gesture" title="猜猜我出什么呢~">
          <button type="button" title="石头" onClick={() => pickGesture(0)}>
            ✊
          </button>
          <button type="button" title="剪刀" onClick={() => pickGesture(1)}>
            ✌️
          </button>
          <button type="button" title="布" onClick={() => pickGesture(2)}>
            ✋
          </button>
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
  if (message.revoked) {
    return null;
  }
  const who = whoFromCardOrStatus(redpacketCardOf(message), statusWho);
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
  const card = redpacketCardOf(message);
  if (card == null || !card.type) {
    return false;
  }
  const money =
    card.type === "rockPaperScissors" ? Math.ceil(card.money / 0.95) : card.money;
  dispatchRedpacketResend({
    type: card.type,
    msg: card.msg,
    money,
    count: card.count,
    recivers: card.recivers ?? [],
  });
  return true;
}
