import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { MessageScrollbar } from "@/components/MessageScrollbar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

import { NEAR_BOTTOM_PX } from "../constants";
import type { PrivateMessageDto } from "../types";
import { MessageBubble } from "./MessageBubble";

const TOP_LOAD_PX = 48;

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

function jumpInRoot(root: HTMLElement, messageId: string): boolean {
  const el = root.querySelector<HTMLElement>(
    `[data-msg-id="${CSS.escape(messageId)}"]`,
  );
  if (el == null || el.hidden) {
    return false;
  }
  el.scrollIntoView({ block: "center" });
  el.classList.add("is-highlight");
  window.setTimeout(() => {
    el.classList.remove("is-highlight");
  }, 700);
  return true;
}

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
  const previousIdsRef = useRef(new Set<string>());
  const previousLastRef = useRef<string | null>(null);
  const restoreRef = useRef<{ height: number; top: number } | null>(null);
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const [unseen, setUnseen] = useState(0);

  function viewport(): HTMLElement | null {
    return (
      rootRef.current?.querySelector("[data-slot=scroll-area-viewport]") ?? null
    );
  }

  function jumpTo(messageId: string): boolean {
    const root = rootRef.current;
    if (root == null) {
      return false;
    }
    stickToBottomRef.current = false;
    return jumpInRoot(root, messageId);
  }

  useEffect(() => {
    stickToBottomRef.current = true;
    previousIdsRef.current = new Set();
    previousLastRef.current = null;
    setUnseen(0);
    setPendingJump(null);
    restoreRef.current = null;
  }, [peerUserName]);

  useEffect(() => {
    const previousLast = previousLastRef.current;
    const index = previousLast ? messages.findIndex((message) => message.id === previousLast) : -1;
    const added = index < 0 ? 0 : messages.slice(index + 1).filter((message) =>
      !message.revoked && !previousIdsRef.current.has(message.id)).length;
    previousIdsRef.current = new Set(messages.map((message) => message.id));
    previousLastRef.current = messages[messages.length - 1]?.id ?? null;
    if (added > 0 && !stickToBottomRef.current && restoreRef.current == null) {
      setUnseen((count) => count + added);
    }
  }, [messages]);

  useLayoutEffect(() => {
    const root = viewport();
    const restore = restoreRef.current;
    if (root != null && restore != null && !loadingMore) {
      root.scrollTop = restore.top + (root.scrollHeight - restore.height);
      restoreRef.current = null;
      return;
    }
    if (root == null || !stickToBottomRef.current) {
      return;
    }
    root.scrollTop = root.scrollHeight;
  }, [messages, loading, loadingMore]);

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
      if (root.scrollTop <= TOP_LOAD_PX && hasMore && !loadingMore && !loading) {
        restoreRef.current = { height: root.scrollHeight, top: root.scrollTop };
        onLoadMore();
      }
    }
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
    };
  }, [loading, loadingMore, hasMore, onLoadMore]);

  useEffect(() => {
    if (!pendingJump || loading || loadingMore) return;
    if (jumpTo(pendingJump) || !hasMore) { setPendingJump(null); return; }
    onLoadMore();
  }, [pendingJump, messages, loading, loadingMore, hasMore, onLoadMore]);

  function handleJump(messageId: string): void {
    if (!jumpTo(messageId)) setPendingJump(messageId);
  }

  function loadOlder(): void {
    const root = viewport();
    if (root) restoreRef.current = { height: root.scrollHeight, top: root.scrollTop };
    onLoadMore();
  }

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
        {loading && messages.length === 0 ? (
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
                onClick={loadOlder}
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
              messages.filter((message) => !message.revoked).map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  selfUserName={selfUserName}
                  onRevoke={onRevoke}
                  onQuote={onQuote}
                  onMention={onMention}
                  onInsertToken={onInsertToken}
                  onJump={handleJump}
                />
              ))
            )}
          </div>
        )}
      </ScrollArea>
      <MessageScrollbar
        containerRef={rootRef}
        contentVersion={`${peerUserName}:${messages.length}:${messages[messages.length - 1]?.id ?? ""}`}
      />
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
