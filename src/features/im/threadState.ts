import type { PrivateMessageDto } from "./types";

export function privateJumpId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const local = /^#chat(\d+)$/.exec(raw);
  if (local) return local[1];
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.hostname !== "fishpi.cn" ||
        url.username || url.password || url.port || url.pathname !== "/chat") return null;
    return /^#chat(\d+)$/.exec(url.hash)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function compareMessageId(left: string, right: string): number {
  if (left === right) return 0;
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return left < right ? -1 : 1;
}

export function mergeThreadMessages(
  current: PrivateMessageDto[],
  incoming: PrivateMessageDto[],
  options?: { incomingWins?: boolean; revokedIds?: ReadonlySet<string> },
): PrivateMessageDto[] {
  const byId = new Map<string, PrivateMessageDto>();
  for (const item of [...current, ...incoming]) {
    const previous = byId.get(item.id);
    const merged = previous == null ? item : options?.incomingWins === false
      ? { ...item, ...previous } : { ...previous, ...item };
    const revoked = merged.revoked || previous?.revoked || options?.revokedIds?.has(item.id);
    byId.set(item.id, revoked ? { ...merged, revoked: true, md: undefined, text: undefined } : merged);
  }
  return [...byId.values()].sort((a, b) => compareMessageId(a.id, b.id));
}

export function messagePeer(
  eventUser: string | undefined,
  message: PrivateMessageDto,
  self: string,
): string | null {
  if (eventUser && eventUser !== self) return eventUser;
  if (message.userName === self) return message.receiverUserName || null;
  return message.userName || null;
}

export type PendingWrite = {
  content: string;
  draftContent?: string;
  knownIds: ReadonlySet<string>;
};

export function confirmsWrite(
  message: PrivateMessageDto,
  pending: PendingWrite,
  self: string,
): boolean {
  return !message.revoked && message.userName === self &&
    !pending.knownIds.has(message.id) &&
    (message.md ?? message.text ?? "").trim() === pending.content.trim();
}
