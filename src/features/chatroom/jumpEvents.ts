/**
 * 聊天室消息内跳转的 window CustomEvent 约定。
 *
 * 派发方：MarkdownView / ChatHtmlView（点 `#话题#`、点回复锚点）。
 * 监听方：ChatRoomPage（切换话题 / 滚动高亮原消息）。
 * 事件常量保留两套等值别名（FISHPI_* 与 ChatRoomPage 用的 *_EVENT），字符串相同。
 */

/** 回复锚点跳转。detail: `{ messageId: string }` */
export const FISHPI_CHAT_JUMP = "fishpi:chat-jump";

/** 消息内 `#话题#` 点击。detail: `{ topic: string }` */
export const FISHPI_DISCUSS_PICK = "fishpi:discuss-pick";

/** ChatRoomPage 侧引用名（与 FISHPI_* 等值）。 */
export const CHAT_JUMP_EVENT = FISHPI_CHAT_JUMP;
export const DISCUSS_PICK_EVENT = FISHPI_DISCUSS_PICK;

export type ChatJumpDetail = { messageId: string };

export type DiscussPickDetail = { topic: string };

export function dispatchDiscussPick(topic: string): void {
  window.dispatchEvent(
    new CustomEvent<DiscussPickDetail>(FISHPI_DISCUSS_PICK, {
      detail: { topic },
    }),
  );
}

export function dispatchChatJump(messageId: string): void {
  window.dispatchEvent(
    new CustomEvent<ChatJumpDetail>(FISHPI_CHAT_JUMP, {
      detail: { messageId },
    }),
  );
}

/** 监听回复锚点跳转；返回取消监听函数。 */
export function listenChatJump(cb: (messageId: string) => void): () => void {
  const handler = (event: Event): void => {
    const detail = (event as CustomEvent<ChatJumpDetail>).detail;
    if (detail != null && typeof detail.messageId === "string") {
      cb(detail.messageId);
    }
  };
  window.addEventListener(FISHPI_CHAT_JUMP, handler);
  return () => {
    window.removeEventListener(FISHPI_CHAT_JUMP, handler);
  };
}
