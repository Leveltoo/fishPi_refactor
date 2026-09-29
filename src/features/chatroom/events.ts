import { shouldAcceptEvent } from "../../lib/session";
import type {
  ChatMessageDto,
  ConnectionEvent,
  DiscussEvent,
  OnlineEvent,
  RedpacketStatusEvent,
  RevokeEvent,
} from "../../lib/types";

export type GenerationPair = {
  sessionGeneration: number;
  connectionGeneration: number;
};

export type NormalizedChatroomEvent =
  | { kind: "online"; payload: OnlineEvent }
  | { kind: "discuss"; payload: DiscussEvent }
  | { kind: "msg"; payload: ChatMessageDto }
  | { kind: "revoke"; payload: Pick<RevokeEvent, "messageId"> }
  | { kind: "connection"; payload: ConnectionEvent }
  | { kind: "redpacket-status"; payload: RedpacketStatusEvent }
  | { kind: "ignored" };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function eventKindName(event: Record<string, unknown>): string {
  const raw = String(
    event.event ?? event.type ?? event.channel ?? event.topic ?? "",
  );
  return raw.replace(/^chatroom:\/\//, "").toLowerCase();
}

function eventPayload(event: Record<string, unknown>): unknown {
  if ("payload" in event) {
    return event.payload;
  }
  if ("data" in event) {
    return event.data;
  }
  return event;
}

function readFinite(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function readGenerations(value: unknown): Partial<GenerationPair> {
  const rec = asRecord(value);
  if (rec == null) {
    return {};
  }
  const nested = asRecord(rec.message);
  const sessionGeneration =
    readFinite(rec.sessionGeneration) ?? readFinite(nested?.sessionGeneration);
  const connectionGeneration =
    readFinite(rec.connectionGeneration) ??
    readFinite(nested?.connectionGeneration);
  return { sessionGeneration, connectionGeneration };
}

/**
 * 代次对不上的事件直接丢弃，防止 StrictMode / 换号 / 重建连接后旧流回流。
 * listen 包装上的代次在 payload 里；历史结果在顶层。当前代次尚未成立时不丢，交给缓冲。
 */
export function matchesGeneration(
  value: unknown,
  current: GenerationPair | null,
): boolean {
  if (current == null || current.sessionGeneration <= 0) {
    return true;
  }
  const rec = asRecord(value);
  const fromWrapper = readGenerations(value);
  const fromPayload = readGenerations(rec?.payload);
  const sessionGeneration =
    fromPayload.sessionGeneration ?? fromWrapper.sessionGeneration;
  const connectionGeneration =
    fromPayload.connectionGeneration ?? fromWrapper.connectionGeneration;
  if (sessionGeneration == null) {
    return true;
  }
  return shouldAcceptEvent(
    { sessionGeneration, connectionGeneration },
    current.sessionGeneration,
    current.connectionGeneration,
  );
}

export function generationsFrom(value: unknown): GenerationPair | null {
  const gens = readGenerations(value);
  if (gens.sessionGeneration == null || gens.connectionGeneration == null) {
    return null;
  }
  return {
    sessionGeneration: gens.sessionGeneration,
    connectionGeneration: gens.connectionGeneration,
  };
}

function asMessage(payload: unknown): ChatMessageDto | null {
  const rec = asRecord(payload);
  if (rec == null) {
    return null;
  }
  const inner = asRecord(rec.message) ?? rec;
  if (typeof inner.id !== "string" || inner.id.length === 0) {
    return null;
  }
  return inner as unknown as ChatMessageDto;
}

function asRevoke(payload: unknown): Pick<RevokeEvent, "messageId"> | null {
  if (typeof payload === "string" && payload.length > 0) {
    return { messageId: payload };
  }
  const rec = asRecord(payload);
  if (rec == null) {
    return null;
  }
  const messageId =
    typeof rec.messageId === "string"
      ? rec.messageId
      : typeof rec.id === "string"
        ? rec.id
        : "";
  if (messageId.length === 0) {
    return null;
  }
  return { messageId };
}

/**
 * 把 listenChatroom 单回调归一成内部事件。
 * ChatReaction 不在这六路频道里；即使误达也走 ignored。
 */
export function normalizeChatroomEvent(event: unknown): NormalizedChatroomEvent {
  const rec = asRecord(event);
  if (rec == null) {
    return { kind: "ignored" };
  }

  const kind = eventKindName(rec);
  const payload = eventPayload(rec);

  switch (kind) {
    case "online":
      return { kind: "online", payload: payload as OnlineEvent };
    case "discuss":
      return { kind: "discuss", payload: payload as DiscussEvent };
    case "msg": {
      const message = asMessage(payload);
      if (message == null) {
        return { kind: "ignored" };
      }
      return { kind: "msg", payload: message };
    }
    case "revoke": {
      const revoke = asRevoke(payload);
      if (revoke == null) {
        return { kind: "ignored" };
      }
      return { kind: "revoke", payload: revoke };
    }
    case "connection":
      return { kind: "connection", payload: payload as ConnectionEvent };
    case "redpacket-status":
    case "redpacketstatus":
      // P0 忽略领取 UI，P1 再合并状态。
      return {
        kind: "redpacket-status",
        payload: payload as RedpacketStatusEvent,
      };
    default:
      return { kind: "ignored" };
  }
}
