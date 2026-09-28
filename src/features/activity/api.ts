/**
 * 通知 / 活跃度 typed invoke / listen。
 * 命令未注册时抛 BridgeGapError 或返回 unavailable，不得当作签到 / 领奖成功。
 *
 * 约定与 P0 一致：单 DTO 入参叫 `request` 或 `query`。
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { AppInvokeError, parseInvokeError } from "../../lib/errors";
import {
  CHECKIN_NOT_DONE,
  CHECKIN_OK,
  CHECKIN_PENDING,
  CHECKIN_UNAVAILABLE,
  READ_PENDING,
  READ_UNAVAILABLE,
  REWARD_PENDING,
  REWARD_UNAVAILABLE,
} from "./constants";
import {
  BridgeGapError,
  isMissingCommandError,
  isOutcomeUnknown,
  toUserErrorMessage,
} from "./errors";
import type {
  CheckinOutcome,
  NoticeBroadcastEvent,
  NoticeCountDto,
  NoticeEventHandler,
  NoticeItemDto,
  NoticeListQuery,
  NoticeListResult,
  NoticeReadRequest,
  NoticeRefreshEvent,
  NoticeType,
  RewardOutcome,
  WriteOutcome,
} from "./types";
import { NOTICE_COMMAND, NOTICE_EVENT, USER_COMMAND } from "./types";

export type { UnlistenFn };

const missingCommands = new Set<string>();

export function invokeNoticeCount(): Promise<NoticeCountDto> {
  return invokeMapped(NOTICE_COMMAND.count, undefined, mapNoticeCount);
}

export function invokeNoticeList(
  query: NoticeListQuery,
): Promise<NoticeListResult> {
  return invokeMapped(NOTICE_COMMAND.list, { query }, (payload) =>
    mapNoticeList(payload, query.type),
  );
}

export async function invokeNoticeMakeRead(
  request: NoticeReadRequest,
): Promise<WriteOutcome> {
  return invokeWrite(NOTICE_COMMAND.makeRead, { request }, READ_UNAVAILABLE, READ_PENDING, () => ({
    status: "ok",
    message: "已标记该类型通知为已读。",
  }));
}

export async function invokeNoticeReadAll(): Promise<WriteOutcome> {
  return invokeWrite(NOTICE_COMMAND.readAll, undefined, READ_UNAVAILABLE, READ_PENDING, () => ({
    status: "ok",
    message: "已标记全部通知为已读。",
  }));
}

export function invokeUserLiveness(): Promise<number> {
  return invokeMapped(USER_COMMAND.liveness, undefined, mapLiveness);
}

export function invokeUserIsCheckin(): Promise<boolean> {
  return invokeMapped(USER_COMMAND.isCheckin, undefined, (payload) =>
    mapFlag(payload, [
      "checkedIn",
      "isCheckin",
      "checkin",
      "checked_in",
    ]),
  );
}

export function invokeUserIsCollectedLiveness(): Promise<boolean> {
  return invokeMapped(
    USER_COMMAND.isCollectedLiveness,
    undefined,
    (payload) =>
      mapFlag(payload, [
        "isCollectedYesterdayLivenessReward",
        "livenessRewarded",
        "collected",
        "isCollected",
      ]),
  );
}

/**
 * 领取昨日活跃奖励。写操作：不自动重试；结果不确定时返回 outcome_unknown。
 */
export async function invokeUserRewardLiveness(): Promise<RewardOutcome> {
  return invokeWrite(
    USER_COMMAND.rewardLiveness,
    undefined,
    REWARD_UNAVAILABLE,
    REWARD_PENDING,
    (payload) => {
      if (payload == null) {
        return { status: "outcome_unknown", message: REWARD_PENDING };
      }
      return mapRewardOk(payload);
    },
  );
}

/**
 * 签到写操作：调用 `user_checkin`（不是只重查 is_checkin）。
 * 成功且返回 checkedIn=true 才记已签；否则重查 `user_is_checkin` 确认。
 * 命令缺失 / SDK 无写 API 时如实返回，不伪装成功。
 * 写操作：不自动重试；超时 → outcome_unknown。
 */
export async function invokeUserCheckin(): Promise<CheckinOutcome> {
  const outcome = await invokeWrite(
    USER_COMMAND.checkin,
    undefined,
    CHECKIN_UNAVAILABLE,
    CHECKIN_PENDING,
    mapCheckinWriteOk,
  );
  if (outcome.status !== "ok") {
    return outcome;
  }
  if (outcome.checkedIn === true) {
    return outcome;
  }
  // 写调用成功但未带回 checkedIn=true：重查确认，不伪造成功。
  try {
    const checkedIn = await invokeUserIsCheckin();
    if (checkedIn) {
      return { status: "ok", checkedIn: true, message: CHECKIN_OK };
    }
    return { status: "error", checkedIn: false, message: CHECKIN_NOT_DONE };
  } catch {
    return { status: "outcome_unknown", message: CHECKIN_PENDING };
  }
}

