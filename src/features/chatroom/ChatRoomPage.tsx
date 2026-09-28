import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Composer } from "./components/Composer";
import { jumpToMessage, MessageList } from "./components/MessageList";
import { OnlineSidebar } from "./components/OnlineBar";
import {
  addEmojiUrl,
  loadChatroomFilters,
  type ChatroomFilters,
} from "./chatroomApi";
import { repeatBody, TOPIC_MAX_LENGTH, topicCommand } from "./messageView";
import { toReplyTarget, type ReplyTarget } from "./replyQuote";
import { insertMentionToken, openPrivateChat, sendExclusiveRedpacket } from "./userMenuActions";
import { useChatroomSession } from "./useChatroomSession";
import { CHAT_JUMP_EVENT, DISCUSS_PICK_EVENT, dispatchChatJump } from "./jumpEvents";
import { toast } from "sonner";
import { toUserErrorMessage } from "./toUserError";
import "./chatroom.css";

const EMPTY_FILTERS: ChatroomFilters = { shield: [], careUsers: [] };

/**
 * 聊天室主页面：对齐旧版 —— 消息流 → 话题行 → 输入框；右侧在线栏。
 * 窗口标题栏在 AppShell，不在这里。
 */
export function ChatRoomPage() {
  const session = useChatroomSession();
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [filters, setFilters] = useState<ChatroomFilters>(EMPTY_FILTERS);
  const [filtersReady, setFiltersReady] = useState(false);
  const [editingTopic, setEditingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState("");
  const [topicError, setTopicError] = useState<string | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [discussed, setDiscussed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadChatroomFilters()
      .then((loaded) => {
        if (!cancelled) {
          setFilters(loaded);
          setFiltersReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFiltersReady(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** `fishpi:chat-jump`：滚动到目标消息并高亮；未渲染时短暂重试（等历史进窗）。 */
  useEffect(() => {
    let token = 0;
    let timers: number[] = [];
    function jump(messageId: string): void {
      token += 1;
      const mine = token;
      timers.forEach((timer) => window.clearTimeout(timer));
      timers = [];
      let attempts = 0;
      const attempt = (): void => {
        if (mine !== token) {
          return;
        }
        if (jumpToMessage(messageId)) {
          return;
        }
        attempts += 1;
        if (attempts <= 15) {
          timers.push(window.setTimeout(attempt, 300));
        }
      };
      attempt();
    }
    const onJump = (event: Event): void => {
      const detail = (event as CustomEvent<{ messageId?: unknown }>).detail;
      const id = detail?.messageId;
      if (typeof id === "string" && id.length > 0) {
        jump(id);
      }
    };
    window.addEventListener(CHAT_JUMP_EVENT, onJump);
    return () => {
      window.removeEventListener(CHAT_JUMP_EVENT, onJump);
      token += 1;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  /** `?id=oId`：旧通知入口 → focusMsg。首帧捕获（StrictMode 双挂载时 query 已清）。 */
  const bootFocusIdRef = useRef<string | null | undefined>(undefined);
  if (bootFocusIdRef.current === undefined) {
    const raw = new URLSearchParams(window.location.search).get("id");
    bootFocusIdRef.current = raw != null && raw.length > 0 ? raw : null;
  }

  /** 派发复用上面的 chat-jump 监听与重试；清 query 防重复触发。 */
  useEffect(() => {
    const focusId = bootFocusIdRef.current;
    if (focusId == null) {
      return;
    }
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("id")) {
        url.searchParams.delete("id");
        window.history.replaceState(
          null,
          "",
          `${url.pathname}${url.search}${url.hash}`,
        );
      }
    } catch {
      // 部分 webview 自定义协议禁用 history API：清不掉 query 不挡跳转。
    }
    dispatchChatJump(focusId);
  }, []);

  /** `fishpi:discuss-pick`：对齐旧 discussClick，直接 set 不 toggle。 */
  useEffect(() => {
    const onPick = (event: Event): void => {
      const detail = (event as CustomEvent<{ topic?: unknown }>).detail;
      const topic = detail?.topic;
      if (typeof topic === "string" && topic.trim().length > 0) {
        setDiscussed(topic.trim());
      }
    };
    window.addEventListener(DISCUSS_PICK_EVENT, onPick);
    return () => window.removeEventListener(DISCUSS_PICK_EVENT, onPick);
  }, []);

  const lastOnlineRef = useRef<string[] | null>(null);

  /** 领取人头像查表：内容不变时保持旧引用，避免在线列表刷新打穿 MessageItem memo。 */
  const avatarMapRef = useRef<Map<string, string>>(new Map());
  const userAvatarMap = useMemo(() => {
    const next = new Map<string, string>();
    for (const user of session.users) {
      if (user.userName.length > 0 && user.userAvatarUrl) {
        next.set(user.userName, user.userAvatarUrl);
      }
    }
    const prev = avatarMapRef.current;
    if (prev.size === next.size) {
      let same = true;
      for (const [userName, url] of next) {
        if (prev.get(userName) !== url) {
          same = false;
          break;
        }
      }
      if (same) {
        return prev;
      }
    }
    avatarMapRef.current = next;
    return next;
  }, [session.users]);

  /** 会话代次变化（清屏 / 重连）后重置去重基线，避免重建后整批误报。 */
  useEffect(() => {
    lastOnlineRef.current = null;
  }, [session.windowEpoch]);

  /** 特别关心上线通知（对齐旧 notice.js chatroomMsg online 分支）。 */
  useEffect(() => {
    if (!filtersReady) {
      return;
    }
    const names = session.users.map((user) => user.userName);
    const previous = lastOnlineRef.current;
    lastOnlineRef.current = names;
    if (previous == null) {
      return;
    }
    const care = new Set(filters.careUsers);
    if (care.size === 0) {
      return;
    }
    const announced = new Set<string>();
    for (const name of names) {
      if (previous.includes(name) || announced.has(name)) {
        continue;
      }
      if (name === session.selfUserName || !care.has(name)) {
        continue;
      }
      announced.add(name);
      toast(`你的特别关心 ${name} 上线啦~`);
    }
  }, [session.users, session.selfUserName, filters.careUsers, filtersReady]);

  const topicText = session.topic.trim();
  const discussedActive = discussed != null && discussed.length > 0;

  /** 回调引用稳定：MessageItem memo 依赖这些不变式（只依赖稳定的 session 方法，不依赖 session 对象）。 */
  const { loadMore, send, revoke } = session;
  const onLoadMore = useCallback(() => {
    void loadMore();
  }, [loadMore]);
  const onReply = useCallback((message: Parameters<typeof toReplyTarget>[0]) => {
    setReplyTo(toReplyTarget(message));
  }, []);
  const onPlusOne = useCallback(
    (message: Parameters<typeof repeatBody>[0]) => {
      const body = repeatBody(message);
      if (body == null) {
        return;
      }
      void send(body);
    },
    [send],
  );
  const onMention = useCallback((userName: string) => {
    setPendingToken(insertMentionToken(userName));
  }, []);
  const onInsertToken = useCallback((token: string) => {
    setPendingToken(token);
  }, []);
  const onAddEmoji = useCallback((url: string) => {
    void addEmojiUrl(url)
      .then(() => {
        toast.success("已同步到服务器表情");
      })
      .catch((err: unknown) => {
        toast.error(toUserErrorMessage(err));
      });
  }, []);

  /** 清屏：清窗 + 重连 + 重载历史（对齐旧版 reload(true)）。 */
  function clearScreen(): void {
    void session.rebuild();
  }

  function toggleDiscussed(): void {
    if (topicText.length === 0) {
      return;
    }
    setDiscussed((prev) => (prev === topicText ? null : topicText));
  }

  function openTopicEdit(): void {
    setTopicDraft(topicText);
    setTopicError(null);
    setEditingTopic(true);
  }

  function submitTopic(): void {
    const command = topicCommand(topicDraft);
    if (command == null) {
      setTopicError(
        topicDraft.trim().length === 0
          ? "话题不能为空"
          : `话题最长 ${TOPIC_MAX_LENGTH} 个字符`,
      );
      return;
    }
    setTopicError(null);
    void session.send(command).then((accepted) => {
      if (accepted) {
        setEditingTopic(false);
        setTopicDraft("");
      }
    });
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="chatroom" id="chatroom">
        <div className="chatroom-main">
          {session.error && (
            <Alert variant="destructive" className="chat-banner">
              <AlertTitle>出错了</AlertTitle>
              <AlertDescription>{session.error}</AlertDescription>
            </Alert>
          )}
          {session.notice && (
            <Alert className="chat-banner">
              <AlertDescription>{session.notice}</AlertDescription>
            </Alert>
          )}

          <MessageList
            messages={session.messages}
            selfUserName={session.selfUserName}
            selfRole={session.selfRole}
            loading={session.loading}
            loadingMore={session.loadingMore}
            hasMore={session.hasMore}
            connectionStatus={session.connectionStatus}
            historyIncomplete={session.historyIncomplete}
            windowEpoch={session.windowEpoch}
            onLoadMore={onLoadMore}
            onReply={onReply}
            onRevoke={revoke}
            onPlusOne={onPlusOne}
            onMention={onMention}
            onInsertToken={onInsertToken}
            onAddEmoji={onAddEmoji}
            filters={filters}
            redpacketWho={session.redpacketWho}
            userAvatarMap={userAvatarMap}
          />

          {/* 旧版 .discusse：消息与输入之间的话题行，不进窗口标题栏 */}
          <section className="chat-discusse">
            {editingTopic ? (
              <form
                className="chat-topic-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitTopic();
                }}
              >
                <Input
                  className="chat-topic-input"
                  maxLength={TOPIC_MAX_LENGTH}
                  value={topicDraft}
                  placeholder="话题，最长 16 字"
                  onChange={(event) => setTopicDraft(event.target.value)}
                />
                <Button type="submit" size="xs" disabled={session.busy}>
                  确定
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setEditingTopic(false);
                    setTopicError(null);
                  }}
                >
                  取消
                </Button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  className="chat-discusse-text"
                  title={
                    topicText.length > 0
                      ? discussedActive
                        ? "点击取消勾选话题"
                        : "点击勾选话题（发送时附加）"
                      : "无话题"
                  }
                  aria-pressed={topicText.length > 0 ? discussedActive : undefined}
                  disabled={session.busy}
                  onClick={toggleDiscussed}
                  style={
                    discussedActive
                      ? {
                          textDecoration: "underline",
                          textUnderlineOffset: 3,
                          fontWeight: 600,
                        }
                      : undefined
                  }
                >
                  {topicText.length > 0 ? `#${topicText}#` : "无话题"}
                </button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={session.busy}
                  onClick={openTopicEdit}
                >
                  ✎
                </Button>
              </>
            )}
            {topicError ? <p className="chat-topic-error">{topicError}</p> : null}
          </section>

          <Composer
            disabled={session.sendDisabled}
            sending={session.sending}
            pendingConfirm={session.pendingConfirm}
            selfUserName={session.selfUserName}
            replyTo={replyTo}
            onClearReply={() => {
              setReplyTo(null);
            }}
            onSend={session.send}
            pendingToken={pendingToken}
            onClearPendingToken={() => setPendingToken(null)}
            onClear={clearScreen}
            discussed={discussed}
            onClearDiscussed={() => setDiscussed(null)}
          />
        </div>

        <OnlineSidebar
          onlineCount={session.onlineCount}
          users={session.users}
          connectionStatus={session.connectionStatus}
          busy={session.busy}
          onRebuild={() => {
            void session.rebuild();
          }}
          onRefresh={() => {
            void session.refresh();
          }}
          filters={filters}
          filtersReady={filtersReady}
          onFilters={setFilters}
          onEditTopic={openTopicEdit}
          onMention={(userName) => setPendingToken(insertMentionToken(userName))}
          onOpenIm={openPrivateChat}
          onRedpacket={sendExclusiveRedpacket}
        />
      </div>
    </TooltipProvider>
  );
}
