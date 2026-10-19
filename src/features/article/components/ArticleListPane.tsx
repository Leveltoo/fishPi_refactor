import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

import {
  ARTICLE_LIST_TYPE_LABEL,
  ARTICLE_LIST_TYPES,
} from "../types";
import type { ArticleListType, ArticleSummary } from "../types";
import { ArticleRow } from "./ArticleRow";

type ArticleListPaneProps = {
  listType: ArticleListType;
  items: ArticleSummary[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  listAvailable: boolean;
  onChangeType: (type: ArticleListType) => void;
  onOpen: (id: string) => void;
  onLoadMore: () => void;
  onRetry: () => void;
};

export function ArticleListPane({
  listType,
  items,
  loading,
  loadingMore,
  hasMore,
  listAvailable,
  onChangeType,
  onOpen,
  onLoadMore,
  onRetry,
}: ArticleListPaneProps) {
  return (
    <section className="article-pane" aria-label="帖子列表">
      <header className="article-head">
        <p className="article-kicker">帖子</p>
        <div className="article-tabs" role="tablist" aria-label="列表类型">
          {ARTICLE_LIST_TYPES.map((type) => {
            const active = type === listType;
            return (
              <button
                key={type}
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? "article-tab is-active" : "article-tab"}
                onClick={() => onChangeType(type)}
              >
                {ARTICLE_LIST_TYPE_LABEL[type]}
              </button>
            );
          })}
        </div>
      </header>

      <ScrollArea className="article-scroll">
        {loading ? (
          <div className="article-skel" aria-busy="true" aria-label="正在加载帖子">
            <Skeleton className="article-skel-row" />
            <Skeleton className="article-skel-row" />
            <Skeleton className="article-skel-row" />
          </div>
        ) : items.length === 0 ? (
          <div className="article-empty">
            <p>{listAvailable ? "暂无帖子" : "列表命令尚未接入，无法加载。"}</p>
            {listAvailable ? (
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                重试
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="article-list">
            {items.map((item) => (
              <li key={item.id}>
                <ArticleRow item={item} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        )}

        {hasMore && !loading ? (
          <div className="article-more">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loadingMore}
              onClick={onLoadMore}
            >
              {loadingMore ? <Spinner /> : null}
              {loadingMore ? "加载中" : "加载更多"}
            </Button>
          </div>
        ) : null}
      </ScrollArea>
    </section>
  );
}
