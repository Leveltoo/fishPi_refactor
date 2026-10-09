export type ChatroomReconnectReport = {
  sessionGeneration: number;
  attempted: boolean;
  relinked: boolean;
  message: string;
  chatroom: string;
  chat: string;
  notice: string;
};

export function shouldRefreshAfterReconnect(
  report: ChatroomReconnectReport,
  sessionGeneration: number | undefined,
): boolean {
  return sessionGeneration != null &&
    report.sessionGeneration === sessionGeneration &&
    report.attempted && report.relinked && report.chatroom === "已重新连接";
}
