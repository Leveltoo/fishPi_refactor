import { communityNoticeUrl, type NoticeTarget } from "../shell/navigation";
import type { NoticeItemDto } from "./types";

export function noticeTarget(item: NoticeItemDto): NoticeTarget | undefined {
  if (item.deleted) {
    return undefined;
  }
  if (item.type === "at" && item.dataType === 38 && item.dataId) {
    return { page: "chatroom", messageId: item.dataId };
  }
  const url = communityNoticeUrl(item.url);
  return url ? { page: "external", url } : undefined;
}
