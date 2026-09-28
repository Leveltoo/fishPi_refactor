/**
 * 清风明月 typed invoke。命令未注册时抛 BridgeGapError，不得当作发送成功。
 *
 * 入参名与 Rust 形参对齐：列表走 `query`，发送走 `request`。
 */

import { invoke } from "@tauri-apps/api/core";

import { AppInvokeError, parseInvokeError } from "../../lib/errors";
import {
  BridgeGapError,
  isMissingCommandError,
} from "./errors";
import type {
  BreezemoonDto,
  BreezemoonListQuery,
  BreezemoonListResult,
  BreezemoonSendRequest,
  SendResult,
} from "./types";
import { BREEZEMOON_COMMAND, PAGE_SIZE } from "./types";

const missingCommands = new Set<string>();

export function isCommandMissing(command: string): boolean {
  return missingCommands.has(command);
}

export function invokeBreezemoonList(
  query: BreezemoonListQuery,
): Promise<BreezemoonListResult> {
  return invokeMapped(BREEZEMOON_COMMAND.list, { query }, (payload) => {
    const items = unwrapList(payload)
      .map(mapBreezemoon)
      .filter((item): item is BreezemoonDto => item != null);
    const size = query.size > 0 ? query.size : PAGE_SIZE;
    return {
      sessionGeneration: readSessionGeneration(payload),
      items,
      exhausted: readExhausted(payload, items.length, size),
    };
  });
}

export function invokeBreezemoonSend(
  request: BreezemoonSendRequest,
): Promise<SendResult> {
  return invokeMapped(BREEZEMOON_COMMAND.send, { request }, mapSendResult);
}

async function invokeMapped<T>(
  command: string,
  args: Record<string, unknown>,
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

function mapSendResult(payload: unknown): SendResult {
  if (payload == null) {
    return {
      sessionGeneration: 0,
      accepted: true,
      outcomeUnknown: false,
    };
  }
  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    return {
      sessionGeneration:
        typeof record.sessionGeneration === "number"
          ? record.sessionGeneration
          : 0,
      accepted: record.accepted !== false,
      outcomeUnknown: record.outcomeUnknown === true,
    };
  }
  return {
    sessionGeneration: 0,
    accepted: true,
    outcomeUnknown: false,
  };
}

function mapBreezemoon(raw: unknown): BreezemoonDto | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = readId(raw);
  if (!id) {
    return null;
  }
  return {
    id,
    authorName:
      firstString(raw, [
        "authorName",
        "breezemoonAuthorName",
        "author_name",
      ]) ?? "",
    authorAvatarUrl:
      firstString(raw, [
        "authorAvatarUrl",
        "authorAvatar",
        "avatar",
        "thumbnailUrl48",
        "breezemoonAuthorThumbnailURL48",
        "breezemoonAuthorThumbnailURL",
      ]) ?? "",
    content:
      firstString(raw, ["content", "breezemoonContent", "md", "markdown"]) ??
      "",
    city: firstString(raw, ["city", "breezemoonCity"]) ?? "",
    timeAgo: firstString(raw, ["timeAgo", "time_ago"]) ?? "",
    created:
      firstString(raw, [
        "created",
        "breezemoonCreated",
        "createTime",
        "breezemoonCreateTime",
      ]) ?? "",
  };
}

function unwrapList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isRecord(payload)) {
    return [];
  }
  const nested =
    payload.breezemoons ?? payload.items ?? payload.messages ?? payload.data;
  return Array.isArray(nested) ? nested : [];
}

function readSessionGeneration(payload: unknown): number {
  if (!isRecord(payload)) {
    return 0;
  }
  return typeof payload.sessionGeneration === "number" &&
    Number.isFinite(payload.sessionGeneration)
    ? payload.sessionGeneration
    : 0;
}

function readExhausted(
  payload: unknown,
  count: number,
  size: number,
): boolean {
  if (isRecord(payload) && typeof payload.exhausted === "boolean") {
    return payload.exhausted;
  }
  return count < size;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readId(record: Record<string, unknown>): string | undefined {
  for (const key of ["id", "oId", "o_id"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function firstString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}
