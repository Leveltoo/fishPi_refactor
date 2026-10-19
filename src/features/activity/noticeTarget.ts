import { communityNoticeUrl, type NoticeTarget } from "../shell/navigation";
import type { NoticeItemDto } from "./types";

const ARTICLE_PATH = /^\/article\/([A-Za-z0-9_-]{1,64})$/;
const COMMENT_HASH = /^#comment(\d{1,32})$/;

/**
 * 站内文章深链识别：`https://fishpi.cn/article/{oId}` 或带 `#comment{id}` 锚点。
 *
 * 查询式 `/article?id=` 不认（服务端 302 形态，M1 显式走 external）；
 * 任何非 fishpi.cn origin、含凭据的 url 都不站内化。
 */
export function articleDeepLink(
  raw: string | undefined,
): { oId: string; commentId?: string } | undefined {
  const href = communityNoticeUrl(raw);
  if (!href) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (url.search) {
    return undefined;
  }
  const path = ARTICLE_PATH.exec(url.pathname);
  if (!path) {
    return undefined;
  }
  const hash = url.hash ? COMMENT_HASH.exec(url.hash) : null;
  return hash ? { oId: path[1], commentId: hash[1] } : { oId: path[1] };
}

export function noticeTarget(item: NoticeItemDto): NoticeTarget | undefined {
  if (item.deleted) {
    return undefined;
  }
  if (item.type === "at" && item.dataType === 38 && item.dataId) {
    return { page: "chatroom", messageId: item.dataId };
  }
  const deep = articleDeepLink(item.url);
  if (deep) {
    return deep.commentId
      ? { page: "article", oId: deep.oId, commentId: deep.commentId }
      : { page: "article", oId: deep.oId };
  }
  const url = communityNoticeUrl(item.url);
  return url ? { page: "external", url } : undefined;
}
