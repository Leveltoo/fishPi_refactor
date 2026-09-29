import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { invokeAuthMe } from "../../lib/tauri";
import {
  invokeChatConnect,
  invokeChatDisconnect,
  invokeChatHistory,
  invokeChatList,
  invokeChatMarkRead,
  invokeChatRevoke,
  invokeChatSend,
  invokeChatUnread,
  invokeUserSearch,
  listenChatEvents,
} from "./api";
import { HISTORY_PAGE_SIZE } from "./constants";
import { formatPrivateReply } from "./replyQuote";
import { loadOfflineThread, mergeThreadMessages } from "./offlineSeed";
import {
  applyUnreadCounts,
  bumpUnread,
  clearUnread,
  conversationsFrom,
  upsertConversation,
} from "./conversation";
import {
  isBridgeGapError,
  isOutcomeUnknown,
  toUserErrorMessage,
} from "./errors";
import { fetchUserProfile } from "../overlay/api";
import { publishImUnread, sumUnread } from "./unreadBus";
import type {
  ChatListenEvent,
  Conversation,
  PrivateMessageDto,
  ReplyTarget,
  UserSearchHit,
} from "./types";
import { CHAT_COMMAND, NOTICE_COMMAND, USER_COMMAND } from "./types";

export type ImCapabilities = {
  list: boolean;
  history: boolean;
  send: boolean;
  search: boolean;
  events: boolean;
};

const ALL_READY: ImCapabilities = {
  list: true,
  history: true,
  send: true,
  search: true,
  events: true,
};

