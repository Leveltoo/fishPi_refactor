import { useEffect, useRef } from "react";
import { PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

import { sanitizeHttpUrl } from "../../../lib/markdown";
import { dispatchUserCard } from "../events";
import type { BreezemoonDto } from "../types";
import { BreezemoonBody } from "./MarkdownBody";

const NEAR_BOTTOM_PX = 72;

type TimelineProps = {
  items: BreezemoonDto[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  selfUserName?: string | null;
  onLoadMore: () => void;
};

function avatarLetter(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1) : "?";
}

function viewportOf(root: HTMLElement | null): HTMLElement | null {
  if (root == null) {
    return null;
  }
  return root.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']");
}

function Item({
  item,
  selfUserName,
}: {
  item: BreezemoonDto;
  selfUserName?: string | null;
}) {
  const avatarSrc = sanitizeHttpUrl(item.authorAvatarUrl);
  const name = item.authorName.trim() || "未知用户";
  const time = item.timeAgo.trim() || item.created.trim();
  const own =
    (selfUserName?.trim() ?? "").length > 0 &&
    item.authorName.trim() === selfUserName?.trim();

  function openCard(): void {
    dispatchUserCard({
      userName: item.authorName,
      userAvatarUrl: item.authorAvatarUrl,
    });
  }

  return (
    <article className="bm-item" data-bm-id={item.id}>
      <button
        type="button"
        className="bm-avatar-btn"
        onClick={openCard}
        aria-label={`${name} 的名片`}
      >
        <Avatar className="bm-avatar size-[34px]" aria-hidden>
          {avatarSrc ? <AvatarImage src={avatarSrc} alt="" /> : null}
          <AvatarFallback>{avatarLetter(name)}</AvatarFallback>
        </Avatar>
      </button>
      <div className="bm-item-body">
        <header className="bm-item-meta">
          <button type="button" className="bm-item-name" onClick={openCard}>
            {name}
          </button>
          {time ? <time className="bm-item-time">{time}</time> : null}
          {item.city.trim() ? (
            <span className="bm-item-city">发自 {item.city.trim()}</span>
          ) : null}
        </header>
        <div className="bm-item-content">
          <BreezemoonBody source={item.content} />
        </div>
        {own ? (
          <div className="bm-item-actions">
            <button
              type="button"
              className="bm-item-action"
              disabled
              title="SDK 没有编辑接口，不会假装成功"
            >
              <PencilSimpleIcon />
              编辑
            </button>
            <button
              type="button"
              className="bm-item-action"
              disabled
              title="SDK 没有删除接口，不会假装成功"
            >
              <TrashIcon />
              删除
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ItemSkeleton() {
  return (
    <div className="bm-skel">
      <Skeleton className="bm-skel-avatar" />
      <div className="bm-skel-body">
        <Skeleton className="bm-skel-meta" />
        <Skeleton className="bm-skel-bubble" />
      </div>
    </div>
  );
}

export function Timeline({
  items,
  loading,
  loadingMore,
  hasMore,
  selfUserName,
  onLoadMore,
}: TimelineProps) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const onScrollRef = useRef<() => void>(() => undefined);

  function onScroll(): void {
    const root = viewportOf(areaRef.current);
    if (root == null) {
      return;
    }
    const distance = root.scrollHeight - root.scrollTop - root.clientHeight;
    if (distance <= NEAR_BOTTOM_PX && hasMore && !loadingMore && !loading) {
      onLoadMore();
    }
  }

  onScrollRef.current = onScroll;

  useEffect(() => {
    const root = viewportOf(areaRef.current);
    if (root == null) {
      return;
    }
    const handle = (): void => {
      onScrollRef.current();
    };
    root.addEventListener("scroll", handle, { passive: true });
    return () => {
      root.removeEventListener("scroll", handle);
    };
  }, []);

  const showEmpty = !loading && items.length === 0;

  return (
    <section className="bm-stream" aria-label="清风明月时间线">
      <div ref={areaRef} className="bm-stream-scroller">
        <ScrollArea className="h-full">
          <div className="bm-stream-inner">
            {loading && items.length === 0 ? (
              <>
                <p className="visually-hidden">正在加载清风明月</p>
                <ItemSkeleton />
                <ItemSkeleton />
                <ItemSkeleton />
                <ItemSkeleton />
              </>
            ) : null}

            {showEmpty ? (
              <p className="bm-stream-status" role="status">
                暂无清风明月
              </p>
            ) : null}

            {items.map((item) => (
              <Item key={item.id} item={item} selfUserName={selfUserName} />
            ))}

            {hasMore && items.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="bm-load-more"
                disabled={loadingMore}
                onClick={onLoadMore}
              >
                {loadingMore ? "正在加载更早内容" : "加载更多"}
              </Button>
            ) : items.length > 0 ? (
              <p className="bm-stream-end">没有更多了</p>
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </section>
  );
}
