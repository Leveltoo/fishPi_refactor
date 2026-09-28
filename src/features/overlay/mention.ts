export type MentionQuery = {
  start: number;
  query: string;
};

/** 光标前一段 `@query`（@ 前是开头或空白）。已含空格则不算正在补全。 */
export function readMention(text: string, caret: number): MentionQuery | null {
  const pos = clampCaret(text, caret);
  const before = text.slice(0, pos);
  const at = before.lastIndexOf("@");
  if (at < 0) {
    return null;
  }
  if (at > 0 && !/\s/.test(before.charAt(at - 1))) {
    return null;
  }
  const query = before.slice(at + 1);
  if (/[\s\n]/.test(query)) {
    return null;
  }
  return { start: at, query };
}

export function insertMention(
  text: string,
  start: number,
  caret: number,
  userName: string,
): { text: string; caret: number } {
  const token = `@${userName} `;
  const pos = clampCaret(text, caret);
  const next = text.slice(0, start) + token + text.slice(pos);
  return { text: next, caret: start + token.length };
}

function clampCaret(text: string, caret: number): number {
  if (!Number.isFinite(caret) || caret < 0) {
    return 0;
  }
  return caret > text.length ? text.length : caret;
}
