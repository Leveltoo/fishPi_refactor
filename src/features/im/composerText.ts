import { sanitizeHttpUrl } from "../../lib/markdown";

export function insertText(text: string, start: number, end: number, token: string) {
  const from = Math.max(0, Math.min(text.length, start));
  const to = Math.max(from, Math.min(text.length, end));
  return { text: text.slice(0, from) + token + text.slice(to), caret: from + token.length };
}

export function htmlImageTokens(html: string): string[] {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const urls = new Set<string>();
  for (const image of Array.from(parsed.querySelectorAll("img[src]"))) {
    const raw = image.getAttribute("src")?.trim() ?? "";
    if (!/^(?:https?:\/\/|\/\/)/i.test(raw)) continue;
    const url = sanitizeHttpUrl(raw);
    if (url) urls.add(url);
  }
  return [...urls].map((url) => `![图片](<${url}>)`);
}
