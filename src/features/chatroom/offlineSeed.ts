import type {
  ChatMessageDto,
  ChatMessageKind,
  RedpacketCardDto,
  RedpacketWhoDto,
} from "../../lib/types";
import type { MusicCard, RichChatMessage, WeatherCard } from "./messageView";

const KINDS: ReadonlySet<string> = new Set([
  "msg",
  "music",
  "weather",
  "redpacket",
  "barrager",
  "custom",
  "unknown",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** 与 offline_store `field_id` 同序：不编造 ID，读不到就当无 ID。 */
function pickId(rec: Record<string, unknown>): string | null {
  for (const key of ["id", "oId", "oid", "messageId"] as const) {
    const field = rec[key];
    if (typeof field === "string") {
      const text = field.trim();
      if (text.length > 0) {
        return text;
      }
      continue;
    }
    if (typeof field === "number" && Number.isFinite(field)) {
      return String(field);
    }
  }
  return null;
}

function mapKind(source: Record<string, unknown>, hasBody: boolean): ChatMessageKind {
  const raw = asString(source.kind)?.toLowerCase();
  if (raw != null && KINDS.has(raw)) {
    return raw as ChatMessageKind;
  }
  return hasBody ? "msg" : "unknown";
}

function mapWeather(value: unknown): WeatherCard | undefined {
  const rec = asRecord(value);
  if (rec == null) {
    return undefined;
  }
  const daysRaw = Array.isArray(rec.days) ? rec.days : [];
  const days = daysRaw
    .map((day) => asRecord(day))
    .filter((day): day is Record<string, unknown> => day != null)
    .map((day) => ({
      date: asString(day.date) ?? "",
      maxTemp: asString(day.maxTemp) ?? "",
      minTemp: asString(day.minTemp) ?? "",
      code: asString(day.code) ?? "",
    }));
  return {
    area: asString(rec.area) ?? "",
    summary: asString(rec.summary) ?? "",
    days,
  };
}

function mapMusic(value: unknown): MusicCard | undefined {
  const rec = asRecord(value);
  if (rec == null) {
    return undefined;
  }
  const audioUrl = asString(rec.audioUrl);
  const card: MusicCard = {
    title: asString(rec.title) ?? "",
    source: asString(rec.source) ?? "",
    coverUrl: asString(rec.coverUrl) ?? "",
    from: asString(rec.from) ?? "",
  };
  if (audioUrl != null && audioUrl.length > 0) {
    card.audioUrl = audioUrl;
  }
  return card;
}

function mapRedpacketWho(value: unknown): RedpacketWhoDto[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const who: RedpacketWhoDto[] = [];
  for (const item of value) {
    const rec = asRecord(item);
    const userName = rec ? asString(rec.userName) : asString(item);
    if (userName == null || userName.length === 0) {
      continue;
    }
    const userId = rec ? asString(rec.userId) : undefined;
    const avatar = rec
      ? (asString(rec.avatar) ?? asString(rec.userAvatarUrl) ?? "")
      : "";
    who.push({
      userName,
      avatar,
      ...(userId ? { userId } : {}),
    });
  }
  return who;
}

function mapRedpacket(value: unknown): RedpacketCardDto | undefined {
  const rec = asRecord(value);
  if (rec == null) {
    return undefined;
  }
  const packetType = asString(rec.type) ?? "";
  const who = mapRedpacketWho(rec.who);
  const recivers = Array.isArray(rec.recivers)
    ? rec.recivers.filter((item): item is string => typeof item === "string")
    : Array.isArray(rec.receivers)
      ? rec.receivers.filter((item): item is string => typeof item === "string")
      : [];
  return {
    type: packetType,
    msg: asString(rec.msg) ?? asString(rec.message) ?? "",
    money: asNumber(rec.money),
    got: asNumber(rec.got),
    count: asNumber(rec.count),
    recivers,
    who,
  };
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * 离线库原始记录 → 可展示聊天室消息。
 * 无 ID / 非对象的条目直接跳过：不编造 ID，也不当成发送成功。
 */
export function mapOfflineChatroomRecord(raw: unknown): RichChatMessage | null {
  const outer = asRecord(raw);
  if (outer == null) {
    return null;
  }
  const nested = asRecord(outer.message);
  const source = nested ?? outer;
  const id = pickId(source) ?? pickId(outer);
  if (id == null) {
    return null;
  }

  const md = asString(source.md);
  const text = asString(source.text);
  const rawHint = asString(source.rawHint);
  const hasBody =
    (md != null && md.length > 0) ||
    (text != null && text.length > 0) ||
    (rawHint != null && rawHint.length > 0);

  const message: RichChatMessage = {
    id,
    kind: mapKind(source, hasBody),
    userName: asString(source.userName) ?? "",
    userNickname: asString(source.userNickname) ?? "",
    userAvatarUrl: asString(source.userAvatarUrl) ?? "",
    time: asString(source.time) ?? "",
    revoked: asBoolean(source.revoked) ?? asBoolean(outer.revoked) ?? false,
  };
  if (md != null) {
    message.md = md;
  }
  if (text != null) {
    message.text = text;
  }
  if (rawHint != null) {
    message.rawHint = rawHint;
  }

  const viaClient = asString(source.viaClient);
  if (viaClient != null) {
    message.viaClient = viaClient;
  }
  const viaVersion = asString(source.viaVersion);
  if (viaVersion != null) {
    message.viaVersion = viaVersion;
  }
  const color = asString(source.color);
  if (color != null) {
    message.color = color;
  }
  const weather = mapWeather(source.weather);
  if (weather != null) {
    message.weather = weather;
  }
  const music = mapMusic(source.music);
  if (music != null) {
    message.music = music;
  }
  const redpacket = mapRedpacket(source.redpacket);
  if (redpacket != null) {
    message.redpacket = redpacket;
  }
  return message;
}

/** 批量映射；无法解析的条目静默跳过。 */
export function mapOfflineChatroomRecords(
  records: readonly unknown[],
): ChatMessageDto[] {
  const out: ChatMessageDto[] = [];
  for (const record of records) {
    const message = mapOfflineChatroomRecord(record);
    if (message != null) {
      out.push(message);
    }
  }
  return out;
}
