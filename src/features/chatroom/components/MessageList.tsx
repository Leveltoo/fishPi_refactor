import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChatMessageDto } from "../../../lib/types";
import type { ChatroomFilters } from "../chatroomApi";
import { NEAR_BOTTOM_PX } from "../constants";
import {
  connectionStatusLabel,
  isDisconnectedStatus,
  isUnknownStatus,
} from "../labels";
import { isShielded, mergeDoubleMessages, plusOneMessageId } from "../messageView";
import { MessageItem } from "./MessageItem";

let highlightEl: HTMLElement | null = null;
let highlightTimer: number | null = null;

/** 高亮样式提到模块顶层：内嵌在 JSX 里每次 render 都是新字符串。 */
const HIGHLIGHT_STYLE = `
        .chat-stream [data-msg-id].is-highlight { position: relative; }
        .chat-stream [data-msg-id].is-highlight::after {
          content: "";
          position: absolute;
          inset: 0;
          background: rgba(255, 255, 255, .1);
          animation: chatroom-msg-flash 700ms ease-out forwards;
          pointer-events: none;
        }
        @keyframes chatroom-msg-flash {
          from { opacity: 1; }
          to { opacity: 0; }
        }
      `;

/**
 * 跳到指定消息并高亮约 700ms（对齐旧 focusMsg/gotoMsg 的 highlight）。
 * 找不到（未渲染 / 被屏蔽）返回 false，调用方决定回落。
 */
export function jumpToMessage(messageId: string): boolean {
  const el = document.querySelector<HTMLElement>(
    `[data-msg-id="${CSS.escape(messageId)}"]`,
  );
  if (el == null || el.hidden) {
    return false;
  }
  el.scrollIntoView({ block: "center" });
  if (highlightEl != null) {
    highlightEl.classList.remove("is-highlight");
  }
  if (highlightTimer != null) {
    window.clearTimeout(highlightTimer);
  }
  void el.offsetWidth;
  el.classList.add("is-highlight");
  highlightEl = el;
  highlightTimer = window.setTimeout(() => {
    el.classList.remove("is-highlight");
    highlightEl = null;
    highlightTimer = null;
  }, 700);
  return true;
}

type MessageListProps = {
  messages: ChatMessageDto[];
  selfUserName: string | null;
  selfRole: string | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  connectionStatus: string;
  historyIncomplete: boolean;
  windowEpoch: number;
  onLoadMore: () => void;
  onReply: (message: ChatMessageDto) => void;
  onRevoke: (messageId: string) => Promise<void>;
  onPlusOne: (message: ChatMessageDto) => void;
  onMention: (userName: string) => void;
  onInsertToken?: (token: string) => void;
  onAddEmoji?: (url: string) => void;
  filters: ChatroomFilters;
  redpacketWho: Map<string, string[]>;
  userAvatarMap: Map<string, string>;
};

function emptyCopy(connectionStatus: string, loading: boolean): string {
  if (loading) {
    return "正在加载消息";
  }
  if (isUnknownStatus(connectionStatus)) {
    return "连接状态未知，无法用空列表判断是否离线。可手动断开重建或刷新。";
  }
  if (isDisconnectedStatus(connectionStatus)) {
    return "已断开连接。";
  }
  return "暂无消息";
}

function MessageSkeleton({ mine = false }: { mine?: boolean }) {
  return (
    <div className={mine ? "chat-msg-skeleton is-mine" : "chat-msg-skeleton"}>
      <Skeleton className="chat-msg-skeleton-avatar" />
      <div className="chat-msg-skeleton-body">
        <Skeleton className="chat-msg-skeleton-meta" />
        <div className="chat-msg-row">
          <span className="chat-msg-arrow" aria-hidden="true" />
          <Skeleton className="chat-msg-skeleton-bubble" />
        </div>
      </div>
    </div>
  );
}

function MessageSkeletonList({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <MessageSkeleton key={`sk-${index}`} mine={index % 3 === 2} />
      ))}
    </>
  );
}

function viewportOf(root: HTMLElement | null): HTMLElement | null {
  if (root == null) {
    return null;
  }
  return root.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']");
}

