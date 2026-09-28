import { gestureLabel } from "./constants";
import type { GestureIndex, RedPacketGot, RedPacketInfo } from "./types";

export function openHeadline(
  data: RedPacketInfo,
  selfUserName: string,
): string {
  const self = data.who.find((item) => sameUser(item.userName, selfUserName));
  const isSpecify = data.receivers.length > 0;
  const specified =
    isSpecify && data.receivers.some((name) => sameUser(name, selfUserName));

  if (isSpecify && selfUserName && !specified) {
    return "会错意了";
  }
  if (data.info.gesture !== undefined) {
    return rockPaperTitle(data, selfUserName);
  }
  if (!self) {
    return "错过一个亿";
  }
  if (self.userMoney === 0) {
    return "抢了个寂寞";
  }
  return `${self.userMoney} 积分`;
}

export function maxGotMoney(who: RedPacketGot[]): number {
  if (who.length === 0) {
    return 0;
  }
  return Math.max(...who.map((item) => item.userMoney));
}

export function isLuckyKing(
  item: RedPacketGot,
  data: RedPacketInfo,
  maxMoney: number,
): boolean {
  if (
    data.info.got !== data.info.count ||
    data.info.count === 0 ||
    item.userMoney !== maxMoney ||
    item.userMoney === 0
  ) {
    return false;
  }
  const first = data.who.find((entry) => entry.userMoney === maxMoney);
  return first !== undefined && first.userName === item.userName;
}

function rockPaperTitle(data: RedPacketInfo, selfUserName: string): string {
  const sender = data.info.userName;
  const first = data.who[0];
  if (sameUser(sender, selfUserName) && first) {
    if (first.userMoney > 0) {
      return "猜拳落败！";
    }
    if (first.userMoney === 0) {
      return "打成平手";
    }
    return "猜拳胜利！";
  }
  if (sameUser(sender, selfUserName)) {
    return "还没人猜...";
  }
  if (first && sameUser(first.userName, selfUserName)) {
    if (first.userMoney > 0) {
      return "猜拳胜利！";
    }
    if (first.userMoney === 0) {
      return "打成平手";
    }
    return "猜拳落败！";
  }
  return "错过一个亿";
}

export function senderGestureText(
  userName: string,
  gesture: GestureIndex | undefined,
): string {
  const label = gestureLabel(gesture);
  if (!userName) {
    return label ? `出 ${label}` : "";
  }
  return label ? `${userName} 出 ${label}` : userName;
}

export function sameUser(left: string, right: string): boolean {
  return left.length > 0 && left.toLowerCase() === right.toLowerCase();
}
