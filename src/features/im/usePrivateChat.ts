import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

import { invokeAuthMe } from "../../lib/tauri";
import { fetchUserProfile } from "../overlay/api";
import {
  invokeChatConnect, invokeChatDisconnect, invokeChatHistory, invokeChatList,
  invokeChatMarkRead, invokeChatRevoke, invokeChatSend, invokeChatUnread,
  invokeUserSearch, listenChatEvents,
} from "./api";
import { HISTORY_PAGE_SIZE } from "./constants";
import { formatPrivateReply } from "./replyQuote";
import { loadOfflineThread } from "./offlineSeed";
import { confirmsWrite, mergeThreadMessages, messagePeer, type PendingWrite } from "./threadState";
import {
  applyUnreadCounts, bumpUnread, clearUnread, conversationsFrom, toConversation,
  upsertConversation,
} from "./conversation";
import { isBridgeGapError, isOutcomeUnknown, toUserErrorMessage } from "./errors";
import { publishImUnread, sumUnread } from "./unreadBus";
import type {
  ChatConnectRequest, ChatListenEvent, Conversation, PrivateMessageDto,
  ReplyTarget, UserSearchHit,
} from "./types";
import { CHAT_COMMAND, NOTICE_COMMAND, USER_COMMAND } from "./types";

export type ImCapabilities = {
  list: boolean; history: boolean; send: boolean; search: boolean; events: boolean;
};
const ALL_READY: ImCapabilities = { list: true, history: true, send: true, search: true, events: true };
type Connection = ChatConnectRequest & { userName: string };

