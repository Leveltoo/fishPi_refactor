import { openUrl } from "@tauri-apps/plugin-opener";

const FISHPI_ORIGIN = "https://fishpi.cn";

/**
 * Markdown 链接 / 图片策略：只放行 http(s)。
 * 禁止 javascript:、data:、file: 等，避免 WebView 内跳转或脚本执行。
 */
export function sanitizeHttpUrl(raw: string | null | undefined): string | null {
  if (raw == null) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const url = new URL(trimmed, FISHPI_ORIGIN);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.username !== "" || url.password !== "") {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

/** react-markdown 的 urlTransform：不安全地址变成空字符串，渲染器将不输出该链接。 */
export function markdownUrlTransform(url: string): string {
  return sanitizeHttpUrl(url) ?? "";
}

/** 在系统浏览器打开，不导航主 WebView。 */
export async function openSafeExternalUrl(
  raw: string | null | undefined,
): Promise<void> {
  const href = sanitizeHttpUrl(raw);
  if (href == null) {
    return;
  }
  await openUrl(href);
}