function mapCheckinWriteOk(payload: unknown): CheckinOutcome {
  if (payload == null) {
    return {
      status: "outcome_unknown",
      checkedIn: false,
      message: CHECKIN_PENDING,
    };
  }
  const record = asRecord(payload) ?? {};
  const checkedIn =
    asBoolean(record.checkedIn) ?? asBoolean(record.checked_in) ?? false;
  if (checkedIn) {
    return { status: "ok", checkedIn: true, message: CHECKIN_OK };
  }
  return {
    status: "ok",
    checkedIn: false,
    message: "签到请求已提交，正在确认结果。",
  };
}

export async function listenNoticeEvents(
  handler: NoticeEventHandler,
): Promise<UnlistenFn> {
  const unlistens: UnlistenFn[] = [];

  try {
    unlistens.push(
      await listen(NOTICE_EVENT.refresh, (event) => {
        handler({
          event: NOTICE_EVENT.refresh,
          payload: mapRefreshEvent(event.payload),
        });
      }),
    );
    unlistens.push(
      await listen(NOTICE_EVENT.broadcast, (event) => {
        handler({
          event: NOTICE_EVENT.broadcast,
          payload: mapBroadcastEvent(event.payload),
        });
      }),
    );
  } catch (error) {
    unlistens.forEach((unlisten) => unlisten());
    throw toInvokeError(error);
  }

  let stopped = false;
  return () => {
    if (stopped) {
      return;
    }
    stopped = true;
    unlistens.forEach((unlisten) => unlisten());
  };
}

async function invokeWrite<T extends WriteOutcome>(
  command: string,
  args: Record<string, unknown> | undefined,
  unavailable: string,
  pending: string,
  mapOk: (payload: unknown) => T,
): Promise<T | WriteOutcome> {
  if (missingCommands.has(command)) {
    return { status: "unavailable", message: unavailable };
  }
  try {
    const payload = await invoke<unknown>(command, args);
    if (isOutcomeUnknownPayload(payload)) {
      return { status: "outcome_unknown", message: pending };
    }
    return mapOk(payload);
  } catch (error) {
    if (isMissingCommandError(error)) {
      missingCommands.add(command);
      return { status: "unavailable", message: unavailable };
    }
    if (isOutcomeUnknown(error)) {
      return { status: "outcome_unknown", message: pending };
    }
    return { status: "error", message: toUserErrorMessage(error) };
  }
}

async function invokeMapped<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  map: (payload: unknown) => T,
): Promise<T> {
  const payload = await invokeCommand<unknown>(command, args);
  return map(payload);
}

async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (missingCommands.has(command)) {
    throw new BridgeGapError(command);
  }
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (isMissingCommandError(error)) {
      missingCommands.add(command);
      throw new BridgeGapError(command);
    }
    throw toInvokeError(error);
  }
}

function toInvokeError(error: unknown): AppInvokeError {
  if (error instanceof AppInvokeError) {
    return error;
  }
  return new AppInvokeError(parseInvokeError(error));
}

function mapNoticeCount(payload: unknown): NoticeCountDto {
  const record = asRecord(payload) ?? {};
  return {
    sessionGeneration: asNumber(record.sessionGeneration) ?? 0,
    notifyStatus:
      asBoolean(record.notifyStatus) ??
      asBoolean(record.userNotifyStatus) ??
      false,
    count:
      asNumber(record.count) ??
      asNumber(record.unreadNotificationCnt) ??
      asNumber(record.total) ??
      0,
    reply:
      asNumber(record.reply) ??
      asNumber(record.unreadReplyNotificationCnt) ??
      0,
    point:
      asNumber(record.point) ??
      asNumber(record.unreadPointNotificationCnt) ??
      0,
    at: asNumber(record.at) ?? asNumber(record.unreadAtNotificationCnt) ?? 0,
    broadcast:
      asNumber(record.broadcast) ??
      asNumber(record.unreadBroadcastNotificationCnt) ??
      0,
    sysAnnounce:
      asNumber(record.sysAnnounce) ??
      asNumber(record.system) ??
      asNumber(record.unreadSysAnnounceNotificationCnt) ??
      0,
    newFollower:
      asNumber(record.newFollower) ??
      asNumber(record.unreadNewFollowerNotificationCnt) ??
      0,
    following:
      asNumber(record.following) ??
      asNumber(record.unreadFollowingNotificationCnt) ??
      0,
    commented:
      asNumber(record.commented) ??
      asNumber(record.unreadCommentedNotificationCnt) ??
      0,
  };
}