export function usePrivateChat() {
  const [selfUserName, setSelfUserName] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeUser, setActiveUser] = useState<string | null>(null);
  const [messages, setMessages] = useState<PrivateMessageDto[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<ImCapabilities>(ALL_READY);
  const [startOpen, setStartOpen] = useState(false);
  const [quote, setQuote] = useState<ReplyTarget | null>(null);
  const [peerNickname, setPeerNickname] = useState<string | null>(null);
  const [pendingMention, setPendingMention] = useState<string | null>(null);
  const [confirmedContent, setConfirmedContent] = useState<string | null>(null);

  const selfRef = useRef("");
  const sessionRef = useRef(0);
  const lifecycleRef = useRef(0);
  const mountedRef = useRef(false);
  const activeRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);
  const openSequenceRef = useRef(0);
  const listSequenceRef = useRef(0);
  const unreadSequenceRef = useRef(0);
  const pageRef = useRef(1);
  const moreRef = useRef(false);
  const pagingRef = useRef(false);
  const connectedRef = useRef<Connection | null>(null);
  const connectQueueRef = useRef<Promise<void>>(Promise.resolve());
  const bootRef = useRef<Promise<void>>(Promise.resolve());
  const messagesRef = useRef(messages);
  const quoteRef = useRef(quote);
  const sendingRef = useRef(false);
  const pendingWritesRef = useRef(new Map<string, PendingWrite>());
  const confirmedDraftsRef = useRef(new Map<string, string>());
  const conversationsRef = useRef(conversations);
  const revokedIdsRef = useRef(new Set<string>());
  const revokingIdsRef = useRef(new Set<string>());
  const uncertainRevokesRef = useRef(new Set<string>());
  const seenMessagesRef = useRef(new Set<string>());
  const readingRef = useRef(new Set<string>());
  const readAgainRef = useRef(new Set<string>());
  const handlerRef = useRef<(event: ChatListenEvent) => void>(() => undefined);
  const visibleRef = useRef(false);
  messagesRef.current = messages;
  conversationsRef.current = conversations;
  quoteRef.current = quote;

  const current = useCallback((life: number, session: number): boolean =>
    mountedRef.current && life === lifecycleRef.current && session > 0 && session === sessionRef.current, []);

  const markCapability = useCallback((command: string, ready: boolean): void => {
    const key = command === CHAT_COMMAND.list ? "list" :
      command === CHAT_COMMAND.history ? "history" :
      command === CHAT_COMMAND.send ? "send" :
      command === USER_COMMAND.search ? "search" : null;
    if (key) setCapabilities((previous) => ({ ...previous, [key]: ready }));
  }, []);

  const handleError = useCallback((err: unknown): void => {
    if (isBridgeGapError(err)) markCapability(err.command, false);
    setError(toUserErrorMessage(err));
  }, [markCapability]);

  const refreshUnread = useCallback(async (): Promise<void> => {
    const life = lifecycleRef.current;
    const session = sessionRef.current;
    const seq = ++unreadSequenceRef.current;
    try {
      const result = await invokeChatUnread();
      if (!current(life, session) || result.sessionGeneration !== session ||
          seq !== unreadSequenceRef.current) return;
      // unread 是逐条消息，不能先按 peer 去重。
      const rows = result.messages.map((row) => toConversation(row, selfRef.current));
      setConversations((list) => applyUnreadCounts(list, rows));
    } catch (err) {
      if (current(life, session)) handleError(err);
    }
  }, [current, handleError]);

  const markRead = useCallback(async (userName: string): Promise<void> => {
    if (!visibleRef.current || activeRef.current !== userName) return;
    if (readingRef.current.has(userName)) {
      readAgainRef.current.add(userName);
      return;
    }
    const life = lifecycleRef.current;
    const session = sessionRef.current;
    readingRef.current.add(userName);
    try {
      await invokeChatMarkRead({ userName, sessionGeneration: session });
      if (!current(life, session)) return;
      ++unreadSequenceRef.current;
      setConversations((list) => clearUnread(list, userName));
    } catch (err) {
      if (current(life, session)) handleError(err);
    } finally {
      readingRef.current.delete(userName);
      if (readAgainRef.current.delete(userName) && current(life, session)) void markRead(userName);
    }
  }, [current, handleError]);

  const loadList = useCallback(async (): Promise<void> => {
    const life = lifecycleRef.current;
    const session = sessionRef.current;
    const seq = ++listSequenceRef.current;
    setLoadingList(true);
    try {
      const result = await invokeChatList();
      if (!current(life, session) || result.sessionGeneration !== session ||
          seq !== listSequenceRef.current) return;
      markCapability(CHAT_COMMAND.list, true);
      const items = conversationsFrom(result.conversations, selfRef.current);
      setConversations((list) => [
        ...items.map((item) => ({ ...item, unread: list.find((x) => x.peerUserName === item.peerUserName)?.unread ?? 0 })),
        ...list.filter((item) => !items.some((x) => x.peerUserName === item.peerUserName)),
      ]);
      setError(null);
      await refreshUnread();
    } catch (err) {
      if (current(life, session)) handleError(err);
    } finally {
      if (current(life, session) && seq === listSequenceRef.current) setLoadingList(false);
    }
  }, [current, handleError, markCapability, refreshUnread]);

  const loadHistory = useCallback(async (userName: string, page: number, seq: number): Promise<void> => {
    const life = lifecycleRef.current;
    const session = sessionRef.current;
    try {
      const history = await invokeChatHistory({
        userName, page, size: HISTORY_PAGE_SIZE, sessionGeneration: session,
      });
      if (!current(life, session) || history.sessionGeneration !== session ||
          seq !== sequenceRef.current || activeRef.current !== userName) return;
      if (page > 1 || pageRef.current === 1) {
        pageRef.current = page;
        moreRef.current = !history.exhausted && history.messages.length >= HISTORY_PAGE_SIZE;
        setHasMore(moreRef.current);
      }
      const pending = pendingWritesRef.current.get(userName);
      const confirmed = pending && history.messages.some((message) => confirmsWrite(message, pending, selfRef.current));
      for (const message of history.messages) {
        seenMessagesRef.current.add(message.id);
        if (message.revoked) revokedIdsRef.current.add(message.id);
      }
      setMessages((list) => mergeThreadMessages(list, history.messages, { revokedIds: revokedIdsRef.current }));
      markCapability(CHAT_COMMAND.history, true);
      setError(null);
      if (confirmed && pending) {
        pendingWritesRef.current.delete(userName);
        confirmedDraftsRef.current.set(userName, pending.draftContent ?? pending.content);
        setPendingConfirm(false);
        setConfirmedContent(pending.draftContent ?? pending.content);
        setQuote(null);
      }
      if (page === 1) void markRead(userName);
    } catch (err) {
      if (current(life, session) && seq === sequenceRef.current) handleError(err);
    }
  }, [current, handleError, markCapability, markRead]);

  const openConversation = useCallback(async (name: string): Promise<void> => {
    const userName = name.trim();
    if (!userName) return;
    const requestSeq = ++openSequenceRef.current;
    const life = lifecycleRef.current;
    await bootRef.current;
    const session = sessionRef.current;
    if (!current(life, session) || requestSeq !== openSequenceRef.current) return;
    const known = conversationsRef.current.find((item) => item.peerUserName === userName);
    const profile = await fetchUserProfile(userName);
    if (!current(life, session) || requestSeq !== openSequenceRef.current) return;
    if (profile.status !== "ok" && !known) {
      toast.error(profile.message);
      return;
    }
    const seq = ++sequenceRef.current;
    activeRef.current = userName;
    setActiveUser(userName);
    setPeerNickname(profile.status === "ok" ? profile.profile.userNickname || null : null);
    setQuote(null);
    setPendingMention(null);
    setConfirmedContent(confirmedDraftsRef.current.get(userName) ?? null);
    setSending(false);
    setPendingConfirm(pendingWritesRef.current.has(userName));
    setMessages([]);
    pageRef.current = 1;
    pagingRef.current = false;
    moreRef.current = false;
    setLoadingMore(false);
    setHasMore(false);
    setLoadingThread(true);
    setConversations((list) => upsertConversation(list, {
      peerUserName: userName, peerAvatarUrl: profile.status === "ok" ? profile.profile.userAvatarUrl : known?.peerAvatarUrl ?? "",
      preview: "", time: "", unread: list.find((item) => item.peerUserName === userName)?.unread ?? 0,
    }));
    void loadOfflineThread(userName).then((seed) => {
      if (!current(life, session) || seq !== sequenceRef.current) return;
      setMessages((list) => mergeThreadMessages(list, seed, {
        incomingWins: false, revokedIds: revokedIdsRef.current,
      }));
    });
    const history = loadHistory(userName, 1, seq);
    const connect = connectQueueRef.current.catch(() => undefined).then(async () => {
      if (!current(life, session) || seq !== sequenceRef.current) return;
      const previous = connectedRef.current;
      if (previous && previous.userName !== userName) {
        await invokeChatDisconnect(previous);
        connectedRef.current = null;
      }
      if (!current(life, session) || seq !== sequenceRef.current) return;
      const connection = await invokeChatConnect({ userName, sessionGeneration: session });
      if (!current(life, session) || connection.sessionGeneration !== session) return;
      connectedRef.current = {
        userName, sessionGeneration: session, connectionGeneration: connection.connectionGeneration,
      };
      // 新打开仍通过队列断开；旧回调不越过新打开的同名连接。
      if (seq !== sequenceRef.current && activeRef.current !== userName) {
        await invokeChatDisconnect(connectedRef.current);
        connectedRef.current = null;
      }
    });
    connectQueueRef.current = connect;
    try {
      await Promise.all([history, connect]);
    } catch (err) {
      if (current(life, session) && seq === sequenceRef.current) handleError(err);
    } finally {
      if (current(life, session) && seq === sequenceRef.current) setLoadingThread(false);
    }
  }, [current, handleError, loadHistory]);

  const loadMore = useCallback(async (): Promise<void> => {
    const userName = activeRef.current;
    if (!userName || pagingRef.current || !moreRef.current) return;
    const seq = sequenceRef.current;
    pagingRef.current = true;
    setLoadingMore(true);
    try {
      await loadHistory(userName, pageRef.current + 1, seq);
    } finally {
      if (mountedRef.current && seq === sequenceRef.current) {
        pagingRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [loadHistory]);

  const clearThread = useCallback(async (): Promise<void> => {
    const userName = activeRef.current;
    if (!userName) return;
    const seq = ++sequenceRef.current;
    const life = lifecycleRef.current;
    const session = sessionRef.current;
    pageRef.current = 1;
    pagingRef.current = false;
    setLoadingMore(false);
    setQuote(null);
    setMessages([]);
    setLoadingThread(true);
    await loadHistory(userName, 1, seq);
    if (current(life, session) && seq === sequenceRef.current) setLoadingThread(false);
  }, [current, loadHistory]);

  const send = useCallback(async (content: string): Promise<boolean> => {
    const userName = activeRef.current;
    const connection = connectedRef.current;
    if (!userName || connection?.userName !== userName || sendingRef.current ||
        pendingWritesRef.current.has(userName) || !content.trim()) return false;
    const life = lifecycleRef.current;
    const session = sessionRef.current;
    const seq = sequenceRef.current;
    const sentQuote = quoteRef.current;
    const payload = sentQuote ? formatPrivateReply(sentQuote, content) : content;
    const pending: PendingWrite = { content: payload, draftContent: content, knownIds: new Set(seenMessagesRef.current) };
    pendingWritesRef.current.set(userName, pending);
    confirmedDraftsRef.current.delete(userName);
    setConfirmedContent(null);
    sendingRef.current = true;
    setSending(true);
    let uncertain = false;
    try {
      const result = await invokeChatSend({ ...connection, userName, content: payload });
      if (!current(life, session) || result.sessionGeneration !== session) return false;
      markCapability(CHAT_COMMAND.send, true);
      if (result.outcomeUnknown) {
        uncertain = true;
        if (pendingWritesRef.current.has(userName) && seq === sequenceRef.current) {
          setPendingConfirm(true);
          toast.warning("发送结果待确认，请等待回显。");
        }
        return false;
      }
      pendingWritesRef.current.delete(userName);
      if (result.accepted) {
        confirmedDraftsRef.current.set(userName, content);
        if (activeRef.current === userName) {
          setConfirmedContent(content);
          setPendingConfirm(false);
          if (quoteRef.current === sentQuote) setQuote(null);
        }
        return true;
      }
      toast.error("发送未被接受");
      return false;
    } catch (err) {
      uncertain = isOutcomeUnknown(err);
      if (current(life, session) && seq === sequenceRef.current) {
        if (uncertain) {
          setPendingConfirm(pendingWritesRef.current.has(userName));
          toast.warning("发送结果待确认，请等待回显。");
        } else handleError(err);
      }
      return false;
    } finally {
      if (!uncertain) pendingWritesRef.current.delete(userName);
      sendingRef.current = false;
      if (current(life, session) && activeRef.current === userName) setSending(false);
    }
  }, [current, handleError, markCapability]);

  const revoke = useCallback(async (id: string): Promise<void> => {
    if (revokingIdsRef.current.has(id) || uncertainRevokesRef.current.has(id) ||
        !messagesRef.current.some((message) => message.id === id && message.userName === selfRef.current && !message.revoked)) return;
    const life = lifecycleRef.current;
    const session = sessionRef.current;
    const seq = sequenceRef.current;
    revokingIdsRef.current.add(id);
    try {
      await invokeChatRevoke({ id, sessionGeneration: session });
      if (!current(life, session)) return;
      revokedIdsRef.current.add(id);
      if (seq === sequenceRef.current) {
        setMessages((list) => mergeThreadMessages(list, [], { revokedIds: revokedIdsRef.current }));
        if (quoteRef.current?.id === id) setQuote(null);
      }
    } catch (err) {
      if (!current(life, session)) return;
      if (isOutcomeUnknown(err)) {
        uncertainRevokesRef.current.add(id);
        toast.warning("撤回结果待确认，请勿重复提交。");
      } else handleError(err);
    } finally {
      revokingIdsRef.current.delete(id);
    }
  }, [current, handleError]);

  const searchUsers = useCallback(async (query: string): Promise<UserSearchHit[]> => {
    const life = lifecycleRef.current;
    const session = sessionRef.current;
    if (!query.trim()) return [];
    try {
      const result = await invokeUserSearch({ query: query.trim() });
      if (!current(life, session) || (result.sessionGeneration && result.sessionGeneration !== session)) return [];
      markCapability(USER_COMMAND.search, true);
      return result.users;
    } catch (err) {
      if (current(life, session)) handleError(err);
      return [];
    }
  }, [current, handleError, markCapability]);

  const startChat = useCallback((user: UserSearchHit): void => {
    setStartOpen(false);
    void openConversation(user.userName);
  }, [openConversation]);

  const setVisible = useCallback((visible: boolean): void => {
    const changed = visibleRef.current !== visible;
    visibleRef.current = visible;
    if (changed && visible && activeRef.current) void markRead(activeRef.current);
  }, [markRead]);

  const clearQuote = useCallback(() => setQuote(null), []);
  const clearPendingMention = useCallback(() => setPendingMention(null), []);

  handlerRef.current = (event: ChatListenEvent): void => {
    if (!mountedRef.current || event.payload.sessionGeneration !== sessionRef.current || sessionRef.current <= 0) return;
    if (event.event === "chat://msg") {
      const message = event.payload.message;
      const peer = messagePeer(event.payload.userName, message, selfRef.current);
      if (!peer) return;
      const connection = connectedRef.current;
      if (event.payload.userName && connection?.userName === peer &&
          event.payload.connectionGeneration && connection.connectionGeneration &&
          event.payload.connectionGeneration !== connection.connectionGeneration) return;
      const duplicate = seenMessagesRef.current.has(message.id);
      seenMessagesRef.current.add(message.id);
      const viewing = activeRef.current === peer;
      const pending = pendingWritesRef.current.get(peer);
      if (pending && confirmsWrite(message, pending, selfRef.current)) {
        pendingWritesRef.current.delete(peer);
        confirmedDraftsRef.current.set(peer, pending.draftContent ?? pending.content);
        if (viewing) {
          setPendingConfirm(false);
          setConfirmedContent(pending.draftContent ?? pending.content);
          setQuote(null);
        }
      }
      if (viewing) {
        setMessages((list) => mergeThreadMessages(list, [message], { revokedIds: revokedIdsRef.current }));
        if (visibleRef.current) void markRead(peer);
      }
      const incoming = message.userName !== selfRef.current;
      setConversations((list) => bumpUnread(list, peer,
        !duplicate && incoming ? 1 : 0, {
          preview: previewOf(message), time: message.time,
          ...(incoming && message.userAvatarUrl ? { peerAvatarUrl: message.userAvatarUrl } : {}),
        }));
      return;
    }
    if (event.event === "chat://revoke") {
      const connection = connectedRef.current;
      if (event.payload.userName && event.payload.userName !== activeRef.current) {
        revokedIdsRef.current.add(event.payload.messageId);
        return;
      }
      if (event.payload.userName && connection?.connectionGeneration &&
          event.payload.connectionGeneration !== connection.connectionGeneration) return;
      revokedIdsRef.current.add(event.payload.messageId);
      uncertainRevokesRef.current.delete(event.payload.messageId);
      setMessages((list) => mergeThreadMessages(list, [], { revokedIds: revokedIdsRef.current }));
      if (quoteRef.current?.id === event.payload.messageId) setQuote(null);
      return;
    }
    if (event.event === "chat://notice" || event.event === "notice://refresh") {
      if (event.payload.command === NOTICE_COMMAND.unreadRefresh && event.payload.count === 0) {
        ++unreadSequenceRef.current;
        setConversations((list) => list.map((item) => ({ ...item, unread: 0 })));
      } else if (event.payload.command === NOTICE_COMMAND.unreadRefresh ||
                 event.payload.command === NOTICE_COMMAND.refreshNotification ||
                 event.payload.command === NOTICE_COMMAND.idleMessage) {
        // 全局/用户频道可能重复通知；以逐条未读为准，不双加。
        void refreshUnread();
        const sender = event.payload.senderUserName;
        if (sender && activeRef.current === sender && visibleRef.current) void markRead(sender);
      }
    }
  };

  useEffect(() => {
    const life = ++lifecycleRef.current;
    mountedRef.current = true;
    const stops: Array<() => void> = [];
    let cancelled = false;
    async function boot(): Promise<void> {
      try {
        const me = await invokeAuthMe();
        if (cancelled || life !== lifecycleRef.current) return;
        if (!me.user || me.sessionGeneration <= 0) throw new Error("unauthorized");
        selfRef.current = me.user.userName;
        sessionRef.current = me.sessionGeneration;
        setSelfUserName(selfRef.current);
        const stop = await listenChatEvents((event) => {
          if (!cancelled) handlerRef.current(event);
        });
        if (cancelled) { stop(); return; }
        stops.push(stop);
        const reconnectStop = await listen<{ chat?: string; sessionGeneration: number }>("desktop://reconnect", (event) => {
          if (cancelled || event.payload.sessionGeneration !== sessionRef.current ||
              !["已重新连接", "部分私聊通道已重新连接"].includes(event.payload.chat ?? "")) return;
          void loadList();
          const user = activeRef.current;
          if (user) void loadHistory(user, 1, sequenceRef.current);
        });
        if (cancelled) { reconnectStop(); return; }
        stops.push(reconnectStop);
        try {
          await invokeChatConnect({ sessionGeneration: sessionRef.current });
        } catch (err) {
          if (!cancelled) handleError(err);
        }
        if (!cancelled) await loadList();
      } catch (err) {
        if (!cancelled && life === lifecycleRef.current) {
          handleError(err);
          setLoadingList(false);
        }
      }
    }
    bootRef.current = boot();
    return () => {
      cancelled = true;
      mountedRef.current = false;
      ++sequenceRef.current;
      ++lifecycleRef.current;
      stops.forEach((stop) => stop());
      publishImUnread(0);
      // 全局频道共享给通知宿主，由退出状态统一清理。
      const cleanupLife = lifecycleRef.current;
      void connectQueueRef.current.catch(() => undefined).then(() => {
        if (mountedRef.current || cleanupLife !== lifecycleRef.current) return;
        const connection = connectedRef.current;
        connectedRef.current = null;
        if (connection) void invokeChatDisconnect(connection).catch(() => undefined);
      });
    };
  }, [handleError, loadHistory, loadList]);

  useEffect(() => { publishImUnread(sumUnread(conversations)); }, [conversations]);

  return {
    selfUserName, conversations, activeUser, peerNickname, messages, loadingList,
    loadingThread, loadingMore, hasMore, sending, pendingConfirm, error, capabilities,
    startOpen, setStartOpen, quote, setQuote, clearQuote,
    clearThread, pendingMention, setPendingMention,
    clearPendingMention,
    openConversation, loadMore, send, revoke, searchUsers, startChat, setVisible,
    confirmedContent,
  };
}

function previewOf(message: PrivateMessageDto): string {
  const text = message.md || message.text || "";
  const plain = text.includes("<") || text.includes("&")
    ? new DOMParser().parseFromString(text, "text/html").body.textContent ?? "" : text;
  return plain.replace(/\s+/g, " ").trim().slice(0, 80);
}
