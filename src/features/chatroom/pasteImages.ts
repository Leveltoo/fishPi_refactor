import { convertFileSrc } from "@tauri-apps/api/core";
import { isImageFile, uploadMediaToMarkdown } from "../../lib/upload";
import { sanitizeHttpUrl } from "../../lib/markdown";

/** 对齐旧 `htmlGetImg`：抽出 HTML 里 `src="..."`。 */
export function htmlImageSources(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...new Set(Array.from(doc.querySelectorAll("img[src]"))
    .map((image) => image.getAttribute("src")?.trim() ?? "")
    .filter(Boolean))];
}

export function isRemoteImageSrc(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

export function isFileSrc(src: string): boolean {
  return /^file:/i.test(src);
}

export function remoteImageMarkdown(srcs: readonly string[]): string {
  return srcs
    .filter(isRemoteImageSrc)
    .map((src) => sanitizeHttpUrl(src))
    .filter((src): src is string => src != null)
    .map((url) => `![图片](<${url}>)`)
    .join("\n");
}

function pathFromFileUrl(src: string): string | null {
  try {
    const url = new URL(src);
    if (url.protocol !== "file:") {
      return null;
    }
    let path = decodeURIComponent(url.pathname);
    if (/^\/[a-zA-Z]:/.test(path)) {
      path = path.slice(1);
    }
    return path;
  } catch {
    return null;
  }
}

/** 把粘贴 HTML 里的 `file://` 读成 File，失败返回 null（不授权任意 fs）。 */
export async function fileFromLocalSrc(src: string): Promise<File | null> {
  if (!isFileSrc(src)) {
    return null;
  }
  const candidates = [src];
  const path = pathFromFileUrl(src);
  if (path != null) {
    try {
      candidates.push(convertFileSrc(path));
    } catch {
      // 非 Tauri 环境没有 asset 协议。
    }
  }
  for (const url of candidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        continue;
      }
      const blob = await response.blob();
      if (blob.size === 0) {
        continue;
      }
      const name = decodeURIComponent(
        src.split(/[/\\]/).pop()?.split("?")[0] || "clipboard.png",
      );
      const file = new File([blob], name, {
        type: blob.type || "image/png",
      });
      if (isImageFile(file)) {
        return file;
      }
    } catch {
      // 试下一条候选地址。
    }
  }
  return null;
}

export async function uploadLocalSources(
  srcs: readonly string[],
): Promise<string> {
  const files: File[] = [];
  for (const src of srcs) {
    const file = await fileFromLocalSrc(src);
    if (file == null) {
      throw new Error("无法读取粘贴的本地图片，请用上传图片选择该文件。");
    }
    files.push(file);
  }
  if (files.length === 0) {
    return "";
  }
  return uploadMediaToMarkdown(files);
}
