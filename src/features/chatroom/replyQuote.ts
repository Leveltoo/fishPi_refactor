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
 * 把被回复消息填回 Composer：引用块 + 跳转链接，光标落在末尾继续输入。
 * 发送仍走现有 markdown `chatroom_send`。
 */
export function formatReplyTemplate(
  target: ReplyTarget,
  selfUserName: string | null,
): string {
  const quoted = target.body
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
  return `回复 ${mention}[↩](https://fishpi.cn/cr#chatroom${target.id} "跳转至原消息")：\n\n${quoted}\n\n`;
}

export function startsWithReplyTemplate(
  draft: string,
  target: ReplyTarget,
): boolean {
  return draft.includes(`#chatroom${target.id}`);
}
