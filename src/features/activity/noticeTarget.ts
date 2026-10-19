import { communityNoticeUrl, type NoticeTarget } from "../shell/navigation";
import type { NoticeItemDto } from "./types";

const ARTICLE_PATH = /^\/article\/([A-Za-z0-9_-]{1,64})$/;
const COMMENT_HASH = /^#comment(\d{1,32})$/;

/**
 * 站内文章链接的三态判定。
 *
 * `in` 站内文章深链（`#top` 这类非评论锚算「无锚可丢」，不属降级）；
 * `out` 不是站内文章；
 * `invalid` 是站内文章、但评论锚形状不合规（`#commentABC`、>32 位等）——
 * **整体拒绝**，既不静默退化成无锚跳转，也不退化成 external 开浏览器。
 */
export type ArticleLink =
  | { state: "in"; oId: string; commentId?: string }
  | { state: "out" }
  | { state: "invalid"; oId: string };

export function articleDeepLink(raw: string | undefined): ArticleLink {
  const href = communityNoticeUrl(raw);
  if (!href) {
    return { state: "out" };
  }
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { state: "out" };
  }
  if (url.search) {
    return { state: "out" };
  }
  const path = ARTICLE_PATH.exec(url.pathname);
  if (!path) {
    return { state: "out" };
  }
  if (!url.hash) {
    return { state: "in", oId: path[1] };
  }
  if (!url.hash.startsWith("#comment")) {
    return { state: "in", oId: path[1] };
  }
  const hash = COMMENT_HASH.exec(url.hash);
  return hash
    ? { state: "in", oId: path[1], commentId: hash[1] }
    : { state: "invalid", oId: path[1] };
}

export function noticeTarget(item: NoticeItemDto): NoticeTarget | undefined {
  if (item.deleted) {
    return undefined;
  }
  if (item.type === "at" && item.dataType === 38 && item.dataId) {
    return { page: "chatroom", messageId: item.dataId };
  }
  const link = articleDeepLink(item.url);
  if (link.state === "invalid") {
    return undefined;
  }
  if (link.state === "in") {
    return link.commentId
      ? { page: "article", oId: link.oId, commentId: link.commentId }
      : { page: "article", oId: link.oId };
  }
  const url = communityNoticeUrl(item.url);
  return url ? { page: "external", url } : undefined;
}
