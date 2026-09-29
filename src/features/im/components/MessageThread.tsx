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
const JUMP_RETRY_MS = 300;
const JUMP_RETRY_MAX = 15;

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
  const previousCountRef = useRef(0);
  const restoreRef = useRef<{ height: number; top: number } | null>(null);
  const pendingJumpRef = useRef<string | null>(null);
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
    previousCountRef.current = 0;
    setUnseen(0);
    pendingJumpRef.current = null;
  }, [peerUserName]);

  useEffect(() => {
    const previous = previousCountRef.current;
    const delta = messages.length - previous;
    previousCountRef.current = messages.length;
    if (delta > 0 && !stickToBottomRef.current && restoreRef.current == null) {
      setUnseen((count) => count + delta);
    }
  }, [messages.length]);

  useLayoutEffect(() => {
    const root = viewport();
    const restore = restoreRef.current;
    if (root != null && restore != null) {
      root.scrollTop = restore.top + (root.scrollHeight - restore.height);
      restoreRef.current = null;
      return;
    }
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
    const target = pendingJumpRef.current;
    if (target == null) {
      return;
    }
    if (jumpTo(target)) {
      pendingJumpRef.current = null;
    }
  }, [messages]);

  function handleJump(messageId: string): void {
    if (jumpTo(messageId)) {
      pendingJumpRef.current = null;
      return;
    }
    pendingJumpRef.current = messageId;
    if (hasMore && !loadingMore) {
      onLoadMore();
    }
    let attempts = 0;
    const tick = (): void => {
      if (pendingJumpRef.current !== messageId) {
        return;
      }
      if (jumpTo(messageId)) {
        pendingJumpRef.current = null;
        return;
      }
      attempts += 1;
      if (attempts <= JUMP_RETRY_MAX) {
        if (hasMore && !loadingMore) {
          onLoadMore();
        }
        window.setTimeout(tick, JUMP_RETRY_MS);
      } else {
        pendingJumpRef.current = null;
      }
    };
    window.setTimeout(tick, JUMP_RETRY_MS);
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
