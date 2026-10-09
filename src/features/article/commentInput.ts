import { DEFAULT_EMOJIS } from "../chatroom/defaultEmojis";
import { sanitizeHttpUrl } from "../../lib/markdown";

export function pastedImageSources(html: string): string[] {
  const document = new DOMParser().parseFromString(html, "text/html");
  return [...document.querySelectorAll("img[src]")]
    .map((image) => image.getAttribute("src")?.trim() ?? "")
    .filter(Boolean);
}

export function imageMarkdown(sources: string[]): string {
  return sources.filter((src) => !/^file:/i.test(src))
    .map(sanitizeHttpUrl).filter((url): url is string => url != null)
    .map((url) => `![图片](<${url}>)`).join("\n");
}

export function emojiCompletion(text: string, caret: number) {
  const before = text.slice(0, caret);
  const match = before.match(/:([^\s:]+)$/);
  if (!match) return null;
  const items = DEFAULT_EMOJIS.filter((emoji) => emoji.name.startsWith(match[1])).slice(0, 5);
  return items.length ? { start: before.length - match[0].length, items } : null;
}
