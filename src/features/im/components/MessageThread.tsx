import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

import { NEAR_BOTTOM_PX } from "../constants";
import type { PrivateMessageDto } from "../types";
import { MessageBubble } from "./MessageBubble";

type MessageThreadProps = {
  peerUserName: string;
  messages: PrivateMessageDto[];
  selfUserName: string | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onRevoke: (messageId: string) => Promise<void> | void;
  onQuote?: (message: PrivateMessageDto) => void;
  onMention?: (userName: string) => void;
  onInsertToken?: (token: string) => void;
};

export function MessageThread({
  peerUserName,
  messages,
  selfUserName,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  onRevoke,
  onQuote,
  onMention,
  onInsertToken,
}: MessageThreadProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const previousCountRef = useRef(0);
  const [unseen, setUnseen] = useState(0);

  function viewport(): HTMLElement | null {
    return (
      rootRef.current?.querySelector("[data-slot=scroll-area-viewport]") ?? null
    );
  }

  useEffect(() => {
    stickToBottomRef.current = true;
    previousCountRef.current = 0;
    setUnseen(0);
  }, [peerUserName]);

  useEffect(() => {
    const previous = previousCountRef.current;
    const delta = messages.length - previous;
    previousCountRef.current = messages.length;
    if (delta > 0 && !stickToBottomRef.current) {
      setUnseen((count) => count + delta);
    }
  }, [messages.length]);

  useLayoutEffect(() => {
    const root = viewport();
    if (root == null || !stickToBottomRef.current) {
      return;
    }
    root.scrollTop = root.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    const root = viewport();
    if (root == null) {
      return;
    }
    function onScroll(): void {
      if (root == null) {
        return;
      }
      const distance = root.scrollHeight - root.scrollTop - root.clientHeight;
      stickToBottomRef.current = distance <= NEAR_BOTTOM_PX;
      if (stickToBottomRef.current) {
        setUnseen(0);
      }
    }
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
    };
  }, [loading]);

  function jumpLatest(): void {
    const root = viewport();
    stickToBottomRef.current = true;
    setUnseen(0);
    if (root) {
      root.scrollTop = root.scrollHeight;
    }
  }

  return (
    <div className="im-thread-stream" ref={rootRef}>
      <ScrollArea className="im-thread-scroll">
        {loading ? (
          <MessageSkeleton />
        ) : (
          <div className="im-thread-inner">
            {hasMore ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="im-load-more"
                disabled={loadingMore}
                onClick={onLoadMore}
              >
                {loadingMore ? <Spinner /> : null}
                {loadingMore ? "加载中" : "加载更早消息"}
              </Button>
            ) : messages.length > 0 ? (
              <p className="im-thread-end">没有更早的消息了</p>
            ) : null}

            {messages.length === 0 ? (
              <p className="im-thread-empty">暂无消息</p>
            ) : (
              messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  selfUserName={selfUserName}
                  onRevoke={onRevoke}
                  onQuote={onQuote}
                  onMention={onMention}
                  onInsertToken={onInsertToken}
                />
              ))
            )}
          </div>
        )}
      </ScrollArea>
      {unseen > 0 ? (
        <Button
          type="button"
          size="sm"
          className="im-jump-latest"
          onClick={jumpLatest}
        >
          {unseen} 条新消息
        </Button>
      ) : null}
    </div>
  );
}

function MessageSkeleton() {
  return (
    <div className="im-thread-inner" aria-busy="true" aria-label="正在加载消息">
      <Skeleton className="im-skel im-skel-wide" />
      <Skeleton className="im-skel" />
      <Skeleton className="im-skel im-skel-wide" />
      <Skeleton className="im-skel" />
    </div>
  );
}
