import type { PrivateMessageDto, ReplyTarget } from "./types";

/** 从消息构造引用目标：展示名 + 全文（发送时整段引用，chip 用 CSS 截断）。 */
export function replyTargetFromMessage(message: PrivateMessageDto): ReplyTarget {
  const raw = message.md?.trim() || message.text?.trim() || "";
  return {
    id: message.id,
    displayName: message.userNickname?.trim() || message.userName,
    body: raw,
  };
}

/**
 * 对齐旧 messagebox 私聊 send：`回复 [↩](…/chat#chat{id})` + 引用块 + 正文。
 * 私聊不加 @（与聊天室 formatReplyTemplate 不同）。
 */
export function formatPrivateReply(quote: ReplyTarget, content: string): string {
  const quoted = quote.body
    .split("\n")
    .map((line) => `>${line}`)
    .join("\n")
    .trim();
  return `回复 [↩](https://fishpi.cn/chat#chat${quote.id} "跳转至原消息")：\n\n${quoted}\n\n${content}`;
}
