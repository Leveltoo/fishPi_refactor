import type {
  ChatConversationDto,
  ChatMessageEvent,
  ChatNoticeEvent,
  ChatRevokeEvent,
  NoticeBroadcastEvent,
  PrivateMessageDto,
  UserSearchHit,
} from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function mapConversation(raw: unknown): ChatConversationDto | null {
  if (!isRecord(raw)) {
    return null;
  }
  const senderUserName =
    asString(raw.senderUserName) ?? asString(raw.sender_user_name);
  const receiverUserName =
    asString(raw.receiverUserName) ?? asString(raw.receiver_user_name);
  if (!senderUserName || !receiverUserName) {
    const peer = asString(raw.userName) ?? asString(raw.peerUserName);
    if (!peer) {
      return null;
    }
    return {
      senderUserName: peer,
      receiverUserName: peer,
      senderAvatarUrl:
        asString(raw.senderAvatarUrl) ??
        asString(raw.userAvatarUrl) ??
        asString(raw.senderAvatar) ??
        "",
      receiverAvatarUrl:
        asString(raw.receiverAvatarUrl) ??
        asString(raw.receiverAvatar) ??
        "",
      preview: asString(raw.preview) ?? asString(raw.content),
      time: asString(raw.time),
      unread: asNumber(raw.unread) ?? 0,
      id: asString(raw.id) ?? asString(raw.oId),
    };
  }
  return {
    id: asString(raw.id) ?? asString(raw.oId),
    senderUserName,
    receiverUserName,
    senderAvatarUrl:
      asString(raw.senderAvatarUrl) ?? asString(raw.senderAvatar) ?? "",
    receiverAvatarUrl:
      asString(raw.receiverAvatarUrl) ?? asString(raw.receiverAvatar) ?? "",
    preview:
      asString(raw.preview) ?? asString(raw.markdown) ?? asString(raw.content),
    time: asString(raw.time),
    unread: asNumber(raw.unread) ?? 0,
  };
}

export function mapPrivateMessage(raw: unknown): PrivateMessageDto | null {
  if (!isRecord(raw)) {
    return null;
  }
  const nested = isRecord(raw.message) ? raw.message : raw;
  const id = asString(nested.id) ?? asString(nested.oId);
  if (!id) {
    return null;
  }
  const userName =
    asString(nested.userName) ?? asString(nested.senderUserName) ?? "";
  return {
    id,
    md: asString(nested.md) ?? asString(nested.markdown),
    text:
      asString(nested.text) ??
      asString(nested.content) ??
      asString(nested.preview),
    userName,
    userNickname: asString(nested.userNickname),
    userAvatarUrl:
      asString(nested.userAvatarUrl) ??
      asString(nested.senderAvatarUrl) ??
      asString(nested.senderAvatar) ??
      "",
    time: asString(nested.time) ?? "",
    revoked: asBoolean(nested.revoked) ?? false,
  };
}

export function mapSearchHit(raw: unknown): UserSearchHit | null {
  if (!isRecord(raw)) {
    return null;
  }
  const userName =
    asString(raw.userName) ?? asString(raw.username) ?? asString(raw.user_name);
  if (!userName) {
    return null;
  }
  return {
    userName,
    userAvatarUrl:
      asString(raw.userAvatarUrl) ??
      asString(raw.avatar) ??
      asString(raw.userAvatarURL48) ??
      "",
  };
}

export function mapMessageEvent(payload: unknown): ChatMessageEvent | null {
  if (!isRecord(payload)) {
    return null;
  }
  const message = mapPrivateMessage(payload);
  if (!message) {
    return null;
  }
  return {
    sessionGeneration: asNumber(payload.sessionGeneration) ?? 0,
    connectionGeneration: asNumber(payload.connectionGeneration),
    userName:
      asString(payload.userName) ??
      asString(payload.toUser) ??
      message.userName,
    message,
  };
}

export function mapNoticeEvent(payload: unknown): ChatNoticeEvent | null {
  if (!isRecord(payload)) {
    return null;
  }
  const command = asString(payload.command);
  if (!command) {
    return null;
  }
  return {
    sessionGeneration: asNumber(payload.sessionGeneration) ?? 0,
    command,
    count: asNumber(payload.count),
    senderUserName:
      asString(payload.senderUserName) ?? asString(payload.userName),
    senderAvatarUrl:
      asString(payload.senderAvatarUrl) ?? asString(payload.senderAvatar),
    preview: asString(payload.preview) ?? asString(payload.content),
  };
}

export function mapRevokeEvent(payload: unknown): ChatRevokeEvent | null {
  if (!isRecord(payload)) {
    return null;
  }
  const messageId =
    asString(payload.messageId) ??
    asString(payload.id) ??
    asString(payload.data);
  if (!messageId) {
    return null;
  }
  return {
    sessionGeneration: asNumber(payload.sessionGeneration) ?? 0,
    messageId,
    userName: asString(payload.userName),
  };
}

export function mapBroadcastEvent(payload: unknown): NoticeBroadcastEvent {
  if (!isRecord(payload)) {
    return { sessionGeneration: 0 };
  }
  return {
    sessionGeneration: asNumber(payload.sessionGeneration) ?? 0,
    content: asString(payload.content),
    who: asString(payload.who),
  };
}

export function unwrapList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isRecord(payload)) {
    return [];
  }
  const nested =
    payload.conversations ??
    payload.messages ??
    payload.users ??
    payload.data;
  return Array.isArray(nested) ? nested : [];
}

export function readSessionGeneration(payload: unknown): number {
  if (!isRecord(payload)) {
    return 0;
  }
  return asNumber(payload.sessionGeneration) ?? 0;
}

export function readExhausted(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }
  return asBoolean(payload.exhausted) ?? false;
}
