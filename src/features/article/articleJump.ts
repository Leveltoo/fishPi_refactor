/**
 * 帖子深链跳转的 window CustomEvent 约定（对齐 chatroom/jumpEvents.ts 的形态）。
 *
 * 派发方：shell/navigation.openNoticeTarget（通知点击、站内分享锚点）。
 * 监听方：ArticleHost（打开详情，并在已加载窗口内滚动定位评论）。
 */

/** 打开帖子详情。detail: `{ oId, commentId? }` */
export const FISHPI_ARTICLE_JUMP = "fishpi:article-jump";

export type ArticleJumpDetail = { oId: string; commentId?: string };

export function dispatchArticleJump(oId: string, commentId?: string): void {
  const trimmed = oId.trim();
  if (!trimmed) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<ArticleJumpDetail>(FISHPI_ARTICLE_JUMP, {
      detail: { oId: trimmed, commentId: commentId?.trim() || undefined },
    }),
  );
}

/** 监听帖子跳转；返回取消监听函数。 */
export function listenArticleJump(
  cb: (oId: string, commentId?: string) => void,
): () => void {
  const handler = (event: Event): void => {
    const detail = (event as CustomEvent<ArticleJumpDetail>).detail;
    if (detail != null && typeof detail.oId === "string" && detail.oId.trim()) {
      cb(detail.oId.trim(), detail.commentId);
    }
  };
  window.addEventListener(FISHPI_ARTICLE_JUMP, handler);
  return () => window.removeEventListener(FISHPI_ARTICLE_JUMP, handler);
}
