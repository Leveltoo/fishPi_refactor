import type { ChatMessageDto } from "../../lib/types";
import type { ShieldRule } from "./chatroomApi";

export type WeatherDay = {
  date: string;
  maxTemp: string;
  minTemp: string;
  code: string;
};

export type WeatherCard = {
  area: string;
  summary: string;
  days: WeatherDay[];
};

export type MusicCard = {
  title: string;
  source: string;
  coverUrl: string;
  from: string;
  audioUrl?: string;
};

/** Bridge 在 `ChatMessageDto` 上多出来的字段。`lib/types.ts` 不在本次范围，运行时 JSON 仍带着它们。 */
export type RichChatMessage = ChatMessageDto & {
  viaClient?: string;
  viaVersion?: string;
  color?: string;
  weather?: WeatherCard;
  music?: MusicCard;
};

export type AlsoSaid = {
  id: string;
  userName: string;
  userNickname: string;
  userAvatarUrl: string;
};

export type DisplayMessage = RichChatMessage & {
  alsoSaid: AlsoSaid[];
};

export function asRich(message: ChatMessageDto): RichChatMessage {
  return message as RichChatMessage;
}

const VIA_LABEL: Record<string, string> = {
  Web: "网页",
  Android: "手机",
  iOS: "手机",
  Mobile: "手机",
  Windows: "桌面",
  macOS: "桌面",
  Linux: "桌面",
  PC: "桌面",
  VSCode: "IDE",
  IDEA: "IDE",
  Chrome: "扩展",
  Edge: "扩展",
  Extension: "扩展",
  Python: "Python",
  Golang: "Go",
  Dart: "Dart",
  IceNet: "机器人",
  ElvesOnline: "机器人",
};

export function viaLabel(client: string): string {
  return VIA_LABEL[client] ?? (client.length <= 8 ? client : "来源");
}

/** 与 Bridge `safe_css_color` 同一边界：拒绝 url / expression。 */
export function safeCssColor(raw: string | undefined): string | null {
  if (raw == null) {
    return null;
  }
  const value = raw.trim();
  if (value.length === 0 || value.length > 64) {
    return null;
  }
  const lower = value.toLowerCase();
  if (
    lower.includes("url") ||
    lower.includes("expression") ||
    /[\\@;{}<>"']/.test(lower) ||
    lower.includes("/*")
  ) {
    return null;
  }
  if (
    /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(lower) ||
    /^(?:rgb|rgba|hsl|hsla)\([0-9.,% /]+\)$/.test(lower) ||
    /^[a-z]{3,20}$/.test(lower)
  ) {
    return lower;
  }
  return null;
}

function comparableBody(message: ChatMessageDto): string | null {
  if (message.revoked || message.kind !== "msg") {
    return null;
  }
  const md = message.md;
  if (md != null && md.length > 0) {
    return md;
  }
  const text = message.text;
  if (text != null && text.length > 0) {
    return text;
  }
  return null;
}

function toAlsoSaid(message: ChatMessageDto): AlsoSaid {
  return {
    id: message.id,
    userName: message.userName,
    userNickname: message.userNickname,
    userAvatarUrl: message.userAvatarUrl,
  };
}

/** 同 id 且展示字段全等（含 alsoSaid 序列）→ 复用旧 DisplayMessage 对象。 */
function displayRowEqual(a: DisplayMessage, b: DisplayMessage): boolean {
  if (
    a.id !== b.id ||
    a.revoked !== b.revoked ||
    a.kind !== b.kind ||
    a.md !== b.md ||
    a.text !== b.text ||
    a.rawHint !== b.rawHint ||
    a.time !== b.time ||
    a.userName !== b.userName ||
    a.userNickname !== b.userNickname ||
    a.userAvatarUrl !== b.userAvatarUrl ||
    a.alsoSaid.length !== b.alsoSaid.length
  ) {
    return false;
  }
  const ra = asRich(a);
  const rb = asRich(b);
  if (ra.color !== rb.color || ra.viaClient !== rb.viaClient) {
    return false;
  }
  for (let index = 0; index < a.alsoSaid.length; index += 1) {
    const x = a.alsoSaid[index];
    const y = b.alsoSaid[index];
    if (
      x.id !== y.id ||
      x.userName !== y.userName ||
      x.userNickname !== y.userNickname ||
      x.userAvatarUrl !== y.userAvatarUrl
    ) {
      return false;
    }
  }
  return true;
}

/**
 * 上一次输入/输出：publish 每次都造新数组但元素大多没变，
 * 全量重建 DisplayMessage 会让整屏 memo 失效（800 条卡顿），这里按等价复用旧对象。
 */
let mergeCache: { input: ChatMessageDto[]; output: DisplayMessage[] } | null =
  null;

/**
 * 对齐旧 `mergeDoubleMsg`：按时间正序，连续相同正文收进第一条的 `alsoSaid`。
 * 红包、撤回、非普通消息不参与。不改窗口里的消息 ID。
 */
export function mergeDoubleMessages(messages: ChatMessageDto[]): DisplayMessage[] {
  const prev = mergeCache;
  if (prev != null && prev.input === messages) {
    return prev.output;
  }
  const rows: DisplayMessage[] = [];
  for (const message of messages) {
    const body = comparableBody(message);
    const previous = rows[rows.length - 1];
    const previousBody = previous == null ? null : comparableBody(previous);
    if (
      previous != null &&
      body != null &&
      previousBody != null &&
      body === previousBody
    ) {
      previous.alsoSaid.push(toAlsoSaid(message));
      continue;
    }
    rows.push({ ...asRich(message), alsoSaid: [] });
  }
  if (prev != null) {
    const prevById = new Map<string, DisplayMessage>();
    for (const row of prev.output) {
      if (!prevById.has(row.id)) {
        prevById.set(row.id, row);
      }
    }
    for (let index = 0; index < rows.length; index += 1) {
      const old = prevById.get(rows[index].id);
      if (old != null && displayRowEqual(old, rows[index])) {
        rows[index] = old;
      }
    }
    if (
      rows.length === prev.output.length &&
      rows.every((row, index) => row === prev.output[index])
    ) {
      mergeCache = { input: messages, output: prev.output };
      return prev.output;
    }
  }
  mergeCache = { input: messages, output: rows };
  return rows;
}

/** 旧 `firstMsg`：最后一条非红包、未撤回的消息，且已经有人「也这么说」才出现 +1。 */
export function plusOneMessageId(rows: DisplayMessage[]): string | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.revoked || row.kind === "redpacket") {
      continue;
    }
    return row.alsoSaid.length > 0 ? row.id : null;
  }
  return null;
}

