/**
 * 通知 / 活跃度 / 签到契约（camelCase，对齐 P0 DTO）。
 *
 * src-tauri 尚未注册这些 command；本 feature 按此形状 invoke / listen。
 * 命令缺失时不得伪装签到或领奖成功。
 */

export const NOTICE_COMMAND = {
  count: "notice_count",
  list: "notice_list",
  makeRead: "notice_make_read",
  readAll: "notice_read_all",
} as const;

export const USER_COMMAND = {
  liveness: "user_liveness",
  isCheckin: "user_is_checkin",
  /** 签到写操作。与 `isCheckin` 查询命令分开。 */
  checkin: "user_checkin",
  isCollectedLiveness: "user_is_collected_liveness",
  rewardLiveness: "user_reward_liveness",
} as const;

export const NOTICE_EVENT = {
  refresh: "notice://refresh",
  broadcast: "notice://broadcast",
} as const;

/** 与 SDK `NoticeType::as_str` 一致；broadcast 不支持列表。 */
export type NoticeType =
  | "point"
  | "commented"
  | "reply"
  | "at"
  | "following"
  | "sys-announce";

export interface NoticeCountDto {
  sessionGeneration: number;
  notifyStatus: boolean;
  count: number;
  reply: number;
  point: number;
  at: number;
  broadcast: number;
  sysAnnounce: number;
  newFollower: number;
  following: number;
  commented: number;
}

export interface NoticeListQuery {
  type: NoticeType;
}

export interface NoticeReadRequest {
  type: NoticeType;
}

export interface NoticeItemDto {
  id: string;
  type: NoticeType;
  title: string;
  content: string;
  author: string;
  time: string;
  hasRead: boolean;
}

export interface NoticeListResult {
  sessionGeneration: number;
  type: NoticeType;
  items: NoticeItemDto[];
}

export interface NoticeRefreshEvent {
  sessionGeneration: number;
  command?: string;
  count?: number;
}

export interface NoticeBroadcastEvent {
  sessionGeneration: number;
  content?: string;
  who?: string;
}

export type NoticeListenEvent =
  | { event: typeof NOTICE_EVENT.refresh; payload: NoticeRefreshEvent }
  | { event: typeof NOTICE_EVENT.broadcast; payload: NoticeBroadcastEvent };

export type NoticeEventHandler = (event: NoticeListenEvent) => void;

export type WriteOutcome =
  | { status: "ok"; message: string }
  | { status: "outcome_unknown"; message: string }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

export type CheckinOutcome = WriteOutcome & { checkedIn?: boolean };

export type RewardOutcome = WriteOutcome & { sum?: number };
