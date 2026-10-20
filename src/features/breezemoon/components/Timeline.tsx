import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

import { sanitizeHttpUrl } from "../../../lib/markdown";
import { dispatchUserCard } from "../events";
import type { BreezemoonDto } from "../types";
import { BreezemoonBody } from "./MarkdownBody";

function Item({ item }: { item: BreezemoonDto }) {
  const avatarSrc = sanitizeHttpUrl(item.authorAvatarUrl);
  const name = item.authorName.trim() || "未知用户";
  const time = item.timeAgo.trim() || item.created.trim();

  return (
    <article className="br-item bm-item" data-bm-id={item.id}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="msg-avatar"
        title={name}
        aria-label={`${name} 的名片`}
        onClick={() => dispatchUserCard({ userName: item.authorName, userAvatarUrl: item.authorAvatarUrl })}
      >
        {avatarSrc ? (
          <img src={avatarSrc} alt="" />
        ) : (
          <span aria-hidden="true">{name.slice(0, 1)}</span>
        )}
      </Button>
      <section className="br-contain">
        <section className="br-data">
          <div className="arrow" />
          <div className="br-content">
            <BreezemoonBody source={item.content} />
          </div>
        </section>
        <section className="br-time">
          <span>发自 {item.city.trim()}</span>
          {time ? <time>{time}</time> : null}
        </section>
      </section>
    </article>
  );
}

export function Timeline({
  items,
  loading,
  loadingMore,
  hasMore,
  scrollReset,
  onLoadMore,
}: {
  items: BreezemoonDto[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  scrollReset: number;
  onLoadMore: () => void;
}) {
  const viewportRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
  }, [scrollReset]);

  return (
    <section ref={viewportRef} className="content" aria-label="清风明月时间线">
      {loading && items.length === 0 ? (
        <div className="breezemoon-status" role="status">
          <i className="fa fa-spinner fa-spin" aria-label="正在加载" />
        </div>
      ) : (
        items.map((item) => <Item key={item.id} item={item} />)
      )}
      <section className="br-more">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="加载更多"
          aria-label="加载更多"
          disabled={!hasMore || loadingMore || loading}
          onClick={onLoadMore}
        >
          <i
            className={loadingMore ? "fa fa-spinner fa-spin" : "fa fa-caret-down"}
            aria-hidden="true"
          />
        </Button>
      </section>
    </section>
  );
}
