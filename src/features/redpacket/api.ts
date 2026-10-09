import { invoke } from "@tauri-apps/api/core";
import type { AuthMe, SendResult } from "../../lib/types";

import { DEFAULT_BLESSING } from "./constants";
import {
  isCommandUnavailable,
  isOutcomeUnknown,
  toUserFacingMessage,
} from "./errors";
import type {
  GestureIndex,
  OpenOutcome,
  OpenRedPacketRequest,
  RedPacketGot,
  RedPacketInfo,
  SendOutcome,
  SendRedPacketRequest,
} from "./types";
import { validateSendForm } from "./sendForm";
import { parseGesture } from "./events";

/**
 * 本 feature 内封装的 invoke 名。
 * 开包和发送均走红包 command，写操作不重试。
 * command 未注册时返回 unavailable，不假装领取成功。
 */
export const REDPACKET_COMMAND = {
  open: "redpacket_open",
  send: "redpacket_send",
  me: "auth_me",
} as const;

const OPEN_UNAVAILABLE =
  "开红包命令尚未接入，本次没有真正领取。";
const SEND_UNAVAILABLE =
  "发红包请求未能发到桌面端 Bridge，本次没有发出。";
const SEND_ACCEPTED = "红包请求已接受，请在聊天室等待回显，不要重复发送。";
const SEND_PENDING = "结果待确认。请稍后在聊天室核对，请勿重复提交。";

export async function openRedPacket(
  request: OpenRedPacketRequest,
): Promise<OpenOutcome> {
  if (!/^\d+$/.test(request.oId) ||
    (request.gesture !== undefined && parseGesture(request.gesture) === undefined)) {
    return { status: "error", message: "红包 ID 或猜拳手势无效" };
  }
  let submitted = false;
  try {
    const before = await requireSelfSession();
    submitted = true;
    const payload = await invoke<unknown>(REDPACKET_COMMAND.open, {
      request: { ...request, expectedSessionGeneration: before.sessionGeneration },
    });
    const data = parseOpenPayload(payload);
    if (!data) {
      return {
        status: "outcome_unknown",
        message: "开红包返回无法识别，请稍后在聊天室核对。",
      };
    }
    const after = await requireSelfSession();
    if (before.sessionGeneration !== data.sessionGeneration ||
      before.sessionGeneration !== after.sessionGeneration) {
      return { status: "outcome_unknown", message: SEND_PENDING };
    }
    return { status: "ok", data, selfUserName: after.user!.userName };
  } catch (error) {
    if (isCommandUnavailable(error)) {
      return { status: "unavailable", message: OPEN_UNAVAILABLE };
    }
    if (isOutcomeUnknown(error)) {
      return { status: "outcome_unknown", message: SEND_PENDING };
    }
    if (submitted && isSessionReadError(error)) {
      return { status: "outcome_unknown", message: SEND_PENDING };
    }
    return { status: "error", message: toUserFacingMessage(error) };
  }
}

export async function sendRedPacket(
  request: SendRedPacketRequest,
): Promise<SendOutcome> {
  const validated = validateSendForm({
    type: request.type,
    money: String(request.money),
    count: String(request.count),
    message: request.msg,
    receivers: request.recivers,
    receiverDraft: "",
    gesture: request.gesture ?? 0,
  });
  if (!validated.ok || (request.type === "rockPaperScissors" && request.gesture === undefined)) {
    return { status: "error", message: validated.ok ? "请先选择猜拳手势" :
      Object.values(validated.errors)[0] ?? "红包参数无效" };
  }
  let submitted = false;
  try {
    const before = await requireSelfSession();
    submitted = true;
    const result = await invoke<SendResult>(REDPACKET_COMMAND.send, {
      request: { ...validated.request, expectedSessionGeneration: before.sessionGeneration },
    });

    if (result?.outcomeUnknown) {
      return { status: "outcome_unknown", message: SEND_PENDING };
    }
    if (result?.accepted === true) {
      const after = await requireSelfSession();
      if (before.sessionGeneration !== result.sessionGeneration ||
        before.sessionGeneration !== after.sessionGeneration) {
        return { status: "outcome_unknown", message: SEND_PENDING };
      }
      return { status: "accepted", message: SEND_ACCEPTED };
    }
    return {
      status: "outcome_unknown",
      message: SEND_PENDING,
    };
  } catch (error) {
    if (isCommandUnavailable(error)) {
      return { status: "unavailable", message: SEND_UNAVAILABLE };
    }
    if (isOutcomeUnknown(error)) {
      return { status: "outcome_unknown", message: SEND_PENDING };
    }
    if (submitted && isSessionReadError(error)) {
      return { status: "outcome_unknown", message: SEND_PENDING };
    }
    return { status: "error", message: toUserFacingMessage(error) };
  }
}

