import { TALK_PATTERN_MAX } from "./constants";

export type TalkPattern = RegExp | "empty" | "invalid";

/**
 * 把用户输入编译成正则。非法或超长时返回 invalid，调用方忽略该条并提示。
 * 只用 RegExp 构造，不把字符串当脚本执行。空串不匹配任何内容。
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
  if (pattern === "empty" || pattern === "invalid") {
    return false;
  }
  return pattern.test(text);
}
