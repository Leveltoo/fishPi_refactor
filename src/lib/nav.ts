/** 跨页面导航：聊天室右键「单独聊聊」→ 壳切到私聊并打开会话。 */

export const OPEN_IM_EVENT = "fishpi:open-im";

export type OpenImDetail = { userName: string };

export function openImWithUser(userName: string): void {
  const trimmed = userName.trim();
  if (trimmed.length === 0) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<OpenImDetail>(OPEN_IM_EVENT, { detail: { userName: trimmed } }),
  );
}
