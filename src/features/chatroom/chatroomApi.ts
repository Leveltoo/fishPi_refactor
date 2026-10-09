import { invoke } from "@tauri-apps/api/core";
import { AppInvokeError, isAppError, parseInvokeError } from "../../lib/errors";
import type { SendResult } from "../../lib/types";
import type { CloudEmojiSnapshot } from "./cloudEmojiLogic";

export type ShieldKind = "username" | "content" | "redpacket";

export type ShieldRule = {
  type: ShieldKind;
  value: string;
};

export type ChatroomFilters = {
  shield: ShieldRule[];
  careUsers: string[];
};

export type RecentEmojiKind = "shortcode" | "image";

export type RecentEmoji = {
  kind: RecentEmojiKind;
  value: string;
};

export type EmojiGroup = {
  id: string;
  name: string;
  sort: number;
  isDefault: boolean;
};

export type EmojiItem = {
  id: string;
  emojiId: string;
  groupId: string;
  name: string;
  url: string;
  sort: number;
};

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw parseInvokeError(error);
  }
}

export function loadChatroomFilters(): Promise<ChatroomFilters> {
  return call("chatroom_filters_get");
}

export function saveChatroomFilters(
  filters: ChatroomFilters,
): Promise<ChatroomFilters> {
  return call("chatroom_filters_set", { request: filters });
}

export function loadRecentEmoji(): Promise<RecentEmoji[]> {
  return call("chatroom_emoji_recent_get");
}

export function rememberRecentEmoji(item: RecentEmoji): Promise<RecentEmoji[]> {
  return call("chatroom_emoji_recent_remember", { request: item });
}

const unconfirmedCloudWrites = new Set<number>();
let cloudWriteRevision = 0;

export function loadCloudEmoji(): Promise<CloudEmojiSnapshot> {
  return call("emoji_cloud_get");
}

/** Only a deliberate read-only favorites refresh unlocks an uncertain write. */
export async function refreshCloudEmoji(): Promise<CloudEmojiSnapshot> {
  const revision = cloudWriteRevision;
  const snapshot = await loadCloudEmoji();
  if (revision === cloudWriteRevision) {
    unconfirmedCloudWrites.delete(snapshot.sessionGeneration);
  }
  return snapshot;
}

async function cloudWrite(
  snapshot: CloudEmojiSnapshot,
  command: "emoji_cloud_append" | "emoji_cloud_remove",
  request: Record<string, unknown>,
): Promise<CloudEmojiSnapshot> {
  if (unconfirmedCloudWrites.has(snapshot.sessionGeneration)) {
    throw new AppInvokeError({ code: "outcome_unknown", message: "请先刷新收藏确认上次操作结果" });
  }
  try {
    return await call(command, { request: { sessionGeneration: snapshot.sessionGeneration, ...request } });
  } catch (err) {
    if (isAppError(err) && err.code === "outcome_unknown") {
      cloudWriteRevision += 1;
      unconfirmedCloudWrites.add(snapshot.sessionGeneration);
    }
    throw err;
  }
}

export function appendCloudEmoji(
  snapshot: CloudEmojiSnapshot,
  urls: string[],
): Promise<CloudEmojiSnapshot> {
  return cloudWrite(snapshot, "emoji_cloud_append", { urls });
}

export function removeCloudEmoji(
  snapshot: CloudEmojiSnapshot,
  url: string,
): Promise<CloudEmojiSnapshot> {
  return cloudWrite(snapshot, "emoji_cloud_remove", { url });
}

export function loadEmojiGroups(): Promise<EmojiGroup[]> {
  return call("emoji_groups");
}

export function loadEmojiGroupItems(groupId: string): Promise<EmojiItem[]> {
  return call("emoji_group_items", { request: { groupId } });
}

export function addEmojiUrl(
  url: string,
  groupId?: string,
): Promise<void> {
  return call("emoji_add_url", {
    request: {
      url,
      ...(groupId ? { groupId } : {}),
    },
  });
}

export function removeEmoji(groupId: string, emojiId: string): Promise<void> {
  return call("emoji_remove", { request: { groupId, emojiId } });
}

export function lookupUserName(userName: string): Promise<string> {
  return call<{ userName: string }>("user_profile", {
    request: { userName },
  }).then((result) => result.userName);
}

export type BarragerRequest = {
  content: string;
  color?: string;
};

/**
 * 发弹幕。成功只表示已接受，不带消息 ID；不自动重试。
 */
export function sendChatroomBarrager(
  request: BarragerRequest,
): Promise<SendResult> {
  return call<SendResult>("chatroom_barrager", { request });
}

export type BarrageCost = {
  cost: number;
  unit: string;
};

/** 发弹幕费用（`chat-room/barrager/get`），用于 Dialog 文案展示。 */
export function fetchChatroomBarrageCost(): Promise<BarrageCost> {
  return call<BarrageCost>("chatroom_barrage_cost");
}

/** 服务端消息原文（对齐旧 `chatroom.raw`）。 */
export function fetchChatroomRaw(messageId: string): Promise<string> {
  return call("chatroom_raw", { request: { messageId } });
}
