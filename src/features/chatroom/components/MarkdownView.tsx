import { memo, type MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import {
  dispatchPreviewImage,
  dispatchUserCard,
  mentionUserFromLink,
} from "@/features/overlay/events";
import { expandEmojiShortcodes, isDefaultEmojiSrc, isEmojiImage } from "../emojiShortcode";
import { dispatchChatJump, dispatchDiscussPick } from "../jumpEvents";
import {
  markdownUrlTransform,
  openSafeExternalUrl,
  sanitizeHttpUrl,
} from "../../../lib/markdown";

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

type MarkdownViewProps = {
  source: string;
};

/** 历史里偶发 `[!]标题](url)`（缺 `!` 在 `[]` 前），规范成 `![标题](url)` 才能出图。 */
function repairBrokenImageMarkdown(source: string): string {
  return source.replace(/\[!\]([^\]]*)\]\(([^)\s]+)\)/g, "![$1]($2)");
}

/** 旧 formatContent 的 `# x #`（code/em/a）：命中则返回话题。 */
export function topicFromTarget(target: Element): string | null {
  const host = target.closest("code, em, a");
  if (host == null) {
    return null;
  }
  const match = /^#\s*(.+?)\s*#$/.exec((host.textContent ?? "").trim());
  return match == null ? null : match[1].trim();
}

/** 回复锚点：聊天室 `#chatroom123` 或私聊 `#chat123`。 */
export function chatJumpIdFromHref(href: string | null): string | null {
  if (href == null) {
    return null;
  }
  const room = /#chatroom(\d+)/.exec(href);
  if (room != null) {
    return room[1];
  }
  const chat = /#chat(\d+)/.exec(href);
  return chat == null ? null : chat[1];
}

function onMarkdownClick(event: MouseEvent<HTMLDivElement>): void {
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

/**
 * 成熟 Markdown 渲染：react-markdown 默认不执行原始 HTML。
 * 链接仅 http(s)，点击走系统浏览器，禁止 WebView 内跳转。
 * 图片点击派发 `fishpi:preview-image`；短码 `:name:` 展开为表情图。
 */
export const MarkdownView = memo(function MarkdownView({
  source,
}: MarkdownViewProps) {
  const markdown = repairBrokenImageMarkdown(expandEmojiShortcodes(source));
  return (
    <div className="chat-md" onClick={onMarkdownClick}>
      <ReactMarkdown
        unwrapDisallowed
        allowedElements={ALLOWED_ELEMENTS}
        urlTransform={markdownUrlTransform}
        remarkPlugins={REMARK_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
});
