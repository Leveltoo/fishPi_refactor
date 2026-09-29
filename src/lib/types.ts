/**
 * 前后端 IPC 契约（camelCase 字段名与 Rust DTO 对齐）。
 *
 * SDK domain 大多不能 serde，Bridge 只映射 P0 需要的字段。
 * 出站载荷禁止出现 apiKey / token / password / mfa。
 * 消息 ID 用 string：服务端 oId 是雪花数字串，JS number 会丢精度。
 */

/** 结构化错误码。与 Bridge 约定为 snake_case，不用 camelCase，避免和字段名风格混淆。 */
export type AppErrorCode =
  | "unauthorized"
  | "verification_required"
  | "rate_limited"
  | "network"
  | "business"
  | "outcome_unknown"
  | "credential_storage";

/**
 * invoke 失败时的结构化错误。
 * `message` 应由 Bridge 脱敏；前端展示请走 `formatAppErrorMessage`，不要把原始字符串当堆栈。
 */
export interface AppError {
  code: AppErrorCode;
  message: string;
  retryAfterMs?: number;
  credentialSaved?: boolean;
}

/** 登录入参。明文密码只走这一次 invoke，前端不做 MD5。 */
export interface LoginRequest {
  username: string;
  password: string;
  mfaCode?: string;
}

/** 当前用户摘要。不含 token、邮箱或勋章。 */
export interface UserSummary {
  userName: string;
  userNickname: string;
  userAvatarUrl: string;
  userNo: string;
  role: string;
}

/** 登录或恢复成功后的会话快照。`credentialSaved` 只表示系统凭据存储结果。 */
export interface AuthSession {
  sessionGeneration: number;
  user: UserSummary;
  credentialSaved: boolean;
  persistWarning?: string;
}

/**
 * `auth_me` 的会话阶段。
 * `limitedNetwork` 表示凭据仍在，只是暂时不可用或需要访客验证，不能当成未登录去清 token。
 */
export type AuthStatus =
  | "loggedOut"
  | "restoring"
  | "limitedNetwork"
  | "loggedIn";

export interface AuthMe {
  sessionGeneration: number;
  status: AuthStatus;
  user?: UserSummary;
  credentialSaved: boolean;
}

/**
 * `auth_restore` 分类结果。内部标签 `kind`；`authenticated` 摊开 AuthSession 字段。
 */
export type RestoreOutcome =
  | { kind: "noSession" }
  | ({ kind: "authenticated" } & AuthSession)
  | { kind: "unauthorized" }
  | { kind: "temporarilyUnavailable" }
  | { kind: "verificationRequired" };

export type RestoreResult = RestoreOutcome;

/**
 * `auth_logout` 返回。内存会话必须先失效；`credentialCleared` 为 false 时不得宣称已持久退出。
 */
export interface LogoutResult {
  sessionGeneration: number;
  credentialCleared: boolean;
  persistWarning?: string;
}

/**
 * 消息类别。历史 content.msgType 与实时事件变体都映射到这里。
 * 音乐 / 天气 / 红包 P0 只给安全摘要，不引入播放器。
 */
export type ChatMessageKind =
  | "msg"
  | "music"
  | "weather"
  | "redpacket"
  | "barrager"
  | "custom"
  | "unknown";

/**
 * 聊天室消息（历史与实时同一形状）。
 * `md` 是 Markdown 原文（复制 / 回复 / 复读）；`text` 在 Html 模式下是服务端 HTML。
 * `rawHint` 是特殊消息的纯文本摘要，不是原始 JSON，更不能当 HTML。
 */
export type RedpacketWhoDto = {
  userName: string;
  userId?: string;
  avatar: string;
};

export type RedpacketCardDto = {
  type: string;
  msg: string;
  money: number;
  got: number;
  count: number;
  recivers?: string[];
  who?: RedpacketWhoDto[];
};

export interface ChatMessageDto {
  id: string;
  kind: ChatMessageKind;
  md?: string;
  text?: string;
  userName: string;
  userNickname: string;
  userAvatarUrl: string;
  time: string;
  revoked: boolean;
  rawHint?: string;
  redpacket?: RedpacketCardDto;
}

export interface OnlineUser {
  userName: string;
  userAvatarUrl: string;
}

