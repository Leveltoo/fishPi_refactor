import { mapConversation } from "./mappers";
import type { ChatConversationDto, Conversation } from "./types";

export function peerUserName(
  item: ChatConversationDto,
  selfUserName: string | null,
): string {
  if (selfUserName && item.senderUserName === selfUserName) {
    return item.receiverUserName;
  }
  if (selfUserName && item.receiverUserName === selfUserName) {
    return item.senderUserName;
  }
  return item.senderUserName;
}

export function peerAvatarUrl(
  item: ChatConversationDto,
  selfUserName: string | null,
): string {
  if (selfUserName && item.senderUserName === selfUserName) {
    return item.receiverAvatarUrl;
  }
  if (selfUserName && item.receiverUserName === selfUserName) {
    return item.senderAvatarUrl;
  }
  return item.senderAvatarUrl;
}

export function toConversation(
  item: ChatConversationDto,
  selfUserName: string | null,
): Conversation {
  return {
    peerUserName: peerUserName(item, selfUserName),
    peerAvatarUrl: peerAvatarUrl(item, selfUserName),
    preview: item.preview?.trim() ?? "",
    time: item.time ?? "",
    unread: item.unread,
  };
}

export function conversationsFrom(
  items: unknown[],
  selfUserName: string | null,
): Conversation[] {
  const result: Conversation[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const mapped = mapConversation(raw);
    if (!mapped) {
      continue;
    }
    const conversation = toConversation(mapped, selfUserName);
    if (conversation.peerUserName.length === 0 || seen.has(conversation.peerUserName)) {
      continue;
    }
    seen.add(conversation.peerUserName);
    result.push(conversation);
  }
  return result;
}

export function upsertConversation(
  list: Conversation[],
  next: Conversation,
): Conversation[] {
  const index = list.findIndex((item) => item.peerUserName === next.peerUserName);
  if (index < 0) {
    return [next, ...list];
  }
  const merged: Conversation = {
    ...list[index],
    ...next,
    unread: next.unread,
    preview: next.preview || list[index].preview,
    time: next.time || list[index].time,
    peerAvatarUrl: next.peerAvatarUrl || list[index].peerAvatarUrl,
  };
  const rest = list.filter((_, i) => i !== index);
  return [merged, ...rest];
}

export function applyUnreadCounts(
  list: Conversation[],
  unreadItems: Conversation[],
): Conversation[] {
  const counts = new Map<string, Conversation>();
  for (const item of unreadItems) {
    const prev = counts.get(item.peerUserName);
    counts.set(item.peerUserName, {
      ...item,
      unread: (prev?.unread ?? 0) + Math.max(1, item.unread),
    });
  }
  const seen = new Set<string>();
  const next = list.map((item) => {
    seen.add(item.peerUserName);
    const unread = counts.get(item.peerUserName);
    if (!unread) {
      return { ...item, unread: 0 };
    }
    return {
      ...item,
      unread: unread.unread,
      preview: unread.preview || item.preview,
      time: unread.time || item.time,
      peerAvatarUrl: unread.peerAvatarUrl || item.peerAvatarUrl,
    };
  });
  for (const item of counts.values()) {
    if (!seen.has(item.peerUserName)) {
      next.push(item);
    }
  }
  return next;
}

export function bumpUnread(
  list: Conversation[],
  peerUserName: string,
  delta: number,
  extras?: Partial<Conversation>,
): Conversation[] {
  const index = list.findIndex((item) => item.peerUserName === peerUserName);
  if (index < 0) {
    return upsertConversation(list, {
      peerUserName,
      peerAvatarUrl: extras?.peerAvatarUrl ?? "",
      preview: extras?.preview ?? "",
      time: extras?.time ?? "",
      unread: Math.max(0, delta),
    });
  }
  const current = list[index];
  const next: Conversation = {
    ...current,
    ...extras,
    unread: Math.max(0, current.unread + delta),
    preview: extras?.preview || current.preview,
    peerAvatarUrl: extras?.peerAvatarUrl || current.peerAvatarUrl,
  };
  const rest = list.filter((_, i) => i !== index);
  return [next, ...rest];
}

export function clearUnread(list: Conversation[], peerUserName: string): Conversation[] {
  return list.map((item) =>
    item.peerUserName === peerUserName ? { ...item, unread: 0 } : item,
  );
}

export function filterConversations(
  list: Conversation[],
  query: string,
): Conversation[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return list;
  }
  return list.filter((item) => item.peerUserName.toLowerCase().includes(needle));
}