function mapNoticeList(payload: unknown, type: NoticeType): NoticeListResult {
  const record = asRecord(payload);
  const sessionGeneration = record
    ? (asNumber(record.sessionGeneration) ?? 0)
    : 0;
  return {
    sessionGeneration,
    type,
    items: unwrapList(payload)
      .map((item, index) => mapNoticeItem(item, type, index))
      .filter((item): item is NoticeItemDto => item !== null),
  };
}

function mapNoticeItem(
  raw: unknown,
  type: NoticeType,
  index: number,
): NoticeItemDto | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const id =
    asString(record.id) ??
    asString(record.oId) ??
    asString(record.dataId) ??
    `${type}-${index}`;
  const title =
    asString(record.title) ??
    asString(record.commentArticleTitle) ??
    asString(record.articleTitle) ??
    asString(record.category) ??
    "";
  const content = stripTags(
    asString(record.content) ??
      asString(record.commentContent) ??
      asString(record.description) ??
      "",
  );
  if (!title && !content) {
    return null;
  }
  return {
    id,
    type,
    title: title || content,
    content,
    author:
      asString(record.author) ??
      asString(record.commentAuthorName) ??
      asString(record.userName) ??
      asString(record.authorName) ??
      "",
    time:
      asString(record.time) ??
      asString(record.createTime) ??
      asString(record.commentCreateTime) ??
      "",
    hasRead:
      asBoolean(record.hasRead) ?? asBoolean(record.read) ?? false,
  };
}

function mapLiveness(payload: unknown): number {
  if (typeof payload === "number" && Number.isFinite(payload)) {
    return clampPercent(payload);
  }
  const record = asRecord(payload);
  if (!record) {
    return 0;
  }
  const value =
    asNumber(record.liveness) ??
    asNumber(record.value) ??
    asNumber(record.percent) ??
    asNumber(record.data);
  return clampPercent(value ?? 0);
}

function mapFlag(payload: unknown, keys: string[]): boolean {
  if (typeof payload === "boolean") {
    return payload;
  }
  const direct = asBoolean(payload);
  if (direct !== undefined) {
    return direct;
  }
  const record = asRecord(payload);
  if (!record) {
    return false;
  }
  for (const key of keys) {
    const value = asBoolean(record[key]);
    if (value !== undefined) {
      return value;
    }
  }
  if (record.data !== undefined) {
    return mapFlag(record.data, keys);
  }
  return false;
}

function mapRewardOk(payload: unknown): RewardOutcome {
  const sum = readRewardSum(payload);
  if (sum === undefined) {
    return {
      status: "outcome_unknown",
      message: REWARD_PENDING,
    };
  }
  if (sum < 0) {
    return {
      status: "ok",
      sum,
      message: "昨日奖励已领取过。",
    };
  }
  if (sum === 0) {
    return {
      status: "ok",
      sum,
      message: "没有可领取的昨日奖励。",
    };
  }
  return {
    status: "ok",
    sum,
    message: `已领取昨日活跃奖励 ${sum} 积分。`,
  };
}

function readRewardSum(payload: unknown): number | undefined {
  if (typeof payload === "number" && Number.isFinite(payload)) {
    return payload;
  }
  const record = asRecord(payload);
  if (!record) {
    return undefined;
  }
  return (
    asNumber(record.sum) ??
    asNumber(record.point) ??
    asNumber(record.points) ??
    asNumber(record.reward) ??
    asNumber(record.data)
  );
}

function mapRefreshEvent(payload: unknown): NoticeRefreshEvent {
  const record = asRecord(payload);
  if (!record) {
    return { sessionGeneration: 0 };
  }
  return {
    sessionGeneration: asNumber(record.sessionGeneration) ?? 0,
    command: asString(record.command),
    count: asNumber(record.count),
  };
}

function mapBroadcastEvent(payload: unknown): NoticeBroadcastEvent {
  const record = asRecord(payload);
  if (!record) {
    return { sessionGeneration: 0 };
  }
  const nested = asRecord(record.data) ?? record;
  return {
    sessionGeneration: asNumber(record.sessionGeneration) ?? 0,
    content: stripTags(
      asString(nested.content) ?? asString(record.content) ?? "",
    ),
    who: asString(nested.who) ?? asString(record.who),
  };
}

function isOutcomeUnknownPayload(payload: unknown): boolean {
  const record = asRecord(payload);
  if (!record) {
    return false;
  }
  return record.outcomeUnknown === true || record.outcome_unknown === true;
}

function unwrapList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  const record = asRecord(payload);
  if (!record) {
    return [];
  }
  const nested =
    record.items ?? record.notices ?? record.list ?? record.data;
  return Array.isArray(nested) ? nested : [];
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "").trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 1 || value === "1" || value === "true") {
    return true;
  }
  if (value === 0 || value === "0" || value === "false") {
    return false;
  }
  return undefined;
}
