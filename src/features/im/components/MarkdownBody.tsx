import { useMemo, type MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { looksLikeHtml } from "../../chatroom/components/ChatHtmlView";
import { expandEmojiShortcodes, isDefaultEmojiSrc, isEmojiImage } from "../../chatroom/emojiShortcode";
import {
  dispatchPreviewImage,
  dispatchUserCard,
  mentionUserFromLink,
} from "../../overlay/events";
import {
  markdownUrlTransform,
  openSafeExternalUrl,
  sanitizeHttpUrl,
} from "../../../lib/markdown";
import { safeMusicHtml } from "../musicEmbed";
import { privateJumpId } from "../threadState";

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

const ALLOWED_ELEMENTS = [
  "p",
  "br",
  "strong",
  "em",
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
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "hr",
];

const MARKDOWN_COMPONENTS: Components = {
  a({ href, children }) {
    const safeHref = privateJumpId(href) ? href : sanitizeHttpUrl(href);
    if (safeHref == null) {
      return <span>{children}</span>;
    }
    return (
      <a href={safeHref} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
  img({ src, alt }) {
    const safeSrc = sanitizeHttpUrl(src);
    if (safeSrc == null) {
      return alt ? <span>{alt}</span> : null;
    }
    const emoji = isDefaultEmojiSrc(safeSrc);
    return (
      <img
        src={safeSrc}
        alt={alt ?? ""}
        loading="lazy"
        className={emoji ? "emoji" : "cursor-pointer"}
      />
    );
  },
};

/** 历史里偶发 `[!]标题](url)`（缺 `!` 在 `[]` 前），规范成 `![标题](url)` 才能出图。 */
function repairBrokenImageMarkdown(source: string): string {
  return source.replace(/\[!\]([^\]]*)\]\(([^)\s]+)\)/g, "![$1]($2)");
}

type MarkdownBodyProps = {
  source: string;
  onJump?: (messageId: string) => void;
};

function onMarkdownClick(
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
        ...(image.alt.trim() ? { alt: image.alt } : {}),
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
  const jumpId = privateJumpId(href);
  if (jumpId != null) {
    onJump?.(jumpId);
    return;
  }
  const userName = mentionUserFromLink(href, anchor.textContent);
  if (userName) {
    dispatchUserCard(userName);
    return;
  }
  void openSafeExternalUrl(href).catch(() => undefined);
}

/**
 * 私聊正文：HTML 净化，保留网易云歌曲/专辑播放器；Markdown 展开短码。
 * 回复锚点走 onJump，不打开系统浏览器。
 */
export function MarkdownBody({ source, onJump }: MarkdownBodyProps) {
  const html = useMemo(() => looksLikeHtml(source) ? safeMusicHtml(source) : null, [source]);
  return html != null ? (
      <div className="im-md im-html" onClick={(event) => onMarkdownClick(event, onJump)}
        dangerouslySetInnerHTML={{ __html: html }} />
    ) : (
      <div
        className="im-md"
        onClick={(event) => {
          onMarkdownClick(event, onJump);
        }}
      >
        <ReactMarkdown
          unwrapDisallowed
          allowedElements={ALLOWED_ELEMENTS}
          urlTransform={(url) => privateJumpId(url) ? url : markdownUrlTransform(url)}
          remarkPlugins={REMARK_PLUGINS}
          components={MARKDOWN_COMPONENTS}
        >
          {repairBrokenImageMarkdown(expandEmojiShortcodes(source))}
        </ReactMarkdown>
      </div>
    );
}
