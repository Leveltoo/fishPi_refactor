/**
 * 聊天室 / 私聊右键共用动作：@、单独聊聊、访问主页、复制地址、专属红包。
 * 打开主页走 opener（系统浏览器）；红包只派发事件，不 import overlay。
 */

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { openImWithUser } from "../../lib/nav";
import { dispatchRedpacketSend } from "./redpacketEvents";

export function chatroomMessageUrl(messageId: string): string {
  return `https://fishpi.cn/cr?oId=${messageId}#chatroom${messageId}`;
}

export async function copyText(value: string): Promise<void> {
  if (value.length === 0) {
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    // 权限失败时退回 execCommand，不抛到 UI。
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
}

export async function copyImageFromSrc(
  src: string,
  element?: HTMLImageElement | null,
): Promise<void> {
  const blob =
    (await blobFromDisplayedImage(src, element)) ??
    (await blobFromFetch(src)) ??
    (await blobFromBridge(src));
  if (blob) {
    try {
      const type = clipboardImageType(blob.type);
      await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
      return;
    } catch {
      // 继续退到复制地址
    }
  }
  await copyText(src);
}

function clipboardImageType(mime: string): string {
  const type = mime.trim().toLowerCase();
  if (type === "image/png" || type === "image/jpeg" || type === "image/webp" || type === "image/gif") {
    return type;
  }
  return "image/png";
}

function findDisplayedImage(
  src: string,
  preferred?: HTMLImageElement | null,
): HTMLImageElement | null {
  if (preferred && preferred.naturalWidth > 0) {
    return preferred;
  }
  for (const img of Array.from(document.images)) {
    if ((img.src === src || img.currentSrc === src) && img.naturalWidth > 0) {
      return img;
    }
  }
  return preferred ?? null;
}

function blobFromDisplayedImage(
  src: string,
  preferred?: HTMLImageElement | null,
): Promise<Blob | null> {
  const img = findDisplayedImage(src, preferred);
  if (img == null || img.naturalWidth === 0) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (ctx == null) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch {
      resolve(null);
    }
  });
}

async function blobFromFetch(src: string): Promise<Blob | null> {
  try {
    const response = await fetch(src);
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    return blob.type.startsWith("image/") ? blob : null;
  } catch {
    return null;
  }
}

async function blobFromBridge(src: string): Promise<Blob | null> {
  try {
    const result = await invoke<{ mime?: string; dataBase64?: string }>("fetch_image", {
      request: { url: src },
    });
    const raw = result.dataBase64?.trim() ?? "";
    if (raw.length === 0) {
      return null;
    }
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: clipboardImageType(result.mime ?? "image/png") });
  } catch {
    return null;
  }
}

export function openMemberProfile(userName: string): void {
  const url = `https://fishpi.cn/member/${encodeURIComponent(userName)}`;
  void openUrl(url).catch(() => {
    window.open(url, "_blank", "noopener,noreferrer");
  });
}

export function sendExclusiveRedpacket(userName: string): void {
  dispatchRedpacketSend({ user: userName });
}

export function openPrivateChat(userName: string): void {
  openImWithUser(userName);
}

export function insertMentionToken(userName: string): string {
  return `@${userName} `;
}

/** 旧版 emoji 图短码：从 src 里抠 `:name:`。 */
export function emojiCodeFromSrc(src: string): string | null {
  const match = src.match(/\/([^\/.]+?)(?:\.gif|\.png)(?:\?|$)/i);
  if (match?.[1]) {
    return `:${match[1]}:`;
  }
  return null;
}
