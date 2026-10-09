export type CloudEmojiSnapshot = {
  sessionGeneration: number;
  urls: string[];
};

export const CLOUD_EMOJI_MAX_FILE_BYTES = 512 * 1024;
export const CLOUD_EMOJI_MAX_URLS = 4096;

/** Absolute, credential-free image links only; retain the legacy stored spelling. */
export function cloudEmojiUrl(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0 || new TextEncoder().encode(value).length > 8192 || /[\s<>"']/.test(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

/** The old faceImport/faceExport format is one URL per line, not group JSON. */
export function parseCloudEmojiText(text: string): string[] {
  if (new TextEncoder().encode(text).length > CLOUD_EMOJI_MAX_FILE_BYTES) {
    throw new Error("收藏文件不能超过 512 KiB");
  }
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/[\r\n]+/)) {
    const url = cloudEmojiUrl(line);
    if (url != null && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  if (urls.length > CLOUD_EMOJI_MAX_URLS) {
    throw new Error("收藏地址不能超过 4096 条");
  }
  return urls;
}

export function serializeCloudEmojiText(urls: readonly string[]): string {
  return urls.join("\n");
}
