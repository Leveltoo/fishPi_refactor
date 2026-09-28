import type { MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import {
  markdownUrlTransform,
  openSafeExternalUrl,
  sanitizeHttpUrl,
} from "../../lib/markdown";
import { dispatchPreviewImage } from "./events";

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
      <a
        href={safeHref}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void openSafeExternalUrl(safeHref);
        }}
      >
        {children}
      </a>
    );
  },
  img({ src, alt }) {
    const safeSrc = sanitizeHttpUrl(src);
    if (safeSrc == null) {
      return alt ? <span>{alt}</span> : null;
    }
    const label = alt ?? "";
    return (
      <button
        type="button"
        className="article-md-img"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          dispatchPreviewImage(safeSrc, label);
        }}
      >
        <img src={safeSrc} alt={label} loading="lazy" />
      </button>
    );
  },
};

type MarkdownBodyProps = {
  source: string;
  className?: string;
};

function onMarkdownClick(event: MouseEvent<HTMLDivElement>): void {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const image = target.closest("img");
  if (image instanceof HTMLImageElement) {
    const safeSrc = sanitizeHttpUrl(image.getAttribute("src"));
    if (safeSrc) {
      event.preventDefault();
      event.stopPropagation();
      dispatchPreviewImage(safeSrc, image.getAttribute("alt") ?? "");
      return;
    }
  }
  const anchor = target.closest("a");
  if (anchor == null) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  void openSafeExternalUrl(anchor.getAttribute("href"));
}

/**
 * 成熟 Markdown 渲染：react-markdown 默认不执行原始 HTML。
 * 链接仅 http(s)；图片点击派发 `fishpi:preview-image`。
 */
export function MarkdownBody({ source, className }: MarkdownBodyProps) {
  return (
    <div className={className ?? "article-md"} onClick={onMarkdownClick}>
      <ReactMarkdown
        unwrapDisallowed
        allowedElements={ALLOWED_ELEMENTS}
        urlTransform={markdownUrlTransform}
        remarkPlugins={REMARK_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
