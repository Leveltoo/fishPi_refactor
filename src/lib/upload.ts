/**
 * 图片 / 文件上传：base64 → Bridge `file_upload` → 可插入 markdown。
 *
 * SDK `FishPi::upload` 接本地路径；粘贴 / 选文件没有路径，故走临时文件桥。
 * 成功只表示服务器返回了 URL，不自动发进聊天室。
 */

import { invoke } from "@tauri-apps/api/core";
import { parseInvokeError } from "./errors";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ITEMS = 9;

export type UploadedFile = {
  filename: string;
  url: string;
  markdown: string;
  kind: "image" | "video" | "file" | string;
};

type FileUploadResult = {
  success: UploadedFile[];
  errs: string[];
};

export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) {
    return true;
  }
  return /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(file.name);
}

export function isVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) {
    return true;
  }
  return /\.(mp4|webm|mov|m4v|m3u8)$/i.test(file.name);
}

export function isUploadableMedia(file: File): boolean {
  return isImageFile(file) || isVideoFile(file);
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/** 上传一批本地文件，返回服务器 markdown 片段。空列表直接返回 []。 */
export async function uploadFiles(files: File[]): Promise<UploadedFile[]> {
  const usable = files.filter((file) => file.size > 0 && file.size <= MAX_BYTES);
  if (usable.length === 0) {
    if (files.some((file) => file.size > MAX_BYTES)) {
      throw parseInvokeError({ code: "business", message: "文件超过 20MB 上限" });
    }
    return [];
  }
  if (usable.length > MAX_ITEMS) {
    throw parseInvokeError({ code: "business", message: "一次最多上传 9 个文件" });
  }

  const items = await Promise.all(
    usable.map(async (file) => ({
      name: file.name || "clipboard.png",
      dataBase64: await fileToBase64(file),
    })),
  );

  try {
    const result = await invoke<FileUploadResult>("file_upload", {
      request: { items },
    });
    return result.success ?? [];
  } catch (error) {
    throw parseInvokeError(error);
  }
}

/** 粘贴 / 选择的媒体文件 → markdown 行；无成功文件返回空串。 */
export async function uploadMediaToMarkdown(files: File[]): Promise<string> {
  const media = files.filter(isUploadableMedia);
  if (media.length === 0) {
    return "";
  }
  const uploaded = await uploadFiles(media);
  return uploaded.map((file) => file.markdown).filter(Boolean).join("\n");
}
