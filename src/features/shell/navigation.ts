import { openUrl } from "@tauri-apps/plugin-opener";
import { dispatchArticleJump } from "../article/articleJump";
import { dispatchChatJump } from "../chatroom/jumpEvents";
import { openImWithUser, OPEN_SETTINGS_EVENT } from "../../lib/nav";

export const OPEN_CHATROOM_EVENT = "fishpi:open-chatroom";
export const OPEN_ARTICLE_EVENT = "fishpi:open-article";

export type NoticeTarget =
  | { page: "chatroom"; messageId?: string }
  | { page: "article"; oId: string; commentId?: string }
  | { page: "im"; userName: string }
  | { page: "settings" }
  | { page: "external"; url: string };

/** Notification links may only leave the app for the community's HTTPS origin. */
export function communityNoticeUrl(raw: string | undefined): string | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  try {
    const url = new URL(raw, "https://fishpi.cn");
    return url.origin === "https://fishpi.cn" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export async function openNoticeTarget(target: NoticeTarget): Promise<void> {
  if (target.page === "chatroom") {
    window.dispatchEvent(new Event(OPEN_CHATROOM_EVENT));
    if (target.messageId) {
      requestAnimationFrame(() => dispatchChatJump(target.messageId!));
    }
  } else if (target.page === "article") {
    const { oId, commentId } = target;
    window.dispatchEvent(new Event(OPEN_ARTICLE_EVENT));
    requestAnimationFrame(() => dispatchArticleJump(oId, commentId));
  } else if (target.page === "im") {
    openImWithUser(target.userName);
  } else if (target.page === "settings") {
    window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT));
  } else {
    const url = communityNoticeUrl(target.url);
    if (!url) {
      throw new Error("通知链接无效");
    }
    await openUrl(url);
  }
}
