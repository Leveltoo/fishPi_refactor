/**
 * 类型化 Tauri invoke / listen。
 *
 * 聊天室实时约束：
 * 1. 前端必须先 `listenChatroom` 完成订阅，再 `invokeChatroomConnect`。
 *    仅靠这个顺序不能消除 SDK 内部首包窗口，但能接到 Bridge 在返回 connect 前发出的事件。
 * 2. 连接响应前到达的事件按 session/connection generation 暂存，不要直接丢弃。
 * 3. 合入状态前用 `shouldAccept`：代次对不上的事件必须丢弃，防止旧会话回流。
 * 4. unmount / StrictMode 双挂载时要调用返回的 unlistenAll，避免监听累积。
 *
 * Command 参数名与 Rust 形参对齐（camelCase）：单 DTO 入参叫 `request` 或 `query`。
 * State / AppHandle 由 Tauri 注入，不要从 JS 传递。
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { AppInvokeError, parseInvokeError } from "./errors";
import {
  AUTH_COMMAND,
  CHATROOM_COMMAND,
  CHATROOM_EVENT,
  type AuthMe,
  type AuthSession,
  type ChatMessageEvent,
  type ChatroomConnectResult,
  type ChatroomEventHandler,
  type ConnectionEvent,
  type DiscussEvent,
  type HistoryQuery,
  type HistoryResult,
  type LoginRequest,
  type LogoutResult,
  type OnlineEvent,
  type RedpacketStatusEvent,
  type RestoreOutcome,
  type RevokeEvent,
  type RevokeRequest,
  type SendRequest,
  type SendResult,
} from "./types";

export type { UnlistenFn };

export {
  AUTH_COMMAND,
  CHATROOM_COMMAND,
  CHATROOM_EVENT,
} from "./types";

export {
  AppInvokeError,
  formatAppErrorMessage,
  isAppError,
  isAppErrorCode,
  parseInvokeError,
} from "./errors";

export {
  isStaleGeneration,
  shouldAccept,
  shouldAcceptEvent,
} from "./session";

export type {
  AppError,
  AppErrorCode,
  AuthMe,
  AuthSession,
  AuthStatus,
  ChatMessageDto,
  ChatMessageEvent,
  ChatMessageKind,
  ChatroomConnectResult,
  ChatroomEventHandler,
  ChatroomEventName,
  ChatroomListenEvent,
  ConnectionEvent,
  ConnectionStatus,
  DiscussEvent,
  HistoryMode,
  HistoryQuery,
  HistoryResult,
  LoginRequest,
  LogoutResult,
  OnlineEvent,
  OnlineUser,
  RedpacketStatusEvent,
  RestoreOutcome,
  RestoreResult,
  RevokeEvent,
  RevokeRequest,
  SendRequest,
  SendResult,
  UserSummary,
} from "./types";

export type { Generation, GenerationFields } from "./session";

export function invokeAuthLogin(request: LoginRequest): Promise<AuthSession> {
  return invokeCommand<AuthSession>(AUTH_COMMAND.login, { request });
}

export function invokeAuthRestore(): Promise<RestoreOutcome> {
  return invokeCommand<RestoreOutcome>(AUTH_COMMAND.restore);
}

export function invokeAuthLogout(): Promise<LogoutResult> {
  return invokeCommand<LogoutResult>(AUTH_COMMAND.logout);
}

export function invokeAuthMe(): Promise<AuthMe> {
  return invokeCommand<AuthMe>(AUTH_COMMAND.me);
}

export function invokeChatroomConnect(): Promise<ChatroomConnectResult> {
  return invokeCommand<ChatroomConnectResult>(CHATROOM_COMMAND.connect);
}

export function invokeChatroomDisconnect(): Promise<void> {
  return invokeCommand<void>(CHATROOM_COMMAND.disconnect);
}

export function invokeChatroomSend(request: SendRequest): Promise<SendResult> {
  return invokeCommand<SendResult>(CHATROOM_COMMAND.send, { request });
}

export function invokeChatroomHistory(
  query: HistoryQuery,
): Promise<HistoryResult> {
  return invokeCommand<HistoryResult>(CHATROOM_COMMAND.history, { query });
}

export function invokeChatroomRevoke(request: RevokeRequest): Promise<void> {
  return invokeCommand<void>(CHATROOM_COMMAND.revoke, { request });
}

/**
 * 订阅聊天室全部 6 个事件。必须在 connect 之前 await 完。
 * 返回的 unlistenAll 可重复调用；部分订阅失败时会清掉已成功的监听。
 */
export async function listenChatroom(
  handler: ChatroomEventHandler,
): Promise<UnlistenFn> {
  const unlistens: UnlistenFn[] = [];

  try {
    unlistens.push(
      await listen<OnlineEvent>(CHATROOM_EVENT.online, (event) => {
        handler({
          event: CHATROOM_EVENT.online,
          payload: event.payload,
        });
      }),
    );
    unlistens.push(
      await listen<DiscussEvent>(CHATROOM_EVENT.discuss, (event) => {
        handler({
          event: CHATROOM_EVENT.discuss,
          payload: event.payload,
        });
      }),
    );
    unlistens.push(
      await listen<ChatMessageEvent>(CHATROOM_EVENT.msg, (event) => {
        handler({
          event: CHATROOM_EVENT.msg,
          payload: event.payload,
        });
      }),
    );
    unlistens.push(
      await listen<RevokeEvent>(CHATROOM_EVENT.revoke, (event) => {
        handler({
          event: CHATROOM_EVENT.revoke,
          payload: event.payload,
        });
      }),
    );
    unlistens.push(
      await listen<RedpacketStatusEvent>(
        CHATROOM_EVENT.redpacketStatus,
        (event) => {
          handler({
            event: CHATROOM_EVENT.redpacketStatus,
            payload: event.payload,
          });
        },
      ),
    );
    unlistens.push(
      await listen<ConnectionEvent>(CHATROOM_EVENT.connection, (event) => {
        handler({
          event: CHATROOM_EVENT.connection,
          payload: event.payload,
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

async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toInvokeError(error);
  }
}

function toInvokeError(error: unknown): AppInvokeError {
  if (error instanceof AppInvokeError) {
    return error;
  }
  return new AppInvokeError(parseInvokeError(error));
}