/**
 * `chatroom://online`
 *
 * `onlineCount` 必须用服务端人数。不得用 `users.length` 覆盖：列表可能被截断或为空。
 */
export interface OnlineEvent {
  sessionGeneration: number;
  connectionGeneration: number;
  users: OnlineUser[];
  discussing?: string;
  onlineCount?: number;
}

/** `chatroom://discuss`。空字符串表示清空话题，这是合法状态。 */
export interface DiscussEvent {
  sessionGeneration: number;
  connectionGeneration: number;
  discussing: string;
}

/** `chatroom://revoke`。允许先于对应历史消息到达。 */
export interface RevokeEvent {
  sessionGeneration: number;
  connectionGeneration: number;
  messageId: string;
}

/** `chatroom://redpacket-status`。领取人头像优先用事件里的 URL。 */
export interface RedpacketStatusEvent {
  sessionGeneration: number;
  connectionGeneration: number;
  messageId: string;
  count: number;
  got: number;
  whoGive: string;
  whoGot?: string[];
  whoGotAvatar?: string;
}

/**
 * Bridge 已证实的连接状态，不是 SDK on_open 直通。
 * 观测不到就必须是 `unknown`，不能用「暂时没消息」推断离线。
 */
export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "unknown"
  | "disconnected"
  | "reconnecting";

/** `chatroom://connection`，也作为 `chatroom_connect` 的返回值。 */
export interface ConnectionEvent {
  sessionGeneration: number;
  connectionGeneration: number;
  status: ConnectionStatus;
}

export type ChatroomConnectResult = ConnectionEvent;

/**
 * `chatroom://msg`：ChatMessageDto 字段摊开，并带上代次。
 */
export type ChatMessageEvent = ChatMessageDto & {
  sessionGeneration: number;
  connectionGeneration: number;
};

/** 历史锚点方位，对应 SDK ChatRoomMessageMode。 */
export type HistoryMode = "before" | "after" | "context";

/**
 * `chatroom_history` 查询。
 * `page` 与 `aroundId` 互斥：有页码走 history(page, Markdown)，有锚点走 msg_around。
 */
export interface HistoryQuery {
  page?: number;
  aroundId?: string;
  mode?: HistoryMode;
  size?: number;
}

export interface HistoryResult {
  sessionGeneration: number;
  connectionGeneration?: number;
  messages: ChatMessageDto[];
  exhausted?: boolean;
}

export interface SendRequest {
  content: string;
}

/**
 * 发送结果。`accepted` 只表示请求已被接受，不带服务端消息 ID。
 * 不要据此伪造本地已确认气泡；超时且无法确认时 `outcomeUnknown`。
 */
export interface SendResult {
  sessionGeneration: number;
  accepted: boolean;
  outcomeUnknown: boolean;
}

export interface RevokeRequest {
  messageId: string;
}

export const AUTH_COMMAND = {
  login: "auth_login",
  restore: "auth_restore",
  logout: "auth_logout",
  me: "auth_me",
} as const;

export const CHATROOM_COMMAND = {
  connect: "chatroom_connect",
  disconnect: "chatroom_disconnect",
  send: "chatroom_send",
  history: "chatroom_history",
  revoke: "chatroom_revoke",
} as const;

export const CHATROOM_EVENT = {
  online: "chatroom://online",
  discuss: "chatroom://discuss",
  msg: "chatroom://msg",
  revoke: "chatroom://revoke",
  redpacketStatus: "chatroom://redpacket-status",
  connection: "chatroom://connection",
} as const;

export type ChatroomEventName =
  (typeof CHATROOM_EVENT)[keyof typeof CHATROOM_EVENT];

export type ChatroomListenEvent =
  | { event: typeof CHATROOM_EVENT.online; payload: OnlineEvent }
  | { event: typeof CHATROOM_EVENT.discuss; payload: DiscussEvent }
  | { event: typeof CHATROOM_EVENT.msg; payload: ChatMessageEvent }
  | { event: typeof CHATROOM_EVENT.revoke; payload: RevokeEvent }
  | {
      event: typeof CHATROOM_EVENT.redpacketStatus;
      payload: RedpacketStatusEvent;
    }
  | { event: typeof CHATROOM_EVENT.connection; payload: ConnectionEvent };

export type ChatroomEventHandler = (event: ChatroomListenEvent) => void;
