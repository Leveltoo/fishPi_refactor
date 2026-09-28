/**
 * 聊天室 / 私聊右键共用动作：@、单独聊聊、访问主页、复制地址、专属红包。
 * 打开主页走 opener（系统浏览器）；红包只派发事件，不 import overlay。
 */

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

export async function copyImageFromSrc(src: string): Promise<void> {
  try {
    const response = await fetch(src);
    const blob = await response.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type || "image/png"]: blob }),
    ]);
    return;
  } catch {
    await copyText(src);
  }
}

export function openMemberProfile(userName: string): void {
  const url = `https://fishpi.cn/member/${encodeURIComponent(userName)}`;
  void openUrl(url).catch(() => {
    window.open(url, "_blank", "noopener,noreferrer");
  });
}

export function sendExclusiveRedpacket(userName: string): void {
  dispatchRedpacketSend({ userName });
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
