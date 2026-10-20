import { useMemo, type MouseEvent } from "react";
import { sanitizeRichHtml } from "../../lib/safeHtml";
import { openSafeExternalUrl, sanitizeHttpUrl } from "../../lib/markdown";
import { isEmojiImage } from "../chatroom/emojiShortcode";
import { playNeteaseSong } from "../music/playlist";
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
  let covered = false;
  for (const frame of document.body.querySelectorAll("iframe")) {
    const src = frame.getAttribute("src");
    const url = src ? new URL(src) : null;
    const type = url?.searchParams.get("type") ?? "";
    const id = url?.searchParams.get("id") ?? "";
    if (!url || url.protocol !== "https:" || url.hostname !== "music.163.com" ||
      url.port || url.pathname !== "/outchain/player" ||
      !/^\d+$/.test(id) || !/^[12]$/.test(type)) {
      frame.remove();
      continue;
    }
    frame.setAttribute(
      "src",
      `https://music.163.com/outchain/player?type=${type}&id=${id}&auto=0&height=${type === "1" ? "430" : "66"}`,
    );
    frame.setAttribute("width", "100%");
    frame.setAttribute("height", type === "1" ? "210" : "86");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.setAttribute("loading", "lazy");
    frame.setAttribute("title", "网易云音乐");
    if (!covered) {
      covered = true;
      const player = document.createElement("div");
      player.className = "content-netease-player";
      const cover = document.createElement("button");
      cover.type = "button";
      cover.className = "content-netease-cover";
      cover.dataset.id = id;
      cover.title = "播放网易云音乐";
      cover.setAttribute("aria-label", "播放网易云音乐");
      frame.replaceWith(player);
      player.append(cover, frame);
    }
  }
  for (const anchor of document.body.querySelectorAll("a")) {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  }
  return document.body.innerHTML;
}

function onClick(event: MouseEvent<HTMLDivElement>): void {
  if (!(event.target instanceof Element)) return;
  const cover = event.target.closest(".content-netease-cover");
  if (cover) {
    event.preventDefault();
    const id = cover.getAttribute("data-id");
    if (id) playNeteaseSong(id);
    return;
  }
  const image = event.target.closest("img");
  if (image) {
    if (isEmojiImage(image)) return;
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
