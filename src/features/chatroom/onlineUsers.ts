import type { OnlineUser } from "../../lib/types";

/** 聊天室在线列表的最近一帧，给发红包 overlay 带用户头像用。 */
let users: OnlineUser[] = [];

export function rememberOnlineUsers(next: OnlineUser[]): void {
  users = next;
}

export function currentOnlineUsers(): OnlineUser[] {
  return users;
}
