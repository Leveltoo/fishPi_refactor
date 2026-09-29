export type MentionQuery = {
  start: number;
  query: string;
};

/**
 * 对齐旧 messagebox：任意位置 `@query`，且 @ 后至少 1 个非空白才触发。
 * 只打 `@` 不弹列表；已含空格则结束补全。
 */
export function readMention(text: string, caret: number): MentionQuery | null {
  const pos = clampCaret(text, caret);
  const before = text.slice(0, pos);
  const match = before.match(/@([^\s]+)$/);
  if (!match) {
    return null;
  }
  return { start: pos - match[0].length, query: match[1] };
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
