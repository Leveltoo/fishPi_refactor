import DOMPurify from "dompurify";
import { expandEmojiShortcodes } from "../features/chatroom/emojiShortcode";

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
];

/** 服务端评论/正文/清风明月常是 HTML。 */
export function looksLikeHtml(source: string): boolean {
  return /<\/?(?:p|img|br|strong|em|a|span|div|ul|ol|li|table|font|blockquote|h[1-6]|pre|code|iframe)\b/i.test(
    source,
  );
}

/** 链接与图片只放行 http(s)；协议相对地址按 https。 */
const ALLOWED_URI_REGEXP = /^(?:https?:|\/\/)/i;

/** 只保留白名单标签。禁止 script / 事件属性。链接只放行 http(s)。 */
export function sanitizeRichHtml(source: string): string {
  const withEmoji = expandEmojiShortcodes(source);
  return DOMPurify.sanitize(withEmoji, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP,
    FORBID_TAGS: ["script", "object", "embed", "link", "meta", "form"],
    FORBID_ATTR: ["srcdoc"],
  });
}
