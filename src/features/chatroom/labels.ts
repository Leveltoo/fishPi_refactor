/** Bridge 已证实状态；Unknown 必须用这句文案，不能用「暂时无消息」代替离线。 */
export function connectionStatusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case "connecting":
      return "正在连接";
    case "connected":
      return "已连接";
    case "disconnected":
      return "已断开";
    case "reconnecting":
      return "正在重连";
    case "unknown":
    default:
      return "连接状态未知";
  }
}

export function isDisconnectedStatus(status: string): boolean {
  return status.toLowerCase() === "disconnected";
}

export function isUnknownStatus(status: string): boolean {
  const key = status.toLowerCase();
  return key === "unknown" || key === "";
}