export function usePrivateChat() {
  const [selfUserName, setSelfUserName] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeUser, setActiveUser] = useState<string | null>(null);
  const [messages, setMessages] = useState<PrivateMessageDto[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [sending, setSending] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<ImCapabilities>(ALL_READY);
  const [startOpen, setStartOpen] = useState(false);
  const [quote, setQuoteState] = useState<ReplyTarget | null>(null);
  const [peerNickname, setPeerNickname] = useState<string | null>(null);
  /** 右键「@对方」后待写入 Composer 的用户名；Composer 消费后 clear。 */
  const [pendingMention, setPendingMention] = useState<string | null>(null);

  const selfRef = useRef<string | null>(null);
  const activeUserRef = useRef<string | null>(null);
  const sessionGenRef = useRef(0);
  const pageRef = useRef(1);
  const loadSeqRef = useRef(0);
  const connectedUserRef = useRef<string | null>(null);
  const globalConnectedRef = useRef(false);
  const listReadyRef = useRef(false);
  const mountedRef = useRef(true);
  const revokingIdsRef = useRef(new Set<string>());
  const handleEventRef = useRef<(event: ChatListenEvent) => void>(() => undefined);
  const quoteRef = useRef<ReplyTarget | null>(null);
  quoteRef.current = quote;

  const markGap = useCallback((command: string): void => {
    setCapabilities((prev) => {
      if (command === CHAT_COMMAND.list && prev.list) {
        return { ...prev, list: false };
      }
      if (command === CHAT_COMMAND.history && prev.history) {
        return { ...prev, history: false };
      }
      if (command === CHAT_COMMAND.send && prev.send) {
        return { ...prev, send: false };
      }
      if (command === USER_COMMAND.search && prev.search) {
        return { ...prev, search: false };
      }
      return prev;
    });
  }, []);

  const markReady = useCallback((command: string): void => {
    setCapabilities((prev) => {
      if (command === CHAT_COMMAND.list && !prev.list) {
        return { ...prev, list: true };
      }
      if (command === CHAT_COMMAND.history && !prev.history) {
        return { ...prev, history: true };
      }
      if (command === CHAT_COMMAND.send && !prev.send) {
        return { ...prev, send: true };
      }
      if (command === USER_COMMAND.search && !prev.search) {
        return { ...prev, search: true };
      }
      return prev;
    });
  }, []);

  const acceptSession = useCallback((eventGen: number): boolean => {
    const current = sessionGenRef.current;
    if (eventGen <= 0 || current <= 0) {
      return true;
    }
    return eventGen === current;
  }, []);

  const refreshUnread = useCallback(async (): Promise<void> => {
    try {
      const result = await invokeChatUnread();
      if (!mountedRef.current || !acceptSession(result.sessionGeneration)) {
        return;
      }
      const unread = conversationsFrom(result.messages, selfRef.current);
      setConversations((list) => applyUnreadCounts(list, unread));
    } catch (err) {
      if (isBridgeGapError(err)) {
        markGap(err.command);
      }
    }
  }, [acceptSession, markGap]);

  const loadList = useCallback(async (): Promise<void> => {
    setLoadingList(true);
    try {
      const result = await invokeChatList();
      if (!mountedRef.current) {
        return;
      }
      if (result.sessionGeneration > 0) {
        sessionGenRef.current = result.sessionGeneration;
      }
      markReady(CHAT_COMMAND.list);
      listReadyRef.current = true;
      const items = conversationsFrom(result.conversations, selfRef.current);
      setConversations(items);
      setError(null);
      await refreshUnread();
    } catch (err) {
      if (!mountedRef.current) {
        return;
      }
      if (isBridgeGapError(err)) {
        markGap(err.command);
        listReadyRef.current = false;
        setConversations([]);
        setError(err.message);
        return;
      }
      setError(toUserErrorMessage(err));
    } finally {
      if (mountedRef.current) {
        setLoadingList(false);
      }
    }
  }, [markGap, markReady, refreshUnread]);

  const connectGlobal = useCallback(async (): Promise<void> => {
    try {
      const result = await invokeChatConnect({});
      if (!mountedRef.current) {
        void invokeChatDisconnect({}).catch(() => undefined);
        return;
      }
      globalConnectedRef.current = true;
      if (result.sessionGeneration > 0) {
        sessionGenRef.current = result.sessionGeneration;
      }
    } catch (err) {
      globalConnectedRef.current = false;
      if (isBridgeGapError(err)) {
        markGap(err.command);
      }
    }
  }, [markGap]);

  const openConversation = useCallback(
    async (userName: string): Promise<void> => {
      const trimmed = userName.trim();
      if (trimmed.length === 0) {
        return;
      }
      const seq = ++loadSeqRef.current;
      activeUserRef.current = trimmed;
      setActiveUser(trimmed);
      setMessages([]);
      setPendingConfirm(false);
      setHasMore(true);
      setQuoteState(null);
      pageRef.current = 1;
      setLoadingThread(true);
      setConversations((list) =>
        upsertConversation(clearUnread(list, trimmed), {
          peerUserName: trimmed,
          peerAvatarUrl: list.find((item) => item.peerUserName === trimmed)?.peerAvatarUrl ?? "",
          preview: "",
          time: "",
          unread: 0,
        }),
      );

      // 离线种子只影响展示；live 写入仍由 DesktopMount 合并进 offline 库。
      void loadOfflineThread(trimmed).then((seed) => {
        if (!mountedRef.current || seq !== loadSeqRef.current || seed.length === 0) {
          return;
        }
        setMessages((current) =>
          mergeThreadMessages(current, seed, { incomingWins: false }),
        );
        setLoadingThread(false);
      });

      const previous = connectedUserRef.current;
      if (previous && previous !== trimmed) {
        try {
          await invokeChatDisconnect({ userName: previous });
        } catch (err) {
          if (isBridgeGapError(err)) {
            markGap(err.command);
          }
        }
        if (connectedUserRef.current === previous) {
          connectedUserRef.current = null;
        }
      }

      if (!mountedRef.current || seq !== loadSeqRef.current) {
        return;
      }

      if (!globalConnectedRef.current) {
        await connectGlobal();
        if (!mountedRef.current || seq !== loadSeqRef.current) {
          return;
        }
      }

      try {
        const connected = await invokeChatConnect({ userName: trimmed });
        if (!mountedRef.current || seq !== loadSeqRef.current) {
          void invokeChatDisconnect({ userName: trimmed }).catch(() => undefined);
          return;
        }
        connectedUserRef.current = trimmed;
        if (connected.sessionGeneration > 0) {
          sessionGenRef.current = connected.sessionGeneration;
        }
      } catch (err) {
        if (isBridgeGapError(err)) {
          markGap(err.command);
        }
      }

      if (!mountedRef.current || seq !== loadSeqRef.current) {
        return;
      }

      try {
        await invokeChatMarkRead({ userName: trimmed });
      } catch (err) {
        if (isBridgeGapError(err)) {
          markGap(err.command);
        }
      }

      try {
        const history = await invokeChatHistory({
          userName: trimmed,
          page: 1,
          size: HISTORY_PAGE_SIZE,
        });
        if (!mountedRef.current || seq !== loadSeqRef.current) {
          return;
        }
        if (history.sessionGeneration > 0) {
          sessionGenRef.current = history.sessionGeneration;
        }
        markReady(CHAT_COMMAND.history);
        setMessages((current) => mergeThreadMessages(current, history.messages));
        setHasMore(history.exhausted !== true && history.messages.length >= HISTORY_PAGE_SIZE);
        setError(null);
      } catch (err) {
        if (!mountedRef.current || seq !== loadSeqRef.current) {
          return;
        }
        if (isBridgeGapError(err)) {
          markGap(err.command);
          setError(err.message);
          return;
        }
        setError(toUserErrorMessage(err));
      } finally {
        if (mountedRef.current && seq === loadSeqRef.current) {
          setLoadingThread(false);
        }
      }
    },
    [connectGlobal, markGap, markReady],
  );

  const loadMore = useCallback(async (): Promise<void> => {
    const userName = activeUserRef.current;
    if (!userName || loadingMore || !hasMore) {
      return;
    }
    const nextPage = pageRef.current + 1;
    const seq = loadSeqRef.current;
    setLoadingMore(true);
    try {
      const history = await invokeChatHistory({
        userName,
        page: nextPage,
        size: HISTORY_PAGE_SIZE,
      });
      if (!mountedRef.current || seq !== loadSeqRef.current) {
        return;
      }
      pageRef.current = nextPage;
      markReady(CHAT_COMMAND.history);
      setMessages((current) => mergeThreadMessages(current, history.messages));
      setHasMore(history.exhausted !== true && history.messages.length >= HISTORY_PAGE_SIZE);
    } catch (err) {
      if (isBridgeGapError(err)) {
        markGap(err.command);
        setHasMore(false);
        return;
      }
      toast.error(toUserErrorMessage(err));
    } finally {
      if (mountedRef.current) {
        setLoadingMore(false);
      }
    }
  }, [hasMore, loadingMore, markGap, markReady]);

  const revoke = useCallback(
    async (messageId: string): Promise<void> => {
      const id = messageId.trim();
      if (id.length === 0 || revokingIdsRef.current.has(id)) {
        return;
      }
      revokingIdsRef.current.add(id);
      try {
        await invokeChatRevoke({ id });
        if (!mountedRef.current) {
          return;
        }
        setMessages((current) =>
          current.map((item) => (item.id === id ? { ...item, revoked: true } : item)),
        );
      } catch (err) {
        if (isBridgeGapError(err)) {
          markGap(err.command);
          toast.error(err.message);
          return;
        }
        if (isOutcomeUnknown(err)) {
          toast.warning("撤回结果待确认。请核对，不要重复提交。");
          return;
        }
        toast.error(toUserErrorMessage(err));
      } finally {
        revokingIdsRef.current.delete(id);
      }
    },
    [markGap],
  );

  const send = useCallback(async (content: string): Promise<boolean> => {
    const userName = activeUserRef.current;
    if (!userName) {
      toast.error("请先选择会话");
      return false;
    }
    const quote = quoteRef.current;
    const payload = quote != null ? formatPrivateReply(quote, content) : content;
    setSending(true);
    try {
      const result = await invokeChatSend({ userName, content: payload });
      if (!mountedRef.current) {
        return false;
      }
      markReady(CHAT_COMMAND.send);
      if (result.outcomeUnknown) {
        setPendingConfirm(true);
        toast.warning("结果待确认。请等待回显，不要重复发送。");
        return false;
      }
      if (result.accepted) {
        setPendingConfirm(false);
        setQuoteState(null);
        return true;
      }
      toast.error("发送未被接受，消息未发出");
      return false;
    } catch (err) {
      if (isBridgeGapError(err)) {
        markGap(err.command);
        toast.error(err.message);
        return false;
      }
      if (isOutcomeUnknown(err)) {
        setPendingConfirm(true);
        toast.warning("结果待确认。请等待回显，不要重复发送。");
        return false;
      }
      toast.error(toUserErrorMessage(err));
      return false;
    } finally {
      if (mountedRef.current) {
        setSending(false);
      }
    }
  }, [markGap, markReady]);

  const setQuote = useCallback((target: ReplyTarget): void => {
    setQuoteState(target);
  }, []);

  const clearQuote = useCallback((): void => {
    setQuoteState(null);
  }, []);

  /** 清屏：去掉引用并重拉当前会话历史；不动未读计数。 */
  const clearThread = useCallback(async (): Promise<void> => {
    setQuoteState(null);
    const userName = activeUserRef.current;
    if (!userName) {
      return;
    }
    const seq = ++loadSeqRef.current;
    pageRef.current = 1;
    setHasMore(true);
    setMessages([]);
    setLoadingThread(true);
    try {
      const history = await invokeChatHistory({
        userName,
        page: 1,
        size: HISTORY_PAGE_SIZE,
      });
      if (!mountedRef.current || seq !== loadSeqRef.current) {
        return;
      }
      if (history.sessionGeneration > 0) {
        sessionGenRef.current = history.sessionGeneration;
      }
      markReady(CHAT_COMMAND.history);
      setMessages(history.messages);
      setHasMore(history.exhausted !== true && history.messages.length >= HISTORY_PAGE_SIZE);
      setError(null);
    } catch (err) {
      if (!mountedRef.current || seq !== loadSeqRef.current) {
        return;
      }
      if (isBridgeGapError(err)) {
        markGap(err.command);
        setError(err.message);
        return;
      }
      setError(toUserErrorMessage(err));
    } finally {
      if (mountedRef.current && seq === loadSeqRef.current) {
        setLoadingThread(false);
      }
    }
  }, [markGap, markReady]);

  const searchUsers = useCallback(
    async (query: string): Promise<UserSearchHit[]> => {
      const needle = query.trim();
      if (needle.length === 0) {
        return [];
      }
      try {
        const result = await invokeUserSearch({ query: needle });
        markReady(USER_COMMAND.search);
        return result.users;
      } catch (err) {
        if (isBridgeGapError(err)) {
          markGap(err.command);
          return [];
        }
        toast.error(toUserErrorMessage(err));
        return [];
      }
    },
    [markGap, markReady],
  );

  const startChat = useCallback(
    (user: UserSearchHit): void => {
      setStartOpen(false);
      setConversations((list) =>
        upsertConversation(list, {
          peerUserName: user.userName,
          peerAvatarUrl: user.userAvatarUrl,
          preview: "",
          time: "",
          unread: 0,
        }),
      );
      void openConversation(user.userName);
    },
    [openConversation],
  );

  useEffect(() => {
    handleEventRef.current = (event: ChatListenEvent) => {
      if (event.event === "chat://msg") {
        if (!acceptSession(event.payload.sessionGeneration)) {
          return;
        }
        const message = event.payload.message;
        const peer = resolvePeer(
          event.payload.userName,
          message.userName,
          selfRef.current,
          activeUserRef.current,
        );
        if (!peer) {
          return;
        }
        const viewing = activeUserRef.current === peer;
        if (viewing) {
          setPendingConfirm(false);
          setMessages((current) => appendMessage(current, message));
          setConversations((list) =>
            bumpUnread(clearUnread(list, peer), peer, 0, {
              preview: previewOf(message),
              time: message.time,
              peerAvatarUrl: message.userName === selfRef.current ? undefined : message.userAvatarUrl,
            }),
          );
          void invokeChatMarkRead({ userName: peer }).catch((err: unknown) => {
            if (isBridgeGapError(err)) {
              markGap(err.command);
            }
          });
          return;
        }
        setConversations((list) =>
          bumpUnread(list, peer, 1, {
            preview: previewOf(message),
            time: message.time,
            peerAvatarUrl: message.userAvatarUrl,
          }),
        );
        toast.message(`${peer} 发来私聊`, {
          description: previewOf(message) || "新消息",
        });
        return;
      }

      if (event.event === "chat://revoke") {
        if (!acceptSession(event.payload.sessionGeneration)) {
          return;
        }
        const messageId = event.payload.messageId;
        setMessages((current) =>
          current.map((item) =>
            item.id === messageId ? { ...item, revoked: true } : item,
          ),
        );
        return;
      }

      if (event.event === "chat://notice" || event.event === "notice://refresh") {
        if (!acceptSession(event.payload.sessionGeneration)) {
          return;
        }
        const command = event.payload.command;
        if (
          command === NOTICE_COMMAND.unreadRefresh ||
          command === NOTICE_COMMAND.refreshNotification
        ) {
          if ((event.payload.count ?? 1) > 0) {
            void refreshUnread();
          } else {
            setConversations((list) => list.map((item) => ({ ...item, unread: 0 })));
          }
          return;
        }
        if (command === NOTICE_COMMAND.idleMessage) {
          const sender = event.payload.senderUserName;
          if (!sender || sender === selfRef.current) {
            return;
          }
          if (activeUserRef.current === sender) {
            void invokeChatMarkRead({ userName: sender }).catch((err: unknown) => {
              if (isBridgeGapError(err)) {
                markGap(err.command);
              }
            });
            return;
          }
          setConversations((list) =>
            bumpUnread(list, sender, 1, {
              preview: event.payload.preview,
              peerAvatarUrl: event.payload.senderAvatarUrl,
            }),
          );
          toast.message(`${sender} 发来私聊`, {
            description: event.payload.preview || "新消息",
          });
        }
      }
    };
  }, [acceptSession, markGap, refreshUnread]);

  useEffect(() => {
    // 宿主随登录挂载。AppShell 用 display:none 隐藏面板，不会卸载，故此处不得按可见性断开。
    mountedRef.current = true;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    async function boot(): Promise<void> {
      try {
        const me = await invokeAuthMe();
        if (cancelled) {
          return;
        }
        selfRef.current = me.user?.userName ?? null;
        setSelfUserName(selfRef.current);
        if (me.sessionGeneration > 0) {
          sessionGenRef.current = me.sessionGeneration;
        }
      } catch {
        if (!cancelled) {
          setError("无法读取当前登录用户");
        }
      }

      try {
        const stop = await listenChatEvents((event) => {
          handleEventRef.current(event);
        });
        if (cancelled) {
          stop();
          return;
        }
        unlisten = stop;
        setCapabilities((prev) => (prev.events ? prev : { ...prev, events: true }));
      } catch {
        if (!cancelled) {
          setCapabilities((prev) => ({ ...prev, events: false }));
        }
      }

      if (cancelled) {
        return;
      }

      await connectGlobal();
      if (cancelled) {
        return;
      }
      await loadList();
    }

    void boot();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      unlisten?.();
      const user = connectedUserRef.current;
      connectedUserRef.current = null;
      globalConnectedRef.current = false;
      if (user) {
        void invokeChatDisconnect({ userName: user }).catch(() => undefined);
      }
      void invokeChatDisconnect({}).catch(() => undefined);
    };
  }, [connectGlobal, loadList]);

  const setStartOpenAndMaybeRetry = useCallback(
    (open: boolean) => {
      setStartOpen(open);
      if (open && !listReadyRef.current) {
        void connectGlobal();
        void loadList();
      }
    },
    [connectGlobal, loadList],
  );

  useEffect(() => {
    publishImUnread(sumUnread(conversations));
  }, [conversations]);

  useEffect(() => {
    return () => {
      publishImUnread(0);
    };
  }, []);

  useEffect(() => {
    if (!activeUser) {
      setPeerNickname(null);
      return;
    }
    let cancelled = false;
    setPeerNickname(null);
    void fetchUserProfile(activeUser).then((outcome) => {
      if (cancelled) {
        return;
      }
      if (outcome.status === "ok") {
        const nick = outcome.profile.userNickname.trim();
        setPeerNickname(nick.length > 0 ? nick : null);
        return;
      }
      setPeerNickname(null);
    });
    return () => {
      cancelled = true;
    };
  }, [activeUser]);

  return {
    selfUserName,
    conversations,
    activeUser,
    peerNickname,
    messages,
    loadingList,
    loadingThread,
    loadingMore,
    hasMore,
    sending,
    pendingConfirm,
    error,
    capabilities,
    startOpen,
    setStartOpen: setStartOpenAndMaybeRetry,
    quote,
    setQuote,
    clearQuote,
    clearThread,
    pendingMention,
    setPendingMention,
    clearPendingMention: () => setPendingMention(null),
    openConversation,
    loadMore,
    send,
    revoke,
    searchUsers,
    startChat,
  };
}

function previewOf(message: PrivateMessageDto): string {
  const text = message.text?.trim() || message.md?.trim() || "";
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function appendMessage(
  current: PrivateMessageDto[],
  message: PrivateMessageDto,
): PrivateMessageDto[] {
  if (current.some((item) => item.id === message.id)) {
    return current.map((item) =>
      item.id === message.id
        ? {
            ...item,
            ...message,
            revoked: item.revoked || message.revoked,
          }
        : item,
    );
  }
  return [...current, message];
}

function resolvePeer(
  eventUser: string | undefined,
  messageUser: string,
  selfUserName: string | null,
  activeUser: string | null,
): string | null {
  if (eventUser && eventUser !== selfUserName) {
    return eventUser;
  }
  if (messageUser && messageUser !== selfUserName) {
    return messageUser;
  }
  return activeUser;
}
