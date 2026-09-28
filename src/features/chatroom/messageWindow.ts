import type { ChatMessageDto, RedpacketStatusEvent } from "../../lib/types";
import { MESSAGE_WINDOW_LIMIT } from "./constants";

export type ChatWindowState = {
  order: string[];
  byId: Map<string, ChatMessageDto>;
  /** 撤回优先：即使消息尚未进入窗口也要记住，后到历史不能复活。 */
  revokedIds: Set<string>;
  /** 红包领取人按消息累计：事件 whoGot 可能是增量也可能是全量，取并集。 */
  redpacketWho: Map<string, string[]>;
};

export function createChatWindow(): ChatWindowState {
  return {
    order: [],
    byId: new Map(),
    revokedIds: new Set(),
    redpacketWho: new Map(),
  };
}

export function compareMessageId(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  try {
    const a = BigInt(left);
    const b = BigInt(right);
    if (a < b) {
      return -1;
    }
    if (a > b) {
      return 1;
    }
    return 0;
  } catch {
    return left < right ? -1 : left > right ? 1 : 0;
  }
}

/** 服务端雪花 oId 才可比大小。`custom:` / `barrager:` 不能按字符串插队。 */
function isNumericId(id: string): boolean {
  return /^[0-9]+$/.test(id);
}

function toChronological(messages: ChatMessageDto[]): ChatMessageDto[] {
  if (messages.length < 2) {
    return messages.slice();
  }
  const first = messages[0].id;
  const last = messages[messages.length - 1].id;
  // 仅当两端都是雪花 ID 时才根据首尾判断接口是否倒序（旧版 more() 需要 reverse）。
  // custom / barrager 的合成 ID 不参与方向判断，保持数组原有相对顺序。
  if (isNumericId(first) && isNumericId(last) && compareMessageId(first, last) > 0) {
    return messages.slice().reverse();
  }
  return messages.slice();
}

function insertOrdered(order: string[], id: string): void {
  let index = order.length;
  while (index > 0 && compareMessageId(order[index - 1], id) > 0) {
    index -= 1;
  }
  order.splice(index, 0, id);
}

/** 新消息进窗。`append` 对齐旧版 `chats.push`：实时永远在末尾，避免合成 ID 插到更早消息前面。 */
function insertNew(
  state: ChatWindowState,
  id: string,
  mode: "append" | "ordered",
): void {
  // 调用方保证 id 尚未进 byId；这里只负责 order，不能用 byId.has 判断（set 之后永远为 true）。
  if (state.order.includes(id)) {
    return;
  }
  if (mode === "append" || !isNumericId(id)) {
    state.order.push(id);
    return;
  }
  insertOrdered(state.order, id);
}

function mergeStored(
  previous: ChatMessageDto | undefined,
  incoming: ChatMessageDto,
  revoked: boolean,
): ChatMessageDto {
  if (previous == null) {
    return { ...incoming, revoked };
  }
  return {
    ...previous,
    ...incoming,
    // 已撤回标记粘滞，后到历史不得把消息重新显示为未撤回。
    revoked: previous.revoked || revoked,
  };
}

/** 实时消息：按 ID 合入；新消息追加到末尾（旧版 `chats.push`）。 */
export function applyMessage(
  state: ChatWindowState,
  incoming: ChatMessageDto,
): void {
  const revoked = incoming.revoked || state.revokedIds.has(incoming.id);
  if (revoked) {
    state.revokedIds.add(incoming.id);
  }
  const previous = state.byId.get(incoming.id);
  state.byId.set(incoming.id, mergeStored(previous, incoming, revoked));
  if (previous == null) {
    insertNew(state, incoming.id, "append");
  }
}

export function applyRevoke(state: ChatWindowState, messageId: string): void {
  if (messageId.length === 0) {
    return;
  }
  state.revokedIds.add(messageId);
  const existing = state.byId.get(messageId);
  if (existing != null && !existing.revoked) {
    state.byId.set(messageId, { ...existing, revoked: true });
  }
}