export function MessageList({
  messages,
  selfUserName,
  selfRole,
  loading,
  loadingMore,
  hasMore,
  connectionStatus,
  historyIncomplete,
  windowEpoch,
  onLoadMore,
  onReply,
  onRevoke,
  onPlusOne,
  onMention,
  onInsertToken,
  onAddEmoji,
  filters,
  redpacketWho,
  userAvatarMap,
}: MessageListProps) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const onScrollRef = useRef<() => void>(() => undefined);
  const stickToBottomRef = useRef(true);
  const restoreRef = useRef<{ id: string; top: number } | null>(null);
  const initializedRef = useRef(false);
  const previousCountRef = useRef(0);
  const firstUnseenIdRef = useRef<string | null>(null);
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    initializedRef.current = false;
    stickToBottomRef.current = true;
    previousCountRef.current = 0;
    firstUnseenIdRef.current = null;
    setUnseen(0);
  }, [windowEpoch]);

  useEffect(() => {
    const previous = previousCountRef.current;
    const delta = messages.length - previous;
    previousCountRef.current = messages.length;
    if (
      delta > 0 &&
      !stickToBottomRef.current &&
      restoreRef.current == null &&
      initializedRef.current
    ) {
      if (firstUnseenIdRef.current == null && messages.length > 0) {
        // 旧 gotoMsg：跳到第一条未读，不是最后一条
        firstUnseenIdRef.current = messages[previous]?.id ?? messages[0].id;
      }
      setUnseen((count) => count + delta);
    }
  }, [messages.length]);

  useLayoutEffect(() => {
    const root = viewportOf(areaRef.current);
    if (root == null) {
      return;
    }

    const restore = restoreRef.current;
    if (restore != null && !loadingMore) {
      const anchor = root.querySelector<HTMLElement>(
        `[data-msg-id="${CSS.escape(restore.id)}"]`,
      );
      if (anchor != null) {
        const nextTop = anchor.getBoundingClientRect().top;
        root.scrollTop += nextTop - restore.top;
      }
      restoreRef.current = null;
      return;
    }

    if (!initializedRef.current && messages.length > 0 && !loading) {
      root.scrollTop = root.scrollHeight;
      initializedRef.current = true;
      stickToBottomRef.current = true;
      setUnseen(0);
      return;
    }

    if (stickToBottomRef.current) {
      root.scrollTop = root.scrollHeight;
      setUnseen(0);
    }
  }, [messages, loading, loadingMore]);

  function captureRestoreAnchor(): void {
    const root = viewportOf(areaRef.current);
    const first = messages[0];
    if (root == null || first == null) {
      return;
    }
    restoreRef.current = {
      id: first.id,
      top:
        root
          .querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(first.id)}"]`)
          ?.getBoundingClientRect().top ?? 0,
    };
  }

  function onScroll(): void {
    const root = viewportOf(areaRef.current);
    if (root == null) {
      return;
    }
    const distance = root.scrollHeight - root.scrollTop - root.clientHeight;
    const atBottom = distance <= NEAR_BOTTOM_PX;
    stickToBottomRef.current = atBottom;
    if (atBottom) {
      firstUnseenIdRef.current = null;
      // 未读数本来就是 0 时跳过 setState，滚动时少一轮调度
      if (unseen > 0) {
        setUnseen(0);
      }
    }
    if (root.scrollTop < 48 && hasMore && !loadingMore && !loading) {
      captureRestoreAnchor();
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
  }, [windowEpoch]);

  function jumpToLatest(): void {
    const root = viewportOf(areaRef.current);
    if (root == null) {
      return;
    }
    stickToBottomRef.current = true;
    root.scrollTop = root.scrollHeight;
    setUnseen(0);
  }

  const showEmpty = !loading && messages.length === 0;
  /** 合并/+1/关心集合只在消息或筛选真变时重算，避免每次渲染 O(n) + 新引用打穿 memo。 */
  const rows = useMemo(() => mergeDoubleMessages(messages), [messages]);
  const plusOneId = useMemo(() => plusOneMessageId(rows), [rows]);
  const careUsers = useMemo(
    () => new Set(filters.careUsers),
    [filters.careUsers],
  );
  const shieldRules = filters.shield;

  return (
    <section className="chat-stream" aria-label="聊天室消息">
      {/* 局部高亮样式：不动 chatroom.css（对齐旧版高亮 700ms 淡出） */}
      <style>{HIGHLIGHT_STYLE}</style>
      <div ref={areaRef} className="chat-stream-scroller">
        <ScrollArea className="h-full">
          <div className="chat-stream-inner">
          {hasMore ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="chat-load-more"
              title="加载更早消息"
              aria-label="加载更早消息"
              disabled={loadingMore}
              onClick={() => {
                captureRestoreAnchor();
                onLoadMore();
              }}
            >
              {loadingMore ? "正在加载更早消息" : "..."}
            </Button>
          ) : messages.length > 0 ? (
            <p className="chat-history-end">没有更早的消息了</p>
          ) : null}

          {loadingMore && <MessageSkeletonList count={3} />}

          {historyIncomplete && (
            <p className="chat-history-gap" role="status">
              历史可能不完整，已回到最近消息窗口。
            </p>
          )}

          {loading && messages.length === 0 && (
            <>
              <p className="visually-hidden">正在加载消息</p>
              <MessageSkeletonList count={6} />
            </>
          )}

          {showEmpty && (
            <p className="chat-stream-status" role="status">
              {emptyCopy(connectionStatus, loading)}
            </p>
          )}

          {rows.map((message) =>
            isShielded(message, shieldRules) ? (
              <div key={message.id} data-msg-id={message.id} hidden />
            ) : (
              <MessageItem
                key={message.id}
                message={message}
                alsoSaid={message.alsoSaid}
                showPlusOne={message.id === plusOneId}
                cared={careUsers.has(message.userName)}
                careNames={careUsers}
                shield={shieldRules}
                selfUserName={selfUserName}
                selfRole={selfRole}
                onReply={onReply}
                onRevoke={onRevoke}
                onPlusOne={onPlusOne}
                onMention={onMention}
                onInsertToken={onInsertToken}
                onAddEmoji={onAddEmoji}
                redpacketWho={redpacketWho.get(message.id)}
                userAvatarMap={userAvatarMap}
              />
            ),
          )}
          </div>
        </ScrollArea>
      </div>

      {unseen > 0 && (
        <Button
          type="button"
          className="chat-jump-latest"
          onClick={() => {
            const targetId = firstUnseenIdRef.current;
            firstUnseenIdRef.current = null;
            if (targetId != null && jumpToMessage(targetId)) {
              setUnseen(0);
              return;
            }
            const last = messages[messages.length - 1];
            if (last == null || !jumpToMessage(last.id)) {
              jumpToLatest();
              return;
            }
            setUnseen(0);
          }}
        >
          {unseen} 条新消息
        </Button>
      )}

      {isUnknownStatus(connectionStatus) && messages.length > 0 && (
        <p className="chat-conn-footnote" role="status">
          {connectionStatusLabel(connectionStatus)}
        </p>
      )}
    </section>
  );
}
