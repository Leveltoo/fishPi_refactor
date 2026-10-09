import { sanitizeHttpUrl } from "../../lib/markdown";
import { serializeCloudEmojiText } from "./cloudEmojiLogic";

export type EmojiExportEntry = { name?: string; url: string };

/** Server groups use JSON; legacy cloud favorites use newline text separately. */
export function serializeEmojis(items: EmojiExportEntry[]): string {
  return JSON.stringify(
    items.map((item) => ({ name: item.name ?? "", url: item.url })),
    null,
    2,
  );
}

/** 触发浏览器下载 JSON 文件。 */
export function downloadEmojiJson(items: EmojiExportEntry[]): void {
  const blob = new Blob([serializeEmojis(items)], {
    type: "application/json",
  });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `fishpi-emoji-${new Date()
    .toISOString()
    .slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export function downloadCloudEmojiText(urls: readonly string[]): void {
  const href = URL.createObjectURL(new Blob([serializeCloudEmojiText(urls)], { type: "text/plain" }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `fishpi-favorites-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

/**
 * 解析导入内容：JSON 数组（字符串或 `{name,url}`）、`{名字:地址}` 对象、
 * 以及旧版 `faceExport` 的换行地址文本。只保留 http(s) 地址并按出现顺序去重。
 */
export function parseEmojiImport(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown): void => {
    if (typeof value !== "string") {
      return;
    }
    const url = sanitizeHttpUrl(value.trim());
    if (url == null || seen.has(url)) {
      return;
    }
    seen.add(url);
    out.push(url);
  };

  const raw = text.trim();
  if (raw.length === 0) {
    return out;
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (typeof entry === "string") {
        push(entry);
      } else if (entry != null && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        push(record.url ?? record.src ?? record.link ?? record.value);
      }
    }
  } else if (parsed != null && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if ("url" in record || "src" in record || "link" in record) {
      push(record.url ?? record.src ?? record.link);
    } else {
      for (const value of Object.values(record)) {
        push(value);
      }
    }
  } else {
    for (const line of raw.split(/[\r\n,]+/)) {
      push(line);
    }
  }
  return out;
}
