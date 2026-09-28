import type { GestureIndex, RedPacketType } from "./types";

export const REDPACKET_TYPES: readonly {
  value: RedPacketType;
  label: string;
}[] = [
  { value: "random", label: "拼手气红包" },
  { value: "average", label: "普通红包" },
  { value: "specify", label: "专属红包" },
  { value: "heartbeat", label: "心跳红包" },
  { value: "rockPaperScissors", label: "猜拳红包" },
];

export const DEFAULT_BLESSING: Record<RedPacketType, string> = {
  random: "摸鱼者，事竟成！",
  average: "平分红包，人人有份！",
  specify: "试试看，这是给你的红包吗？",
  heartbeat: "玩的就是心跳！",
  rockPaperScissors: "石头剪刀布！",
};

export const GESTURES: readonly {
  value: GestureIndex;
  label: string;
}[] = [
  { value: 0, label: "石头" },
  { value: 1, label: "剪刀" },
  { value: 2, label: "布" },
];

export const DEFAULT_MONEY = 32;
export const DEFAULT_COUNT = 2;
export const MAX_COUNT = 1000;
export const ROCK_PAPER_MIN_MONEY = 256;

export function typeLabel(type: RedPacketType | undefined): string {
  return REDPACKET_TYPES.find((item) => item.value === type)?.label ?? "红包";
}

export function gestureLabel(index: GestureIndex | undefined): string {
  if (index === undefined) {
    return "";
  }
  return GESTURES.find((item) => item.value === index)?.label ?? "";
}

export function isRedPacketType(value: string): value is RedPacketType {
  return REDPACKET_TYPES.some((item) => item.value === value);
}
