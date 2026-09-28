import type { MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
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
    return <img src={safeSrc} alt={alt ?? ""} loading="lazy" />;
  },
};

/** 历史里偶发 `[!]标题](url)`（缺 `!` 在 `[]` 前），规范成 `![标题](url)` 才能出图。 */
function repairBrokenImageMarkdown(source: string): string {
  return source.replace(/\[!\]([^\]]*)\]\(([^)\s]+)\)/g, "![$1]($2)");
}

type MarkdownBodyProps = {
  source: string;
};

function onMarkdownClick(event: MouseEvent<HTMLDivElement>): void {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const anchor = target.closest("a");
  if (anchor == null) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  void openSafeExternalUrl(anchor.getAttribute("href"));
}

export function MarkdownBody({ source }: MarkdownBodyProps) {
  return (
    <div className="im-md" onClick={onMarkdownClick}>
      <ReactMarkdown
        unwrapDisallowed
        allowedElements={ALLOWED_ELEMENTS}
        urlTransform={markdownUrlTransform}
        remarkPlugins={REMARK_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {repairBrokenImageMarkdown(source)}
      </ReactMarkdown>
    </div>
  );
}
