import { memo, useMemo, type MouseEvent } from "react";

import {
  dispatchPreviewImage,
  dispatchUserCard,
  mentionUserFromLink,
} from "@/features/overlay/events";
import { openSafeExternalUrl, sanitizeHttpUrl } from "./markdown";
import { sanitizeRichHtml } from "./safeHtml";

type RichHtmlProps = {
  source: string;
  className?: string;
};

function onHtmlClick(event: MouseEvent<HTMLDivElement>): void {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const image = target.closest("img");
  if (image instanceof HTMLImageElement) {
    event.preventDefault();
    event.stopPropagation();
    const src = sanitizeHttpUrl(image.getAttribute("src"));
    if (src) {
      dispatchPreviewImage({
        src,
        ...(image.alt?.trim() ? { alt: image.alt } : {}),
      });
    }
    return;
  }

  const anchor = target.closest("a");
  if (anchor == null) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const href = anchor.getAttribute("href");
  const userName = mentionUserFromLink(href, anchor.textContent);
  if (userName) {
    dispatchUserCard(userName);
    return;
  }
  void openSafeExternalUrl(href);
}

/**
 * 服务端 HTML 经 DOMPurify 后展示；点图预览，点链外开。
 * 组件文件不叫 SafeHtml，避免 Windows 下与 `safeHtml.ts` 撞名。
 */
export const RichHtml = memo(function RichHtml({ source, className }: RichHtmlProps) {
  const html = useMemo(() => sanitizeRichHtml(source), [source]);
  return (
    <div
      className={className}
      onClick={onHtmlClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
