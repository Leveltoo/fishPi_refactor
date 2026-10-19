import { communityNoticeUrl, type NoticeTarget } from "../shell/navigation";
import type { NoticeItemDto } from "./types";

/**
 * oId 收紧为纯数字，与 Rust `numeric_id`（`fix/notify-target-article @ 1c92b7d`）同集。
 *
 * 判据 (i)：不拿未证实的事实当依据，也不为此放宽后端边界。收紧后两种形状都不静默
 * 失败——数字 oId 走应用内深链；非数字归 out 走 external，等于 FE-02 之前的原有行为，
 * 通知照弹。反之若前端产出 Rust 必拒的形状，后果是整条通知不弹（跨层契约断裂）。
 *
 * 服务端 oId 是否恒为数字**未经取证证实**（本仓 `article/api.ts:594` 把 oId 当不透明
 * 字符串从 id/oId/articleId 里取，全仓无数字解析），所以这里只锁两侧集合一致、不下
 * 事实结论；非数字 oId 的实际占比留给验证性取证再评。
 */
const ARTICLE_PATH = /^\/article\/(\d{1,64})$/;
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