/** 去掉上一轮拼接的领取人后缀，再刷新进度数字。 */
function rewriteRedpacketHint(
  hint: string | undefined,
  got: number,
  count: number,
  who: string[],
): string {
  let base = (hint ?? "").replace(/ · 领取：.*$/, "").trim();
  const progress = `已领 ${got}/${count}`;
  if (/已领 \d+\/\d+/.test(base)) {
    base = base.replace(/已领 \d+\/\d+/, progress);
  } else if (base.length > 0) {
    base = `${base} · ${progress}`;
  } else {
    base = `【红包】${progress}`;
  }
  if (who.length === 0) {
    return base;
  }
  return `${base} · 领取：${who.join("、")}`;
}

/**
 * 红包领取状态合并（对齐旧 redPacketStatus 分支）：刷新对应消息 rawHint 摘要。
 * 消息尚未进窗时只记领取人，等下一条状态到达再改写。
 */
export function applyRedpacketStatus(
  state: ChatWindowState,
  payload: RedpacketStatusEvent,
): boolean {
  const id = payload.messageId;
  if (id.length === 0) {
    return false;
  }
  let who = state.redpacketWho.get(id);
  if (who == null) {
    who = [];
    state.redpacketWho.set(id, who);
  }
  for (const name of payload.whoGot ?? []) {
    if (name.length > 0 && !who.includes(name)) {
      who.push(name);
    }
  }
  const message = state.byId.get(id);
  if (message == null || message.kind !== "redpacket") {
    return false;
  }
  const next = rewriteRedpacketHint(message.rawHint, payload.got, payload.count, who);
  if (next === message.rawHint) {
    return false;
  }
  state.byId.set(id, { ...message, rawHint: next });
  return true;
}

/** 历史 / 翻页：雪花 ID 按大小插入更早位置；合成 ID 保持批内相对顺序追加。 */
export function applyHistory(
  state: ChatWindowState,
  messages: ChatMessageDto[],
): { added: number } {
  const chronological = toChronological(messages);
  let added = 0;
  for (const message of chronological) {
    const existed = state.byId.has(message.id);
    const revoked = message.revoked || state.revokedIds.has(message.id);
    if (revoked) {
      state.revokedIds.add(message.id);
    }
    const previous = state.byId.get(message.id);
    state.byId.set(message.id, mergeStored(previous, message, revoked));
    if (!existed) {
      insertNew(state, message.id, "ordered");
      added += 1;
    }
  }
  return { added };
}

/**
 * 离线库预填：按文件顺序追加（旧版列表语义），后到历史/实时走同一路径去重。
 * 离线已撤回的保持撤回（revokedIds 粘滞）。
 */
export function seedOffline(
  state: ChatWindowState,
  messages: ChatMessageDto[],
): { added: number } {
  let added = 0;
  for (const message of messages) {
    const existed = state.byId.has(message.id);
    const revoked = message.revoked || state.revokedIds.has(message.id);
    if (revoked) {
      state.revokedIds.add(message.id);
    }
    const previous = state.byId.get(message.id);
    state.byId.set(message.id, mergeStored(previous, message, revoked));
    if (!existed) {
      insertNew(state, message.id, "append");
      added += 1;
    }
  }
  return { added };
}

export function snapshotMessages(state: ChatWindowState): ChatMessageDto[] {
  const messages: ChatMessageDto[] = [];
  for (const id of state.order) {
    const message = state.byId.get(id);
    if (message != null) {
      messages.push(message);
    }
  }
  return messages;
}

export function firstMessageId(state: ChatWindowState): string | null {
  return state.order[0] ?? null;
}

export function isWindowOverflow(
  state: ChatWindowState,
  limit: number = MESSAGE_WINDOW_LIMIT,
): boolean {
  return state.order.length > limit;
}

/** 清空消息体，保留撤回集合，避免后到历史把已撤回消息复活。 */
export function clearMessagesKeepRevokes(state: ChatWindowState): void {
  state.order = [];
  state.byId.clear();
}

export function trimOldestToLimit(
  state: ChatWindowState,
  limit: number = MESSAGE_WINDOW_LIMIT,
): void {
  while (state.order.length > limit) {
    const id = state.order.shift();
    if (id != null) {
      state.byId.delete(id);
    }
  }
}

export function resetChatWindow(state: ChatWindowState): void {
  state.order = [];
  state.byId.clear();
  state.revokedIds.clear();
  state.redpacketWho.clear();
}
