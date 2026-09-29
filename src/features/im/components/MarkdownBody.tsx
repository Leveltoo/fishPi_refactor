import type { MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { ChatHtmlView, looksLikeHtml } from "../../chatroom/components/ChatHtmlView";
import { expandEmojiShortcodes, isDefaultEmojiSrc, isEmojiImage } from "../../chatroom/emojiShortcode";
import { chatJumpIdFromHref } from "../../chatroom/components/MarkdownView";
import { MusicCard } from "../../chatroom/components/MusicCard";
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
import { musicCardFromContent, stripNeteaseIframes } from "../musicEmbed";

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
    const safeHref = sanitizeHttpUrl(href);
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
  const jumpId = chatJumpIdFromHref(href);
  if (jumpId != null) {
    onJump?.(jumpId);
    return;
  }
  const userName = mentionUserFromLink(href, anchor.textContent);
  if (userName) {
    dispatchUserCard(userName);
    return;
  }
  void openSafeExternalUrl(href);
}

function looksLikeMarkdown(text: string): boolean {
  return (
    /!\[[^\]]*\]\([^)]+\)/.test(text) ||
    /\[[^\]]+\]\([^)]+\)/.test(text) ||
    /:[a-zA-Z0-9_+-]+:/.test(text)
  );
}

/**
 * 私聊正文：HTML 走净化渲染；Markdown 展开短码；网易云 iframe/链接转播放卡。
 * 回复锚点走 onJump，不打开系统浏览器。
 */
export function MarkdownBody({ source, onJump }: MarkdownBodyProps) {
  const music = musicCardFromContent(source);
  const remainder = music ? stripNeteaseIframes(source) : source;
  const body =
    remainder.length === 0 ? null : looksLikeHtml(remainder) ? (
      <ChatHtmlView source={remainder} onJump={onJump} />
    ) : looksLikeMarkdown(remainder) || remainder.includes(":") ? (
      <div
        className="im-md"
        onClick={(event) => {
          onMarkdownClick(event, onJump);
        }}
      >
        <ReactMarkdown
          unwrapDisallowed
          allowedElements={ALLOWED_ELEMENTS}
          urlTransform={markdownUrlTransform}
          remarkPlugins={REMARK_PLUGINS}
          components={MARKDOWN_COMPONENTS}
        >
          {repairBrokenImageMarkdown(expandEmojiShortcodes(remainder))}
        </ReactMarkdown>
      </div>
    ) : (
      <p className="im-msg-plain">{remainder}</p>
    );

  return (
    <>
      {music ? <MusicCard card={music} fallback="网易云音乐" /> : null}
      {body}
    </>
  );
}
