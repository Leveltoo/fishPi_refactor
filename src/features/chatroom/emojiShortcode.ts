import { DEFAULT_EMOJIS } from "./defaultEmojis";

const SHORTCODE_RE = /:([a-zA-Z0-9_+-]+):/g;

const SHORTCODE_URL: ReadonlyMap<string, string> = new Map(
  DEFAULT_EMOJIS.map((emoji) => [emoji.name.toLowerCase(), emoji.url]),
);

const EMOJI_SRC_MARKERS = [
  "/vditor/dist/images/emoji/",
  "/emoji/graphics/",
];

/**
 * 把 `:doge:` 短码展开成 Markdown 图片。
 * 旧版发 `:name:`，历史 MD 不会自动变图；展示前本地展开，协议与发送一致。
 * 未知短码原样保留。
 */
export function expandEmojiShortcodes(source: string): string {
  if (!source.includes(":")) {
    return source;
  }
  return source.replace(SHORTCODE_RE, (match, name: string) => {
    const url = SHORTCODE_URL.get(name.toLowerCase());
    return url ? `![${name}](${url})` : match;
  });
}

/** HTML 正文里的短码展开成带 `emoji` class 的 img，点击不打开看图。 */
export function expandEmojiShortcodesHtml(source: string): string {
  if (!source.includes(":")) {
    return source;
  }
  return source.replace(SHORTCODE_RE, (match, name: string) => {
    const url = SHORTCODE_URL.get(name.toLowerCase());
    if (!url) {
      return match;
    }
    return `<img class="emoji" src="${url}" alt=":${name}:" />`;
  });
}

export function isDefaultEmojiSrc(src: string | null | undefined): boolean {
  if (src == null || src.length === 0) {
    return false;
  }
  const lower = src.toLowerCase();
  if (EMOJI_SRC_MARKERS.some((marker) => lower.includes(marker))) {
    return true;
  }
  return DEFAULT_EMOJIS.some((emoji) => src === emoji.url || src.startsWith(`${emoji.url}?`));
}

export function isEmojiImage(image: Element): boolean {
  const className = image.getAttribute("class") ?? "";
  if (className.split(/\s+/).includes("emoji")) {
    return true;
  }
  const src =
    image.getAttribute("src") ??
    (image instanceof HTMLImageElement ? image.src : "");
  return isDefaultEmojiSrc(src);
}

/** 检测是否像服务端 HTML 内容（含标签），供 MessageItem 分流。 */
export function looksLikeHtmlContent(source: string): boolean {
  return /<\/?(?:p|img|br|strong|em|a|span|div|ul|ol|li|table|font|blockquote|h[1-6]|iframe|video|details|summary)\b/i.test(
    source,
  );
}
