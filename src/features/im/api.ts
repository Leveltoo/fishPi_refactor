/**
 * 私聊 typed invoke / listen。命令未注册时抛 BridgeGapError，不得当作发送成功。
 * missing 只记第一次缺口；同名 command 一旦 invoke 成功就清掉，避免挡住后补上的 Bridge。
 *
 * 约定与 P0 一致：单 DTO 入参叫 `request` 或 `query`；事件带 sessionGeneration。
 * SDK 需区分全局通知频道（userName 缺省）与指定用户会话连接，前端不假设一条 WS 覆盖全部私聊。
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { AppInvokeError, parseInvokeError } from "../../lib/errors";
import {
  BridgeGapError,
  isMissingCommandError,
} from "./errors";
import {
  mapBroadcastEvent,
  mapConversation,
  mapMessageEvent,
  mapNoticeEvent,
  mapPrivateMessage,
  mapRevokeEvent,
  mapSearchHit,
  readExhausted,
  readSessionGeneration,
  unwrapList,
} from "./mappers";
import type {
  ChatConnectRequest,
  ChatConnectResult,
  ChatConversationDto,
  ChatEventHandler,
  ChatHistoryQuery,
  ChatHistoryResult,
  ChatListResult,
  ChatRevokeRequest,
  ChatSendRequest,
  ChatUnreadResult,
  ChatUserRequest,
  PrivateMessageDto,
  SendResult,
  UserSearchHit,
  UserSearchRequest,
  UserSearchResult,
} from "./types";
import { CHAT_COMMAND, CHAT_EVENT, NOTICE_EVENT, USER_COMMAND } from "./types";

export type { UnlistenFn };

const missingCommands = new Set<string>();

export function isCommandMissing(command: string): boolean {
  return missingCommands.has(command);
}

export function invokeChatList(): Promise<ChatListResult> {
  return invokeMapped(CHAT_COMMAND.list, undefined, (payload) => ({
    sessionGeneration: readSessionGeneration(payload),
    conversations: unwrapList(payload)
      .map(mapConversation)
      .filter((item): item is ChatConversationDto => item != null),
  }));
}

export function invokeChatUnread(): Promise<ChatUnreadResult> {
  return invokeMapped(CHAT_COMMAND.unread, undefined, (payload) => ({
    sessionGeneration: readSessionGeneration(payload),
    messages: unwrapList(payload)
      .map(mapConversation)
      .filter((item): item is ChatConversationDto => item != null),
  }));
}

export function invokeChatHistory(
  query: ChatHistoryQuery,
): Promise<ChatHistoryResult> {
  return invokeMapped(CHAT_COMMAND.history, { query }, (payload) => {
    const mapped = unwrapList(payload)
      .map(mapPrivateMessage)
      .filter((item): item is PrivateMessageDto => item != null);
    return {
      sessionGeneration: readSessionGeneration(payload),
      messages: chronological(mapped),
      exhausted: readExhausted(payload),
    };
  });
}

export function invokeChatSend(request: ChatSendRequest): Promise<SendResult> {
  return invokeMapped(CHAT_COMMAND.send, { request }, (payload) => {
    if (payload == null || typeof payload !== "object") {
      return {
        sessionGeneration: 0,
        accepted: true,
        outcomeUnknown: false,
      };
    }
    const record = payload as Record<string, unknown>;
    const outcomeUnknown =
      record.outcomeUnknown === true || record.outcome_unknown === true;
    return {
      sessionGeneration:
        typeof record.sessionGeneration === "number"
          ? record.sessionGeneration
          : 0,
      accepted: record.accepted !== false && !outcomeUnknown,
      outcomeUnknown,
    };
  });
}

export function invokeChatRevoke(request: ChatRevokeRequest): Promise<void> {
  return invokeCommand<void>(CHAT_COMMAND.revoke, { request });
}

export function invokeChatMarkRead(request: ChatUserRequest): Promise<void> {
  return invokeCommand<void>(CHAT_COMMAND.markRead, { request });
}

export function invokeChatConnect(
  request: ChatConnectRequest = {},
): Promise<ChatConnectResult> {
  return invokeMapped(CHAT_COMMAND.connect, { request }, (payload) => ({
    sessionGeneration: readSessionGeneration(payload),
    connectionGeneration:
      payload &&
      typeof payload === "object" &&
      typeof (payload as { connectionGeneration?: unknown }).connectionGeneration ===
        "number"
        ? (payload as { connectionGeneration: number }).connectionGeneration
        : undefined,
  }));
}

export function invokeChatDisconnect(
  request: ChatConnectRequest = {},
): Promise<void> {
  return invokeCommand<void>(CHAT_COMMAND.disconnect, { request });
}

export function invokeUserSearch(
  request: UserSearchRequest,
): Promise<UserSearchResult> {
  return invokeMapped(USER_COMMAND.search, { request }, (payload) => ({
    sessionGeneration: readSessionGeneration(payload) || undefined,
    users: unwrapList(payload)
      .map(mapSearchHit)
      .filter((item): item is UserSearchHit => item != null),
  }));
}

export async function listenChatEvents(
  handler: ChatEventHandler,
): Promise<UnlistenFn> {
  const unlistens: UnlistenFn[] = [];

  try {
    unlistens.push(
      await listen(CHAT_EVENT.msg, (event) => {
        const payload = mapMessageEvent(event.payload);
        if (payload) {
          handler({ event: CHAT_EVENT.msg, payload });
        }
      }),
    );
    unlistens.push(
      await listen(CHAT_EVENT.notice, (event) => {
        const payload = mapNoticeEvent(event.payload);
        if (payload) {
          handler({ event: CHAT_EVENT.notice, payload });
        }
      }),
    );
    unlistens.push(
      await listen(CHAT_EVENT.revoke, (event) => {
        const payload = mapRevokeEvent(event.payload);
        if (payload) {
          handler({ event: CHAT_EVENT.revoke, payload });
        }
      }),
    );
    unlistens.push(
      await listen(NOTICE_EVENT.refresh, (event) => {
        const payload = mapNoticeEvent(event.payload);
        if (payload) {
          handler({ event: NOTICE_EVENT.refresh, payload });
        }
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

export { isOutcomeUnknown } from "./errors";

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
  try {
    const result = await invoke<T>(command, args);
    missingCommands.delete(command);
    return result;
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

function chronological<T extends { id: string; time: string }>(
  messages: T[],
): T[] {
  if (messages.length < 2) {
    return messages;
  }
  const first = messages[0];
  const last = messages[messages.length - 1];
  if (first.id > last.id || (first.time && last.time && first.time > last.time)) {
    return [...messages].reverse();
  }
  return messages;
}
