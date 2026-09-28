import type { ChatMessageDto } from "../../lib/types";

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

/**
 * `fishpi:redpacket` 的 `detail`。
 *
 * DTO 没有单独的红包 JSON 字段；overlay 用 `messageId` 再查详情。
 * `rawHint` 是 Bridge 给出的安全摘要（类型 / 已领数 / 祝福语截断）。
 */
export type FishpiRedpacketDetail = {
  messageId: string;
  userName: string;
  userNickname: string;
  userAvatarUrl: string;
  time: string;
  rawHint?: string;
  text?: string;
};

/**
 * `fishpi:redpacket-send` 的 `detail`。
 * 可空对象；有当前登录用户时带上 `userName`，专属红包等场景可再扩展。
 */
export type FishpiRedpacketSendDetail = {
  userName?: string;
};

export function isRedpacketMessage(message: ChatMessageDto): boolean {
  return message.kind === "redpacket";
}

export function toRedpacketDetail(
  message: ChatMessageDto,
): FishpiRedpacketDetail {
  return {
    messageId: message.id,
    userName: message.userName,
    userNickname: message.userNickname,
    userAvatarUrl: message.userAvatarUrl,
    time: message.time,
    ...(message.rawHint ? { rawHint: message.rawHint } : {}),
    ...(message.text ? { text: message.text } : {}),
  };
}

export function dispatchRedpacketOpen(message: ChatMessageDto): void {
  window.dispatchEvent(
    new CustomEvent<FishpiRedpacketDetail>(FISHPI_REDPACKET_EVENT, {
      detail: toRedpacketDetail(message),
    }),
  );
}

export function dispatchRedpacketSend(detail: FishpiRedpacketSendDetail = {}): void {
  window.dispatchEvent(
    new CustomEvent<FishpiRedpacketSendDetail>(FISHPI_REDPACKET_SEND_EVENT, {
      detail,
    }),
  );
}
