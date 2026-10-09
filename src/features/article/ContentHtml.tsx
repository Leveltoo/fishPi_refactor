import { useMemo, type MouseEvent } from "react";
import { sanitizeRichHtml } from "../../lib/safeHtml";
import { openSafeExternalUrl, sanitizeHttpUrl } from "../../lib/markdown";
import { dispatchPreviewImage, dispatchUserCard, mentionUserFromLink } from "../overlay/events";

export function sanitizeContentHtml(source: string): string {
  const document = new DOMParser().parseFromString(sanitizeRichHtml(source), "text/html");
  for (const element of document.body.querySelectorAll("*")) {
    element.removeAttribute("style");
    for (const attribute of ["href", "src"]) {
      if (!element.hasAttribute(attribute)) continue;
      const url = sanitizeHttpUrl(element.getAttribute(attribute));
      if (url) element.setAttribute(attribute, url);
      else element.removeAttribute(attribute);
    }
  }
  for (const frame of document.body.querySelectorAll("iframe")) {
    const src = frame.getAttribute("src");
    const url = src ? new URL(src) : null;
    if (!url || url.protocol !== "https:" || url.hostname !== "music.163.com" ||
      url.port || url.pathname !== "/outchain/player" ||
      !/^\d+$/.test(url.searchParams.get("id") ?? "") ||
      !/^[12]$/.test(url.searchParams.get("type") ?? "")) {
      frame.remove();
      continue;
    }
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.setAttribute("loading", "lazy");
    frame.setAttribute("title", "网易云音乐");
  }
  for (const anchor of document.body.querySelectorAll("a")) {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  }
  return document.body.innerHTML;
}

function onClick(event: MouseEvent<HTMLDivElement>): void {
  if (!(event.target instanceof Element)) return;
  const image = event.target.closest("img");
  if (image) {
    event.preventDefault();
    const src = sanitizeHttpUrl(image.getAttribute("src"));
    if (src) dispatchPreviewImage({ src, alt: image.getAttribute("alt") ?? "" });
    return;
  }
  const anchor = event.target.closest("a");
  if (!anchor) return;
  event.preventDefault();
  const href = anchor.getAttribute("href");
  const user = mentionUserFromLink(href, anchor.textContent);
  if (user) dispatchUserCard(user);
  else void openSafeExternalUrl(href);
}

export function ContentHtml({ source, className }: { source: string; className: string }) {
  const html = useMemo(() => sanitizeContentHtml(source), [source]);
  return <div className={className} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