export async function readSelfSession(): Promise<AuthMe | null> {
  try {
    return await requireSelfSession();
  } catch {
    return null;
  }
}

async function requireSelfSession(): Promise<AuthMe> {
  let me: AuthMe;
  try {
    me = await invoke<AuthMe>(REDPACKET_COMMAND.me);
  } catch {
    throw { code: "unauthorized", message: "登录状态无法确认", sessionRead: true };
  }
  if (me.status !== "loggedIn" || !me.user?.userName || me.sessionGeneration <= 0) {
    throw { code: "unauthorized", message: "请先登录", sessionRead: true };
  }
  return me;
}

function isSessionReadError(error: unknown): boolean {
  return asRecord(error)?.sessionRead === true;
}

export function encodeRedPacketMessage(request: SendRedPacketRequest): string {
  const body: Record<string, unknown> = {
    type: request.type,
    money: request.money,
    count: request.count,
    msg: request.msg.trim() || DEFAULT_BLESSING[request.type],
    recivers: request.recivers,
  };
  if (request.type === "rockPaperScissors" && request.gesture !== undefined) {
    body.gesture = request.gesture;
  }
  return `[redpacket]${JSON.stringify(body)}[/redpacket]`;
}

export function parseOpenPayload(payload: unknown): RedPacketInfo | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  const infoSource = asRecord(record.info);
  if (!infoSource || !isNonnegativeInteger(infoSource.count) ||
    !isNonnegativeInteger(infoSource.got) ||
    !isNonnegativeInteger(record.sessionGeneration) || record.sessionGeneration === 0 ||
    !Array.isArray(record.who) ||
    record.who.some((item) => {
      const entry = asRecord(item);
      return !entry || !readString(entry.userName) ||
        !Number.isSafeInteger(entry.userMoney) ||
        Number(entry.userMoney) < -0x8000_0000 || Number(entry.userMoney) > 0x7fff_ffff;
    })) {
    return null;
  }
  const count = readNumber(infoSource.count);
  const got = readNumber(infoSource.got);
  return {
    sessionGeneration: Number(record.sessionGeneration),
    info: {
      count,
      got,
      message:
        readString(infoSource.message) ??
        readString(infoSource.msg) ??
        "",
      userName: readString(infoSource.userName) ?? "",
      userAvatarUrl:
        readString(infoSource.userAvatarUrl) ??
        readString(infoSource.userAvatarURL) ??
        "",
      gesture: readGesture(infoSource.gesture),
    },
    receivers: [
      ...readStringList(record.receivers),
      ...readStringList(record.recivers),
    ].filter((name, index, list) => list.indexOf(name) === index),
    who: readWhoList(record.who),
  };
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readWhoList(value: unknown): RedPacketGot[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }
      const userName = readString(record.userName);
      if (!userName) {
        return null;
      }
      return {
        userId: readString(record.userId) ?? "",
        userName,
        avatar:
          readString(record.avatar) ??
          readString(record.userAvatarUrl) ??
          readString(record.userAvatarURL) ??
          "",
        userMoney: readNumber(record.userMoney ?? record.money),
        time: readString(record.time) ?? "",
      };
    })
    .filter((item): item is RedPacketGot => item !== null);
}

function readGesture(value: unknown): GestureIndex | undefined {
  if (value === 0 || value === 1 || value === 2) {
    return value;
  }
  if (value === "0" || value === "1" || value === "2") {
    return Number(value) as GestureIndex;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => readString(item))
      .filter((item): item is string => Boolean(item));
  }
  const text = readString(value);
  if (!text) {
    return [];
  }
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      return Array.isArray(parsed)
        ? parsed
            .map((item) => readString(item))
            .filter((item): item is string => Boolean(item))
        : [];
    } catch {
      return [];
    }
  }
  return [text];
}
