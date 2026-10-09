/**
 * 私聊离线种子：只做展示 hydrate。
 * DesktopMount 负责 live 写入 offline 库；这里只读 snapshot.chats[peer] 并按 ID 合并。
 * 撤回粘滞规则与聊天室一致：已撤回不得被后到历史复活。
 */

import { loadOffline } from "../desktop/offline";
import { mapPrivateMessage } from "./mappers";
import type { PrivateMessageDto } from "./types";
import { mergeThreadMessages } from "./threadState";

export { mergeThreadMessages } from "./threadState";

export async function loadOfflineThread(
  peer: string,
): Promise<PrivateMessageDto[]> {
  const trimmed = peer.trim();
  if (trimmed.length === 0) {
    return [];
  }
  try {
    const snapshot = await loadOffline();
    const rows = snapshot.chats?.[trimmed];
    if (!Array.isArray(rows)) {
      return [];
    }
    const mapped = rows
      .map(mapPrivateMessage)
      .filter((item): item is PrivateMessageDto => item != null);
    return mergeThreadMessages([], mapped);
  } catch {
    return [];
  }
}
