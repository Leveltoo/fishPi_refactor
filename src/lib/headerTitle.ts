/** 顶栏动态标题：页面往总线写，AppShell 只认当前页的覆盖值。 */

export const HEADER_TITLE_EVENT = "fishpi:header-title";

export type HeaderTitleDetail = {
  /** 归属页面；AppShell 仅在 currentPage 相同时采用 title */
  page: string;
  /** null 表示该页恢复默认标题 */
  title: string | null;
};

export function setHeaderTitle(page: string, title: string | null): void {
  const trimmed = title == null ? null : title.trim();
  window.dispatchEvent(
    new CustomEvent<HeaderTitleDetail>(HEADER_TITLE_EVENT, {
      detail: { page, title: trimmed && trimmed.length > 0 ? trimmed : null },
    }),
  );
}

export function subscribeHeaderTitle(
  next: (detail: HeaderTitleDetail) => void,
): () => void {
  function onEvent(event: Event): void {
    const detail = (event as CustomEvent<HeaderTitleDetail>).detail;
    if (detail?.page) {
      next(detail);
    }
  }
  window.addEventListener(HEADER_TITLE_EVENT, onEvent);
  return () => window.removeEventListener(HEADER_TITLE_EVENT, onEvent);
}
