import { isRedPacketType } from "./constants";
import type {
  GestureIndex,
  OpenPreview,
  OpenSession,
  RedPacketType,
  SendSession,
} from "./types";

/** 聊天室点击红包消息时派发。 */
export const REDPACKET_OPEN_EVENT = "fishpi:redpacket";

/** 聊天室点「发红包」时派发。 */
export const REDPACKET_SEND_EVENT = "fishpi:redpacket-send";

const ID_KEYS = ["oId", "oid", "id", "messageId", "o_id"] as const;

export function parseOpenEvent(event: Event): OpenSession | null {
  const detail = readDetail(event);
  const record = asRecord(detail);
  if (!record) {
    return null;
  }

  const oId = pickMessageId(record);
  if (!oId) {
    return null;
  }

  return {
    oId,
    gesture: pickGesture(record),
    packetType: pickPacketType(record),
    preview: pickPreview(record),
  };
}

export function parseSendEvent(event: Event): SendSession {
  const record = asRecord(readDetail(event)) ?? {};
  const fromUser = readNonEmptyString(record.user);
  const fromUserName = readNonEmptyString(record.userName);
  const namedUser = fromUser ?? fromUserName;
  const packetType = pickPacketType(record);
  // overlay 的 `user` 锁定专属；聊天室只带当前 `userName`，不要当成专属对象。
  // `type: "specify"` 时 `userName` 仍 alias 成 `user`。
  const specifyLocked = Boolean(fromUser) || packetType === "specify";
  const lockedUser = specifyLocked ? namedUser : undefined;
  const lockedType = lockedUser ? "specify" : packetType;

  return {
    lockedUser,
    lockedType,
    selfUserName: specifyLocked ? undefined : fromUserName,
    onlineUsers: readOnlineUsers(record.users ?? record.onlineUsers ?? record.onlineList),
    initialReceivers: uniqueNames([
      ...(lockedUser ? [lockedUser] : []),
      ...readNameList(record.recivers),
      ...readNameList(record.receivers),
    ]),
  };
}

function readDetail(event: Event): unknown {
  if ("detail" in event) {
    return (event as CustomEvent).detail;
  }
  return undefined;
}

function pickMessageId(record: Record<string, unknown>): string | undefined {
  const nested = asRecord(record.packet);
  const sources = nested ? [record, nested] : [record];
  for (const source of sources) {
    for (const key of ID_KEYS) {
      const id = readIdValue(source[key]);
      if (id) {
        return id;
      }
    }
  }
  if (typeof record.packet === "string") {
    return readIdValue(record.packet);
  }
  return undefined;
}

function readIdValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  const text = readNonEmptyString(value);
  if (!text || text === "send") {
    return undefined;
  }
  return text;
}

function pickGesture(record: Record<string, unknown>): GestureIndex | undefined {
  const nested = asRecord(record.packet);
  return (
    parseGesture(record.gesture) ??
    parseGesture(record.GestureType) ??
    (nested
      ? parseGesture(nested.gesture) ?? parseGesture(nested.GestureType)
      : undefined)
  );
}

function pickPacketType(record: Record<string, unknown>): RedPacketType | undefined {
  const nested = asRecord(record.packet);
  const raw =
    readNonEmptyString(record.type) ??
    readNonEmptyString(record.packetType) ??
    (nested ? readNonEmptyString(nested.type) : undefined);
  return raw && isRedPacketType(raw) ? raw : undefined;
}

function pickPreview(record: Record<string, unknown>): OpenPreview {
  const nested = asRecord(record.packet);
  const info = asRecord(record.info) ?? (nested ? asRecord(nested.info) : undefined);
  const source = info ?? nested ?? record;
  return {
    userName:
      readNonEmptyString(source.userName) ??
      readNonEmptyString(record.userName) ??
      readNonEmptyString(record.whoGive) ??
      "",
    userAvatarUrl:
      readNonEmptyString(source.userAvatarUrl) ??
      readNonEmptyString(source.userAvatarURL) ??
      readNonEmptyString(record.userAvatarUrl) ??
      readNonEmptyString(record.userAvatarURL) ??
      "",
    message:
      readNonEmptyString(source.message) ??
      readNonEmptyString(source.msg) ??
      readNonEmptyString(source.text) ??
      readNonEmptyString(record.message) ??
      readNonEmptyString(record.msg) ??
      readNonEmptyString(record.text) ??
      "",
    count: readFiniteNumber(source.count) ?? readFiniteNumber(record.count),
    got: readFiniteNumber(source.got) ?? readFiniteNumber(record.got),
  };
}

export function parseGesture(value: unknown): GestureIndex | undefined {
  if (typeof value === "number" && value >= 0 && value <= 2) {
    return value as GestureIndex;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  switch (text) {
    case "0":
    case "石头":
    case "Rock":
    case "rock":
      return 0;
    case "1":
    case "剪刀":
    case "Scissors":
    case "scissors":
      return 1;
    case "2":
    case "布":
    case "Paper":
    case "paper":
      return 2;
    default:
      return undefined;
  }
}

function readOnlineUsers(value: unknown): SendSession["onlineUsers"] {
  if (!Array.isArray(value)) {
    return [];
  }
  const users: SendSession["onlineUsers"] = [];
  for (const item of value) {
    const record = asRecord(item);
    const userName = record
      ? readNonEmptyString(record.userName) ?? readNonEmptyString(record.userNickname)
      : readNonEmptyString(item);
    if (!userName) {
      continue;
    }
    users.push({
      userName,
      userAvatarUrl: record
        ? readNonEmptyString(record.userAvatarUrl) ??
          readNonEmptyString(record.userAvatarURL) ??
          ""
        : "",
    });
  }
  return users;
}

function readNameList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => readNonEmptyString(item))
      .filter((item): item is string => Boolean(item));
  }
  const text = readNonEmptyString(value);
  if (!text) {
    return [];
  }
  return text
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(name);
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
