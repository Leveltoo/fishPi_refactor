import type { ChatMessageDto } from "../../lib/types";

export type ReplyTarget = {
  id: string;
  userName: string;
  displayName: string;
  body: string;
};

export function displayNameOf(message: ChatMessageDto): string {
  if (message.userNickname && message.userNickname.length > 0) {
    return message.userNickname;
  }
  return message.userName;
}

export function messagePlainBody(message: ChatMessageDto): string {
  const md = message.md?.trim();
  if (md) {
    return md;
  }
  const text = message.text?.trim();
  if (text) {
    return text;
  }
  const hint = message.rawHint?.trim();
  if (hint) {
    return hint;
  }
  return "（空消息）";
}

export function toReplyTarget(message: ChatMessageDto): ReplyTarget {
  return {
    id: message.id,
    userName: message.userName,
    displayName: displayNameOf(message),
    body: messagePlainBody(message),
  };
}

/**
 * 发送时再拼接的引用块。前缀对齐旧版 `回复@x`（回复与 @ 之间无空格）。
 * `raw` 优先为 `chatroom_raw` 原文，缺省回落本地 md/text。
 */
export function formatReplyTemplate(
  target: ReplyTarget,
  selfUserName: string | null,
  raw = target.body,
): string {
  const quoted = raw
    .split("\n")
    .map((line) => `>${line}`)
    .join("\n")
    .trim();
  const mention =
    selfUserName != null &&
    selfUserName.length > 0 &&
    target.userName === selfUserName
      ? ""
      : `@${target.userName} `;
  return `回复${mention}[↩](https://fishpi.cn/cr#chatroom${target.id} "跳转至原消息")：\n\n${quoted}\n\n`;
}

export function startsWithReplyTemplate(
  draft: string,
  target: ReplyTarget,
): boolean {
  return draft.includes(`#chatroom${target.id}`);
}
