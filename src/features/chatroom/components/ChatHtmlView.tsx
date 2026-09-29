import { memo, useMemo, type MouseEvent } from "react";
import DOMPurify from "dompurify";
import {
  dispatchPreviewImage,
  dispatchUserCard,
  mentionUserFromLink,
} from "@/features/overlay/events";
import {
  expandEmojiShortcodesHtml,
  isEmojiImage,
  looksLikeHtmlContent,
} from "../emojiShortcode";
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
  "iframe",
  "video",
  "source",
  "details",
  "summary",
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
  "frameborder",
  "border",
  "marginwidth",
  "marginheight",
  "allowfullscreen",
  "scrolling",
  "controls",
  "poster",
  "preload",
  "playsinline",
  "open",
];

/** 只放行 http(s)、协议相对、页内锚点；禁止 javascript / data / file。 */
const ALLOWED_URI_REGEXP = /^(?:https?:|\/\/|#)/i;

let purifyHooked = false;

function isHttpUrl(value: string): boolean {
  return sanitizeHttpUrl(value) != null;
}

function isNeteasePlayer(src: string): boolean {
  try {
    const url = new URL(src, "https://music.163.com");
    const host = url.hostname.toLowerCase();
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (host === "music.163.com" || host === "www.music.163.com") &&
      url.pathname.includes("/outchain/player")
    );
  } catch {
    return false;
  }
}

function rewriteNeteaseSrc(src: string): string | null {
  if (!isNeteasePlayer(src)) {
    return null;
  }
  try {
    return new URL(src, "https://music.163.com").href;
  } catch {
    return null;
  }
}

function ensurePurifyHooks(): void {
  if (purifyHooked) {
    return;
  }
  purifyHooked = true;
  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    const name = data.attrName;
    if (name === "href" || name === "src") {
      const value = data.attrValue.trim();
      const lower = value.toLowerCase();
      if (
        lower.startsWith("javascript:") ||
        lower.startsWith("data:") ||
        lower.startsWith("vbscript:") ||
        lower.startsWith("file:")
      ) {
        data.keepAttr = false;
        return;
      }
      if (node.nodeName === "IFRAME" && name === "src") {
        const rewritten = rewriteNeteaseSrc(value);
        if (rewritten == null) {
          data.keepAttr = false;
          return;
        }
        data.attrValue = rewritten;
        return;
      }
      if (name === "href") {
        if (value.startsWith("#")) {
          return;
        }
        if (!isHttpUrl(value)) {
          data.keepAttr = false;
        }
        return;
      }
      if (!isHttpUrl(value)) {
        data.keepAttr = false;
      }
    }
  });
}

/** 服务端 content 可能是 HTML（旧客户端 v-html）。先净化再插入，禁止 script/事件。 */
export function looksLikeHtml(source: string): boolean {
  return looksLikeHtmlContent(source);
}

/** 展示优先服务端 HTML（text），否则 md 里的 HTML。 */
export function messageHtmlSource(message: {
  md?: string;
  text?: string;
}): string | null {
  const text = message.text?.trim() ?? "";
  if (text.length > 0 && looksLikeHtml(text)) {
    return text;
  }
  const md = message.md?.trim() ?? "";
  if (md.length > 0 && looksLikeHtml(md)) {
    return md;
  }
  return null;
}

function sanitizeChatHtml(source: string): string {
  ensurePurifyHooks();
  const withEmoji = expandEmojiShortcodesHtml(source);
  return DOMPurify.sanitize(withEmoji, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP,
    FORBID_TAGS: ["script", "object", "embed", "link", "meta", "form"],
    FORBID_ATTR: ["srcdoc"],
  });
}

function onHtmlClick(
  event: MouseEvent<HTMLDivElement>,
  onJump?: (messageId: string) => void,
): void {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const image = target.closest("img");
  if (image instanceof HTMLImageElement) {
    event.preventDefault();
    event.stopPropagation();
    if (isEmojiImage(image)) {
      return;
    }
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
    if (onJump) {
      onJump(jumpId);
    } else {
      dispatchChatJump(jumpId);
    }
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
  /** 私聊传入：回复锚点在会话内跳转，不走聊天室全局事件。 */
  onJump?: (messageId: string) => void;
};

/** 旧版 formatContent 对齐：服务端 HTML 经 DOMPurify 后展示；表情短码不打开看图。 */
export const ChatHtmlView = memo(function ChatHtmlView({
  source,
  onJump,
}: ChatHtmlViewProps) {
  const html = useMemo(() => sanitizeChatHtml(source), [source]);
  return (
    <div
      className="chat-md chat-html"
      onClick={(event) => {
        onHtmlClick(event, onJump);
      }}
      // 仅渲染 DOMPurify 白名单结果
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
