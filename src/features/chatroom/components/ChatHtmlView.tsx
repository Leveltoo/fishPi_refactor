import { memo, useMemo, type MouseEvent } from "react";
import DOMPurify from "dompurify";
import {
  dispatchPreviewImage,
  dispatchUserCard,
  mentionUserFromLink,
} from "@/features/overlay/events";
import { expandEmojiShortcodes } from "../emojiShortcode";
import { dispatchChatJump, dispatchDiscussPick } from "../jumpEvents";
import {
  chatJumpIdFromHref,
  topicFromTarget,
} from "./MarkdownView";
import { openSafeExternalUrl, sanitizeHttpUrl } from "../../../lib/markdown";

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "a",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "img",
  "span",
  "div",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "hr",
  "font",
];

const ALLOWED_ATTR = [
  "href",
  "src",
  "alt",
  "title",
  "class",
  "width",
  "height",
  "style",
  "color",
  "align",
  "target",
  "rel",
  "colspan",
  "rowspan",
  "start",
  "type",
];

/** 服务端 content/md 可能是 HTML（旧客户端 v-html）。先净化再插入，禁止 script/事件。 */
export function looksLikeHtml(source: string): boolean {
  return /<\/?(?:p|img|br|strong|em|a|span|div|ul|ol|li|table|font|blockquote|h[1-6])\b/i.test(
    source,
  );
}

function sanitizeChatHtml(source: string): string {
  const withEmoji = expandEmojiShortcodes(source);
  return DOMPurify.sanitize(withEmoji, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}

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

  const topic = topicFromTarget(target);
  if (topic != null) {
    event.preventDefault();
    event.stopPropagation();
    dispatchDiscussPick(topic);
    return;
  }

  const anchor = target.closest("a");
  if (anchor == null) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const href = anchor.getAttribute("href");
  const jumpId = chatJumpIdFromHref(href);
  if (jumpId != null) {
    dispatchChatJump(jumpId);
    return;
  }
  const userName = mentionUserFromLink(href, anchor.textContent);
  if (userName) {
    dispatchUserCard(userName);
    return;
  }
  void openSafeExternalUrl(href);
}

type ChatHtmlViewProps = {
  source: string;
};

/** 旧版 formatContent 对齐：服务端 HTML 经 DOMPurify 后展示；点击图片开预览。 */
export const ChatHtmlView = memo(function ChatHtmlView({
  source,
}: ChatHtmlViewProps) {
  const html = useMemo(() => sanitizeChatHtml(source), [source]);
  return (
    <div
      className="chat-md chat-html"
      onClick={onHtmlClick}
      // 仅渲染 DOMPurify 白名单结果
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
