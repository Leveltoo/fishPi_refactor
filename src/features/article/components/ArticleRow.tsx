import { Badge } from "@/components/ui/badge";

import { sanitizeHttpUrl } from "../../../lib/markdown";
import { dispatchPreviewImage } from "../events";
import type { ArticleSummary } from "../types";
import { AuthorChip } from "./AuthorChip";

type ArticleRowProps = {
  item: ArticleSummary;
  onOpen: (id: string) => void;
};

export function ArticleRow({ item, onOpen }: ArticleRowProps) {
  const thumb = sanitizeHttpUrl(item.thumbnailUrl);
  return (
    <article className="article-row">
      <div className="article-row-main">
        <button
          type="button"
          className="article-row-open"
          onClick={() => onOpen(item.id)}
        >
          <span className="article-row-title">
            {item.sticky ? <Badge className="article-flag">置顶</Badge> : null}
            {item.perfect ? <Badge className="article-flag">优选</Badge> : null}
            {item.title}
          </span>
          {item.preview ? (
            <span className="article-row-preview">{item.preview}</span>
          ) : null}
        </button>
        <div className="article-row-meta">
          <AuthorChip
            userName={item.authorUserName}
            displayName={item.authorNickname}
            avatarUrl={item.avatarUrl}
          />
          <span>{item.time}</span>
          <span>{item.commentCount} 评</span>
          <span className="article-views">{item.viewCountDisplay || item.viewCount} 阅</span>
        </div>
      </div>
      {thumb ? (
        <button
          type="button"
          className="article-thumb"
          aria-label="预览封面"
          onClick={() => dispatchPreviewImage(thumb, item.title)}
        >
          <img src={thumb} alt="" />
        </button>
      ) : null}
    </article>
  );
}
