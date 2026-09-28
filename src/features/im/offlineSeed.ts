/**
 * 私聊离线种子：只做展示 hydrate。
 * DesktopMount 负责 live 写入 offline 库；这里只读 snapshot.chats[peer] 并按 ID 合并。
 * 撤回粘滞规则与聊天室一致：已撤回不得被后到历史复活。
 */

import { loadOffline } from "../desktop/offline";
import { mapPrivateMessage } from "./mappers";
import type { PrivateMessageDto } from "./types";

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
    return sortThread(mapped);
  } catch {
    return [];
  }
}

/**
 * 按 ID 合并。
 * `incomingWins`：历史覆盖离线内容用 true；晚到的离线种子补洞用 false。
 * `revoked` 任一为真则保持撤回，后到数据不得复活。
 */
export function mergeThreadMessages(
  current: PrivateMessageDto[],
  incoming: PrivateMessageDto[],
  options?: { incomingWins?: boolean },
): PrivateMessageDto[] {
  const incomingWins = options?.incomingWins !== false;
  const byId = new Map<string, PrivateMessageDto>();
  for (const item of current) {
    byId.set(item.id, item);
  }
  for (const item of incoming) {
    const previous = byId.get(item.id);
    if (previous == null) {
      byId.set(item.id, item);
      continue;
    }
    const merged = incomingWins
      ? { ...previous, ...item }
      : { ...item, ...previous };
    byId.set(item.id, {
      ...merged,
      revoked: previous.revoked || item.revoked,
    });
  }
  return sortThread([...byId.values()]);
}

function sortThread(messages: PrivateMessageDto[]): PrivateMessageDto[] {
  if (messages.length < 2) {
    return messages.slice();
  }
  return messages.slice().sort((left, right) => {
    const byId = compareMessageId(left.id, right.id);
    if (byId !== 0) {
      return byId;
    }
    if (left.time && right.time && left.time !== right.time) {
      return left.time < right.time ? -1 : 1;
    }
    return 0;
  });
}

function compareMessageId(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  try {
    const a = BigInt(left);
    const b = BigInt(right);
    if (a < b) {
      return -1;
    }
    if (a > b) {
      return 1;
    }
    return 0;
  } catch {
    return left < right ? -1 : left > right ? 1 : 0;
  }
}
