import { invoke } from "@tauri-apps/api/core";

export type FailedSend = {
  scope: string;
  peer: string;
  clientId: string;
  preview: string;
  status: "failed";
};

export type OfflineSnapshot = {
  chatroom: Record<string, unknown>[];
  chats: Record<string, Record<string, unknown>[]>;
  failed: FailedSend[];
};

const SECRET = /token|password|passwd|api[_-]?key|secret|mfa/i;

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(scrub);
  }
  if (value == null || typeof value !== "object") {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET.test(key)) {
      continue;
    }
    out[key] = scrub(child);
  }
  return out;
}

export function loadOffline(): Promise<OfflineSnapshot> {
  return invoke<OfflineSnapshot>("offline_load");
}

export function mergeOffline(input: {
  scope: "chatroom" | "chat";
  peer?: string;
  messages: unknown[];
}): Promise<OfflineSnapshot> {
  return invoke<OfflineSnapshot>("offline_merge", {
    request: {
      scope: input.scope,
      peer: input.peer,
      messages: input.messages.map(scrub),
    },
  });
}

export function failOfflineSend(input: {
  scope: "chatroom" | "chat";
  peer?: string;
  clientId: string;
  preview?: string;
}): Promise<OfflineSnapshot> {
  return invoke<OfflineSnapshot>("offline_fail_send", {
    request: {
      scope: input.scope,
      peer: input.peer,
      clientId: input.clientId,
      preview: input.preview,
    },
  });
}

export function messagePreview(message: Record<string, unknown>): string {
  const nested =
    message.message != null && typeof message.message === "object"
      ? (message.message as Record<string, unknown>)
      : message;
  const user = textOf(nested.userName ?? nested.userNickname);
  const body = textOf(nested.text ?? nested.md ?? nested.preview);
  const line = `${user} ${body}`.trim();
  return line.slice(0, 80) || "（无文本）";
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
