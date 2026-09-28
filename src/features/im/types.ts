/**
 * 私聊前后端契约（camelCase，对齐 P0 DTO 风格）。
 *
 * 按即将存在的 Bridge 同名 command / event invoke / listen；
 * 命令缺失时不得伪装发送成功。字段以 SDK ChatData / ChatNotice 为基准。
 */

import type { SendResult } from "../../lib/types";

export type { SendResult };

export const CHAT_COMMAND = {
  list: "chat_list",
  unread: "chat_unread",
  history: "chat_history",
  send: "chat_send",
  markRead: "chat_mark_read",
  connect: "chat_connect",
  disconnect: "chat_disconnect",
  revoke: "chat_revoke",
} as const;

export const USER_COMMAND = {
  search: "user_search",
} as const;

export const CHAT_EVENT = {
  msg: "chat://msg",
  notice: "chat://notice",
  revoke: "chat://revoke",
} as const;

export const NOTICE_EVENT = {
  refresh: "notice://refresh",
  broadcast: "notice://broadcast",
} as const;

/** 会话列表项。peer 由当前登录用户与 sender/receiver 推得。 */
export interface ChatConversationDto {
  id?: string;
  senderUserName: string;
  receiverUserName: string;
  senderAvatarUrl: string;
  receiverAvatarUrl: string;
  preview?: string;
  time?: string;
  unread: number;
}

export interface ChatListResult {
  sessionGeneration: number;
  conversations: ChatConversationDto[];
}

export interface ChatUnreadResult {
  sessionGeneration: number;
  messages: ChatConversationDto[];
}

export interface PrivateMessageDto {
  id: string;
  md?: string;
  text?: string;
  userName: string;
  userNickname?: string;
  userAvatarUrl: string;
  time: string;
  revoked: boolean;
}

/** 私聊引用回复目标：展示名 + 正文首行。 */
export type ReplyTarget = {
  id: string;
  displayName: string;
  body: string;
};

export interface ChatHistoryQuery {
  userName: string;
  page?: number;
  size?: number;
}

export interface ChatHistoryResult {
  sessionGeneration: number;
  messages: PrivateMessageDto[];
  exhausted?: boolean;
}

export interface ChatSendRequest {
  userName: string;
  content: string;
}

/** `chat_revoke` 入参。消息 ID 用字符串。 */
export interface ChatRevokeRequest {
  id: string;
}

export interface ChatUserRequest {
  userName: string;
}

/** `userName` 缺省表示全局通知频道（SDK `chat().connect(None)`）。 */
export interface ChatConnectRequest {
  userName?: string;
}

export interface ChatConnectResult {
  sessionGeneration: number;
  connectionGeneration?: number;
}

export interface UserSearchRequest {
  query: string;
}

export interface UserSearchHit {
  userName: string;
  userAvatarUrl: string;
}

export interface UserSearchResult {
  sessionGeneration?: number;
  users: UserSearchHit[];
}

export interface ChatMessageEvent {
  sessionGeneration: number;
  connectionGeneration?: number;
  userName?: string;
  message: PrivateMessageDto;
}

export interface ChatNoticeEvent {
  sessionGeneration: number;
  command: string;
  count?: number;
  senderUserName?: string;
  senderAvatarUrl?: string;
  preview?: string;
}

export interface ChatRevokeEvent {
  sessionGeneration: number;
  messageId: string;
  userName?: string;
}

export interface NoticeBroadcastEvent {
  sessionGeneration: number;
  content?: string;
  who?: string;
}

export type ChatListenEvent =
  | { event: typeof CHAT_EVENT.msg; payload: ChatMessageEvent }
  | { event: typeof CHAT_EVENT.notice; payload: ChatNoticeEvent }
  | { event: typeof CHAT_EVENT.revoke; payload: ChatRevokeEvent }
  | { event: typeof NOTICE_EVENT.refresh; payload: ChatNoticeEvent }
  | { event: typeof NOTICE_EVENT.broadcast; payload: NoticeBroadcastEvent };

export type ChatEventHandler = (event: ChatListenEvent) => void;

export interface Conversation {
  peerUserName: string;
  peerAvatarUrl: string;
  preview: string;
  time: string;
  unread: number;
}

export const NOTICE_COMMAND = {
  unreadRefresh: "chatUnreadCountRefresh",
  idleMessage: "newIdleChatMessage",
  refreshNotification: "refreshNotification",
  warnBroadcast: "warnBroadcast",
} as const;
