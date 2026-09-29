import { TALK_PATTERN_MAX } from "./constants";

export type TalkPattern = RegExp | "empty" | "invalid";

/**
 * 把用户输入编译成正则。非法或超长时返回 invalid，调用方忽略该条并提示。
 * 只用 RegExp 构造，不把字符串当脚本执行。
 * 空串对齐旧版 `new RegExp('')`：匹配所有聊天室消息。
 */
export function compileTalkPattern(source: string): TalkPattern {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    return "empty";
  }
  if (trimmed.length > TALK_PATTERN_MAX) {
    return "invalid";
  }
  try {
    return new RegExp(trimmed);
  } catch {
    return "invalid";
  }
}

export function talkPatternHits(pattern: TalkPattern, text: string): boolean {
  if (pattern === "invalid") {
    return false;
  }
  if (pattern === "empty") {
    return true;
  }
  return pattern.test(text);
}
