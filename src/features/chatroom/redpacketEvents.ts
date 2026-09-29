import type {
  ChatMessageDto,
  OnlineUser,
  RedpacketCardDto,
  RedpacketWhoDto,
} from "../../lib/types";
import { currentOnlineUsers } from "./onlineUsers";

/**
 * 聊天室 ↔ 红包 overlay 的 window CustomEvent 约定。
 *
 * 本模块只派发事件，不渲染 overlay，也不 import `@/features/redpacket`。
 * 红包 agent 在主窗口监听同名事件即可。
 */

/** 点击红包消息：打开领取 overlay。 */
export const FISHPI_REDPACKET_EVENT = "fishpi:redpacket";

/** Composer「发红包」：打开发送 overlay。 */
export const FISHPI_REDPACKET_SEND_EVENT = "fishpi:redpacket-send";

/** 右键「再发一个」：按原参数直接重发，不打开面板。 */
export const FISHPI_REDPACKET_RESEND_EVENT = "fishpi:redpacket-resend";

/**
 * `fishpi:redpacket` 的 `detail`。
 *
 * 卡片字段来自 DTO `redpacket`；overlay 仍用 `messageId` 再查详情。
 */
export type FishpiRedpacketDetail = {
  messageId: string;
  userName: string;
  userNickname: string;
  userAvatarUrl: string;
  time: string;
  rawHint?: string;
  text?: string;
  type?: string;
  msg?: string;
  money?: number;
  got?: number;
  count?: number;
  recivers?: string[];
  gesture?: 0 | 1 | 2;
};

/**
 * `fishpi:redpacket-send` 的 `detail`。
 * `user` 锁定专属接收人；`userName` 只表示当前登录用户，不要当成专属对象。
 */
export type FishpiRedpacketSendDetail = {
  userName?: string;
  user?: string;
  type?: string;
  users?: OnlineUser[];
};

export type FishpiRedpacketResendDetail = {
  type: string;
  msg: string;
  money: number;
  count: number;
  recivers: string[];
};

export function isRedpacketMessage(message: ChatMessageDto): boolean {
  return message.kind === "redpacket";
}

export function redpacketCardOf(
  message: ChatMessageDto,
): RedpacketCardDto | undefined {
  return message.redpacket;
}

export function toRedpacketDetail(
  message: ChatMessageDto,
): FishpiRedpacketDetail {
  const card = message.redpacket;
  return {
    messageId: message.id,
    userName: message.userName,
    userNickname: message.userNickname,
    userAvatarUrl: message.userAvatarUrl,
    time: message.time,
    ...(message.rawHint ? { rawHint: message.rawHint } : {}),
    ...(message.text ? { text: message.text } : {}),
    ...(card?.type ? { type: card.type } : {}),
    ...(card?.msg ? { msg: card.msg } : {}),
    ...(card != null ? { money: card.money, got: card.got, count: card.count } : {}),
    ...(card?.recivers && card.recivers.length > 0
      ? { recivers: card.recivers }
      : {}),
  };
}

export function dispatchRedpacketOpen(
  message: ChatMessageDto,
  extra: Partial<FishpiRedpacketDetail> = {},
): void {
  window.dispatchEvent(
    new CustomEvent<FishpiRedpacketDetail>(FISHPI_REDPACKET_EVENT, {
      detail: { ...toRedpacketDetail(message), ...extra },
    }),
  );
}

export function dispatchRedpacketSend(detail: FishpiRedpacketSendDetail = {}): void {
  const users = detail.users ?? currentOnlineUsers();
  window.dispatchEvent(
    new CustomEvent<FishpiRedpacketSendDetail>(FISHPI_REDPACKET_SEND_EVENT, {
      detail: { ...detail, ...(users.length > 0 ? { users } : {}) },
    }),
  );
}

export function dispatchRedpacketResend(detail: FishpiRedpacketResendDetail): void {
  window.dispatchEvent(
    new CustomEvent<FishpiRedpacketResendDetail>(FISHPI_REDPACKET_RESEND_EVENT, {
      detail,
    }),
  );
}

export function whoFromCardOrStatus(
  card: RedpacketCardDto | undefined,
  statusWho: RedpacketWhoDto[] | undefined,
): RedpacketWhoDto[] {
  const fromCard = card?.who ?? [];
  const fromStatus = statusWho ?? [];
  if (fromStatus.length === 0) {
    return fromCard;
  }
  if (fromCard.length === 0) {
    return fromStatus;
  }
  const merged = fromCard.map((entry) => ({ ...entry }));
  for (const entry of fromStatus) {
    if (!entry.userName) {
      continue;
    }
    const existing = merged.find((item) => item.userName === entry.userName);
    if (existing == null) {
      merged.push({ ...entry });
      continue;
    }
    if (!existing.avatar && entry.avatar) {
      existing.avatar = entry.avatar;
    }
    if (!existing.userId && entry.userId) {
      existing.userId = entry.userId;
    }
  }
  return merged;
}
