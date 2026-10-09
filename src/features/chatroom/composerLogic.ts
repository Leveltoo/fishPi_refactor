import { toMusicBox, topicQuote } from "./messageView";
import { formatReplyTemplate, type ReplyTarget } from "./replyQuote";

export function withReplyPrefix(draft: string, replying: boolean): string {
  if (!replying) {
    return draft.replace(/^并说：/, "");
  }
  return draft.startsWith("并说：") ? draft : `并说：${draft}`;
}

export function insertTextAtSelection(
  draft: string,
  start: number,
  end: number,
  token: string,
): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, draft.length));
  const to = Math.max(from, Math.min(end, draft.length));
  return {
    text: draft.slice(0, from) + token + draft.slice(to),
    caret: from + token.length,
  };
}

export function composeChatroomMessage(
  draft: string,
  options: {
    replyTo: ReplyTarget | null;
    selfUserName: string | null;
    raw?: string;
    discussed?: string | null;
  },
): string {
  let content = toMusicBox(draft);
  if (options.replyTo != null) {
    content = formatReplyTemplate(options.replyTo, options.selfUserName, options.raw) + content;
  }
  if (options.discussed) content += `\r\n${topicQuote(options.discussed)}`;
  return content.replace(/<span class="[^"]+-message"\s*\/>/g, "");
}
