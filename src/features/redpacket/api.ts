import { invoke } from "@tauri-apps/api/core";

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

/**
 * 本 feature 内封装的 invoke 名。
 * 开红包走 `redpacket_open`；发红包走已有 `chatroom_send`，载荷与 SDK `redpacket().send()` 相同。
 * command 未注册时返回 unavailable，不假装领取成功。
 */
export const REDPACKET_COMMAND = {
  open: "redpacket_open",
  sendViaChatroom: "chatroom_send",
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
  try {
    const payload = await invoke<unknown>(REDPACKET_COMMAND.open, { request });
    const data = parseOpenPayload(payload);
    if (!data) {
      return {
        status: "error",
        message: "开红包返回无法识别，请稍后在聊天室核对。",
      };
    }
    return { status: "ok", data };
  } catch (error) {
    if (isCommandUnavailable(error)) {
      return { status: "unavailable", message: OPEN_UNAVAILABLE };
    }
    if (isOutcomeUnknown(error)) {
      return { status: "outcome_unknown", message: SEND_PENDING };
    }
    return { status: "error", message: toUserFacingMessage(error) };
  }
}

export async function sendRedPacket(
  request: SendRedPacketRequest,
): Promise<SendOutcome> {
  const content = encodeRedPacketMessage(request);
  try {
    const result = await invoke<{
      accepted?: boolean;
      outcomeUnknown?: boolean;
    }>(REDPACKET_COMMAND.sendViaChatroom, { request: { content } });

    if (result?.outcomeUnknown) {
      return { status: "outcome_unknown", message: SEND_PENDING };
    }
    if (result?.accepted) {
      return { status: "accepted", message: SEND_ACCEPTED };
    }
    return {
      status: "error",
      message: "发红包未被接受，请稍后重试，不要连续点击。",
    };
  } catch (error) {
    if (isCommandUnavailable(error)) {
      return { status: "unavailable", message: SEND_UNAVAILABLE };
    }
    if (isOutcomeUnknown(error)) {
      return { status: "outcome_unknown", message: SEND_PENDING };
    }
    return { status: "error", message: toUserFacingMessage(error) };
  }
}

export async function readSelfUserName(): Promise<string> {
  try {
    const me = await invoke<{ user?: { userName?: string } }>(
      REDPACKET_COMMAND.me,
    );
    const name = me?.user?.userName;
    return typeof name === "string" ? name.trim() : "";
  } catch {
    return "";
  }
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

function parseOpenPayload(payload: unknown): RedPacketInfo | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  const infoSource = asRecord(record.info) ?? record;
  const count = readNumber(infoSource.count);
  const got = readNumber(infoSource.got);
  return {
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
