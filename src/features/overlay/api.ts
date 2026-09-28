import { invoke } from "@tauri-apps/api/core";

import {
  formatAppErrorMessage,
  parseInvokeError,
} from "../../lib/errors";

export const OVERLAY_COMMAND = {
  profile: "user_profile",
  search: "user_search",
} as const;

const MISSING_COMMAND =
  /command [`']?[\w:-]+[`']? not found|unknown command|not allowed to (?:call|use) command|not found in the allowlist/i;

const missing = new Set<string>();

export type UserSearchHit = {
  userName: string;
  userAvatarUrl: string;
};

export type UserMetal = {
  icon: string;
  description: string;
  enabled: boolean;
};

export type UserProfile = {
  userName: string;
  userNickname: string;
  userAvatarUrl: string;
  intro?: string;
  points?: number;
  role?: string;
  city?: string;
  online?: boolean;
  userNo?: string;
  following?: number;
  follower?: number;
  cardBg?: string;
  metals?: UserMetal[];
  mbti?: string;
};

export type ProfileOutcome =
  | { status: "ok"; profile: UserProfile }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

export type SearchOutcome =
  | { status: "ok"; users: UserSearchHit[] }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

const PROFILE_UNAVAILABLE = "用户资料命令尚未接入 Bridge。";
const SEARCH_UNAVAILABLE = "搜人接口尚未接入 Bridge。";

export async function fetchUserProfile(userName: string): Promise<ProfileOutcome> {
  const request = { userName };
  try {
    const payload = await invokeCommand(OVERLAY_COMMAND.profile, { request });
    return {
      status: "ok",
      profile: mapProfile(payload, userName),
    };
  } catch (error) {
    if (isCommandUnavailable(error, OVERLAY_COMMAND.profile)) {
      return { status: "unavailable", message: PROFILE_UNAVAILABLE };
    }
    return { status: "error", message: toUserMessage(error) };
  }
}

export async function searchUsers(query: string): Promise<SearchOutcome> {
  const request = { query };
  try {
    const payload = await invokeCommand(OVERLAY_COMMAND.search, { request });
    return {
      status: "ok",
      users: unwrapList(payload)
        .map(mapSearchHit)
        .filter((item): item is UserSearchHit => item != null),
    };
  } catch (error) {
    if (isCommandUnavailable(error, OVERLAY_COMMAND.search)) {
      return { status: "unavailable", message: SEARCH_UNAVAILABLE };
    }
    return { status: "error", message: toUserMessage(error) };
  }
}

async function invokeCommand(
  command: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (missing.has(command)) {
    throw new MissingCommandError(command);
  }
  try {
    return await invoke(command, args);
  } catch (error) {
    if (isMissingCommandText(error)) {
      missing.add(command);
      throw new MissingCommandError(command);
    }
    throw error;
  }
}

function isCommandUnavailable(error: unknown, command: string): boolean {
  return error instanceof MissingCommandError || missing.has(command);
}

function isMissingCommandText(error: unknown): boolean {
  return MISSING_COMMAND.test(rawErrorText(error));
}

function toUserMessage(error: unknown): string {
  return formatAppErrorMessage(parseInvokeError(error));
}

function rawErrorText(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return `${error.name} ${error.message}`;
  }
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const pieces = [record.message, record.code, record.error]
      .filter((item): item is string => typeof item === "string")
      .join(" ");
    if (pieces.length > 0) {
      return pieces;
    }
  }
  return String(error ?? "");
}

class MissingCommandError extends Error {
  readonly command: string;

  constructor(command: string) {
    super(command);
    this.name = "MissingCommandError";
    this.command = command;
  }
}

function mapProfile(raw: unknown, fallbackName: string): UserProfile {
  const rec = asRecord(raw);
  const source = rec
    ? (asRecord(rec.user) ?? asRecord(rec.profile) ?? asRecord(rec.data) ?? rec)
    : undefined;
  const userName =
    readString(source?.userName) ??
    readString(source?.username) ??
    readString(source?.user_name) ??
    fallbackName;
  const intro =
    readString(source?.userIntro) ??
    readString(source?.intro) ??
    readString(source?.user_intro);
  const points =
    readNumber(source?.userPoint) ??
    readNumber(source?.points) ??
    readNumber(source?.user_point);
  const role =
    readString(source?.role) ??
    readString(source?.userRole) ??
    readString(source?.user_role);
  const city =
    readString(source?.city) ?? readString(source?.userCity) ?? readString(source?.user_city);
  const userNo =
    readString(source?.userNo) ?? readString(source?.user_no) ?? readString(source?.userNO);
  const cardBg =
    readString(source?.cardBg) ??
    readString(source?.card_bg) ??
    readString(source?.userCardBg);
  const online =
    typeof source?.online === "boolean"
      ? source.online
      : typeof source?.userOnlineFlag === "boolean"
        ? source.userOnlineFlag
        : typeof source?.online === "number"
          ? source.online !== 0
          : undefined;
  const following =
    readNumber(source?.following) ?? readNumber(source?.followingUserCount);
  const follower = readNumber(source?.follower) ?? readNumber(source?.followerCount);
  const metals = mapMetals(source?.metals);
  const mbti =
    readString(source?.mbti) ?? readString(source?.MBTI) ?? readString(source?.userMbti);
  return {
    userName,
    userNickname:
      readString(source?.userNickname) ??
      readString(source?.nickname) ??
      readString(source?.user_nickname) ??
      "",
    userAvatarUrl:
      readString(source?.userAvatarUrl) ??
      readString(source?.userAvatarURL) ??
      readString(source?.avatar) ??
      "",
    ...(intro ? { intro } : {}),
    ...(points !== undefined ? { points } : {}),
    ...(role ? { role } : {}),
    ...(city ? { city } : {}),
    ...(online !== undefined ? { online } : {}),
    ...(userNo ? { userNo } : {}),
    ...(following !== undefined ? { following } : {}),
    ...(follower !== undefined ? { follower } : {}),
    ...(cardBg ? { cardBg } : {}),
    ...(metals.length > 0 ? { metals } : {}),
    ...(mbti ? { mbti } : {}),
  };
}

function mapMetals(raw: unknown): UserMetal[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: UserMetal[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) {
      continue;
    }
    const icon =
      readString(rec.icon) ?? readString(rec.url) ?? readString(rec.src);
    if (!icon) {
      continue;
    }
    out.push({
      icon,
      description: readString(rec.description) ?? readString(rec.name) ?? "",
      enabled: typeof rec.enabled === "boolean" ? rec.enabled : true,
    });
  }
  return out;
}

function mapSearchHit(raw: unknown): UserSearchHit | null {
  const rec = asRecord(raw);
  if (!rec) {
    const userName = readString(raw);
    return userName ? { userName, userAvatarUrl: "" } : null;
  }
  const userName =
    readString(rec.userName) ??
    readString(rec.username) ??
    readString(rec.user_name);
  if (!userName) {
    return null;
  }
  return {
    userName,
    userAvatarUrl:
      readString(rec.userAvatarUrl) ??
      readString(rec.userAvatarURL) ??
      readString(rec.avatar) ??
      "",
  };
}

function unwrapList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  const rec = asRecord(payload);
  if (!rec) {
    return [];
  }
  for (const key of ["users", "data", "list", "names"]) {
    const nested = rec[key];
    if (Array.isArray(nested)) {
      return nested;
    }
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