export function repeatBody(message: ChatMessageDto): string | null {
  const md = message.md?.trim();
  if (md) {
    return message.md ?? md;
  }
  const text = message.text?.trim();
  if (text) {
    return message.text ?? text;
  }
  return null;
}

function messageHaystack(message: ChatMessageDto): string {
  return [message.md, message.text, message.rawHint]
    .filter((part): part is string => part != null && part.length > 0)
    .join("\n");
}

export function isShielded(message: ChatMessageDto, rules: ShieldRule[]): boolean {
  const haystack = messageHaystack(message);
  for (const rule of rules) {
    if (rule.type === "username") {
      if (rule.value.length > 0 && message.userName === rule.value) {
        return true;
      }
      continue;
    }
    if (rule.type === "redpacket") {
      if (message.kind === "redpacket") {
        return true;
      }
      continue;
    }
    if (rule.type === "content" && rule.value.length > 0) {
      try {
        if (new RegExp(rule.value).test(haystack)) {
          return true;
        }
      } catch {
        // 非法正则不匹配，避免一条坏规则把整条消息流打崩。
      }
    }
  }
  return false;
}

export function usernameShielded(userName: string, rules: ShieldRule[]): boolean {
  return rules.some(
    (rule) => rule.type === "username" && rule.value.length > 0 && rule.value === userName,
  );
}

export const TOPIC_MAX_LENGTH = 16;

export function topicCommand(raw: string): string | null {
  const text = raw.trim();
  if (text.length === 0 || text.length > TOPIC_MAX_LENGTH) {
    return null;
  }
  return `[setdiscuss]${text}[/setdiscuss]`;
}

/** 网易云链接转 music box iframe（抄旧版 messagebox.vue toMusicBox）。 */
export function toMusicBox(msg: string): string {
  const songRe = /http(?:s):\/\/music.163.com\/(?:#\/|)song\?id=(\d+)(&[\w=]+)*/g;
  const albumRe = /http(?:s):\/\/music.163.com\/(?:#\/|)album\?id=(\d+)(&[\w=]+)*/g;
  if (songRe.test(msg)) {
    songRe.lastIndex = 0;
    return msg.replace(
      songRe,
      `<iframe frameborder="no" border="0" marginwidth="0" marginheight="0" width=100% height=86 src="//music.163.com/outchain/player?type=2&id=$1&auto=0&height=66"></iframe>`,
    );
  }
  songRe.lastIndex = 0;
  if (albumRe.test(msg)) {
    albumRe.lastIndex = 0;
    return msg.replace(
      albumRe,
      `<iframe frameborder="no" border="0" marginwidth="0" marginheight="0" width=100% height=210 src="//music.163.com/outchain/player?type=1&id=$1&auto=0&height=430"></iframe>`,
    );
  }
  return msg;
}
