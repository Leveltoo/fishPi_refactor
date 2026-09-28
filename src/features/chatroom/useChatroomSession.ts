import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessageDto, ChatroomListenEvent, OnlineEvent } from "../../lib/types";
import {
  invokeAuthMe,
  invokeChatroomConnect,
  invokeChatroomDisconnect,
  invokeChatroomHistory,
  invokeChatroomRevoke,
  invokeChatroomSend,
  listenChatroom,
} from "../../lib/tauri";
import {
  BEFORE_PAGE_SIZE,
  HISTORY_FIRST_PAGE,
  INITIAL_CONNECTION_STATUS,
  MAX_BEFORE_PAGES,
} from "./constants";
import {
  generationsFrom,
  matchesGeneration,
  normalizeChatroomEvent,
  type GenerationPair,
} from "./events";
import { isDisconnectedStatus } from "./labels";
import {
  applyHistory,
  applyMessage,
  applyRedpacketStatus,
  applyRevoke,
  clearMessagesKeepRevokes,
  createChatWindow,
  firstMessageId,
  isWindowOverflow,
  seedOffline,
  snapshotMessages,
  trimOldestToLimit,
} from "./messageWindow";
import { mapOfflineChatroomRecords } from "./offlineSeed";
import { loadOffline } from "../desktop/offline";
import { isOutcomeUnknown, toUserErrorMessage } from "./toUserError";

type Phase = "boot" | "await-history" | "live";
type OnlineUser = OnlineEvent["users"][number];

function readStatus(value: unknown): string | null {
  if (value == null || typeof value !== "object") {
    return null;
  }
  const status = (value as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}

function isMsgOrRevoke(event: unknown): boolean {
  const kind = normalizeChatroomEvent(event).kind;
  return kind === "msg" || kind === "revoke";
}

/**
 * 聊天室同步：listen 完成后再 connect；连接返回前的事件按代次暂存并 replay。
 * send 成功不本地 echo 冒充已发送气泡。
 */
export function useChatroomSession() {
  const windowRef = useRef(createChatWindow());
  const gensRef = useRef<GenerationPair | null>(null);
  const phaseRef = useRef<Phase>("boot");
  const bufferRef = useRef<ChatroomListenEvent[]>([]);
  const beforePagesRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const resyncingRef = useRef(false);
  const activeRef = useRef(false);
  const mutePublishRef = useRef(false);
  const offlineMessagesRef = useRef<ChatMessageDto[]>([]);
  const offlineLoadRef = useRef<Promise<void> | null>(null);
  const offlineLoadedRef = useRef(false);
  const handleEventRef = useRef<(event: ChatroomListenEvent) => void>(
    () => undefined,
  );
  const acceptConnectionRef = useRef<(result: unknown) => void>(() => undefined);
  const runInitialSyncRef = useRef<() => Promise<void>>(async () => undefined);
  const loadOfflineSeedRef = useRef<() => Promise<void>>(async () => undefined);

  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [topic, setTopic] = useState("");
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const [connectionStatus, setConnectionStatus] = useState(
    INITIAL_CONNECTION_STATUS,
  );
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [historyIncomplete, setHistoryIncomplete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [selfUserName, setSelfUserName] = useState<string | null>(null);
  const [selfRole, setSelfRole] = useState<string | null>(null);
  const [windowEpoch, setWindowEpoch] = useState(0);
  /** 红包领取人快照：数组引用跨快照共享，内容随 redpacket-status 就地累计。 */
  const [redpacketWho, setRedpacketWho] = useState<Map<string, string[]>>(
    () => new Map(),
  );

  const publish = useCallback((): void => {
    if (mutePublishRef.current) {
      return;
    }
    setMessages(snapshotMessages(windowRef.current));
    setRedpacketWho(new Map(windowRef.current.redpacketWho));
  }, []);

  /** 只读离线库用于展示；写入继续由 DesktopMount 负责，避免双写。 */
  const seedFromOffline = useCallback((): void => {
    const offline = offlineMessagesRef.current;
    if (offline.length === 0) {
      return;
    }
    seedOffline(windowRef.current, offline);
    if (isWindowOverflow(windowRef.current)) {
      trimOldestToLimit(windowRef.current);
    }
    publish();
  }, [publish]);

  const loadOfflineSeed = useCallback((): Promise<void> => {
    if (offlineLoadedRef.current) {
      seedFromOffline();
      return Promise.resolve();
    }
    const inflight = offlineLoadRef.current;
    // StrictMode / 重建时避免重复 invoke；已有在途读取就复用。
    if (inflight != null) {
      return inflight;
    }
    const task = loadOffline()
      .then((snapshot) => {
        offlineMessagesRef.current = mapOfflineChatroomRecords(
          snapshot.chatroom ?? [],
        );
        offlineLoadedRef.current = true;
        if (!activeRef.current) {
          return;
        }
        seedFromOffline();
      })
      .catch(() => {
        // 离线库不可用时不挡在线历史；展示退回纯在线消息。
      })
      .finally(() => {
        offlineLoadRef.current = null;
      });
    offlineLoadRef.current = task;
    return task;
  }, [seedFromOffline]);

  const flushPublish = useCallback((): void => {
    setMessages(snapshotMessages(windowRef.current));
    setRedpacketWho(new Map(windowRef.current.redpacketWho));
  }, []);

  const applyRealtime = useCallback(
    (event: ChatroomListenEvent): void => {
      const normalized = normalizeChatroomEvent(event);
      switch (normalized.kind) {
        case "online": {
          setUsers(normalized.payload.users ?? []);
          if (normalized.payload.onlineCount != null) {
            setOnlineCount(Number(normalized.payload.onlineCount));
          }
          if (normalized.payload.discussing != null) {
            setTopic(normalized.payload.discussing);
          }
          return;
        }
        case "discuss":
          setTopic(normalized.payload.discussing);
          return;
        case "connection":
          setConnectionStatus(normalized.payload.status);
          return;
        case "msg":
          applyMessage(windowRef.current, normalized.payload);
          publish();
          return;
        case "revoke":
          applyRevoke(windowRef.current, normalized.payload.messageId);
          publish();
          return;
        case "redpacket-status":
          if (applyRedpacketStatus(windowRef.current, normalized.payload)) {
            publish();
          }
          return;
        case "ignored":
          return;
      }
    },
    [publish],
  );

  const drainMeta = useCallback((): void => {
    const kept: ChatroomListenEvent[] = [];
    for (const event of bufferRef.current) {
      if (!matchesGeneration(event, gensRef.current)) {
        continue;
      }
      if (isMsgOrRevoke(event)) {
        kept.push(event);
        continue;
      }
      applyRealtime(event);
    }
    bufferRef.current = kept;
  }, [applyRealtime]);

  const replayBufferedMessages = useCallback((): void => {
    mutePublishRef.current = true;
    const pending = bufferRef.current.splice(0);
    try {
      for (const event of pending) {
        if (!matchesGeneration(event, gensRef.current)) {
          continue;
        }
        applyRealtime(event);
      }
    } finally {
      mutePublishRef.current = false;
      flushPublish();
    }
  }, [applyRealtime, flushPublish]);

  const handleEvent = useCallback(
    (event: ChatroomListenEvent): void => {
      if (!activeRef.current) {
        return;
      }
      if (phaseRef.current === "boot") {
        bufferRef.current.push(event);
        return;
      }
      if (!matchesGeneration(event, gensRef.current)) {
        return;
      }
      if (phaseRef.current !== "live" && isMsgOrRevoke(event)) {
        bufferRef.current.push(event);
        return;
      }
      applyRealtime(event);
    },
    [applyRealtime],
  );

  const loadLatestHistory = useCallback(async (): Promise<void> => {
    const result = await invokeChatroomHistory({ page: HISTORY_FIRST_PAGE });
    if (!activeRef.current) {
      return;
    }
    if (!matchesGeneration(result, gensRef.current)) {
      return;
    }
    applyHistory(windowRef.current, result.messages ?? []);
    if (isWindowOverflow(windowRef.current)) {
      trimOldestToLimit(windowRef.current);
      setHistoryIncomplete(true);
    }
    setHasMore((result.messages?.length ?? 0) > 0 && result.exhausted !== true);
    beforePagesRef.current = 0;
    publish();
  }, [publish]);

  const resyncLatest = useCallback(
    async (reason: string): Promise<void> => {
      if (resyncingRef.current || !activeRef.current) {
        return;
      }
      resyncingRef.current = true;
      phaseRef.current = "await-history";
      setHistoryIncomplete(true);
      setNotice(reason);
      clearMessagesKeepRevokes(windowRef.current);
      // 清空后先回放离线，再合在线历史；已撤回仍由 revokedIds 钉住。
      seedFromOffline();
      setWindowEpoch((epoch) => epoch + 1);
      publish();
      try {
        await loadLatestHistory();
        if (!activeRef.current) {
          return;
        }
        replayBufferedMessages();
        if (isWindowOverflow(windowRef.current)) {
          trimOldestToLimit(windowRef.current);
          publish();
        }
        phaseRef.current = "live";
      } finally {
        resyncingRef.current = false;
      }
    },
    [loadLatestHistory, publish, replayBufferedMessages, seedFromOffline],
  );

  const acceptConnection = useCallback((result: unknown): void => {
    const gens = generationsFrom(result);
    if (gens != null) {
      gensRef.current = gens;
    }
    const status = readStatus(result);
    if (status != null) {
      setConnectionStatus(status);
    }
  }, []);

  const runInitialSync = useCallback(async (): Promise<void> => {
    phaseRef.current = "await-history";
    drainMeta();
    setLoading(true);
    try {
      // 离线记录先于（或并行于）首屏历史进窗口；历史 applyHistory 按 ID 去重。
      await loadOfflineSeed();
      if (!activeRef.current) {
        return;
      }
      await loadLatestHistory();
      if (!activeRef.current) {
        return;
      }
      replayBufferedMessages();
      if (isWindowOverflow(windowRef.current)) {
        await resyncLatest("消息窗口已达上限，已重新加载最近消息。");
        return;
      }
      phaseRef.current = "live";
    } finally {
      if (activeRef.current) {
        setLoading(false);
      }
    }
  }, [drainMeta, loadLatestHistory, loadOfflineSeed, replayBufferedMessages, resyncLatest]);

  handleEventRef.current = handleEvent;
  acceptConnectionRef.current = acceptConnection;
  runInitialSyncRef.current = runInitialSync;
  loadOfflineSeedRef.current = loadOfflineSeed;

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    activeRef.current = true;
    phaseRef.current = "boot";
    bufferRef.current = [];
    gensRef.current = null;

    async function start(): Promise<void> {
      // 离线库与 listen/connect 并行；不阻塞建连，seed 在 loadOfflineSeed 内完成。
      void loadOfflineSeedRef.current();
      // 必须先 listen 再 connect，否则连接响应前的事件会无人接收。
      unlisten = await listenChatroom((event) => {
        handleEventRef.current(event);
      });
      if (cancelled) {
        unlisten();
        return;
      }

      try {
        const connected = await invokeChatroomConnect();
        if (cancelled) {
          return;
        }
        acceptConnectionRef.current(connected);
        await runInitialSyncRef.current();
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(toUserErrorMessage(err));
        setConnectionStatus(INITIAL_CONNECTION_STATUS);
        setLoading(false);
      }

      try {
        const me = await invokeAuthMe();
        if (cancelled) {
          return;
        }
        const name = me.user?.userName;
        if (typeof name === "string" && name.length > 0) {
          setSelfUserName(name);
        }
        const role = me.user?.role;
        if (typeof role === "string" && role.length > 0) {
          setSelfRole(role);
        }
      } catch {
        // 聊天室不依赖身份摘要；对齐气泡失败时退回统一左列。
      }
    }

    void start();

    return () => {
      cancelled = true;
      activeRef.current = false;
      phaseRef.current = "boot";
      unlisten?.();
      // 卸载时断开；StrictMode 双挂载靠 cancelled / activeRef 丢弃上一次异步结果。
      void invokeChatroomDisconnect();
    };
  // 挂载一次。回调经 ref 更新，避免依赖变化导致重复 listen/connect。
  }, []);

  useEffect(() => {
    if (phaseRef.current !== "live") {
      return;
    }
    if (isWindowOverflow(windowRef.current)) {
      void resyncLatest("消息窗口已达上限，已重新加载最近消息。");
    }
  }, [messages, resyncLatest]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (
      !activeRef.current ||
      phaseRef.current !== "live" ||
      loadingMoreRef.current ||
      !hasMore
    ) {
      return;
    }
    const anchor = firstMessageId(windowRef.current);
    if (anchor == null) {
      return;
    }
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await invokeChatroomHistory({
        aroundId: anchor,
        mode: "before",
        size: BEFORE_PAGE_SIZE,
      });
      if (!activeRef.current) {
        return;
      }
      if (!matchesGeneration(result, gensRef.current)) {
        return;
      }
      const { added } = applyHistory(windowRef.current, result.messages ?? []);
      beforePagesRef.current += 1;
      if (
        result.exhausted === true ||
        added === 0 ||
        beforePagesRef.current >= MAX_BEFORE_PAGES
      ) {
        setHasMore(false);
      }
      if (isWindowOverflow(windowRef.current)) {
        setHasMore(false);
        await resyncLatest("消息窗口已达上限，已重新加载最近消息。");
        return;
      }
      publish();
    } catch (err) {
      setError(toUserErrorMessage(err));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, publish, resyncLatest]);

  const send = useCallback(async (content: string): Promise<boolean> => {
    setSending(true);
    setError(null);
    try {
      // 成功只表示请求已接受，禁止插入伪造成功气泡；等 WS / 历史真实消息。
      const result = await invokeChatroomSend({ content });
      if (!activeRef.current) {
        return false;
      }
      if (result.outcomeUnknown) {
        setPendingConfirm(true);
        return false;
      }
      if (result.accepted) {
        setPendingConfirm(false);
        return true;
      }
      return false;
    } catch (err) {
      if (isOutcomeUnknown(err)) {
        setPendingConfirm(true);
        return false;
      }
      setError(toUserErrorMessage(err));
      return false;
    } finally {
      setSending(false);
    }
  }, []);

  const revoke = useCallback(async (messageId: string): Promise<void> => {
    const id = messageId.trim();
    if (!activeRef.current || id.length === 0) {
      return;
    }
    setError(null);
    try {
      await invokeChatroomRevoke({ messageId: id });
      if (!activeRef.current) {
        return;
      }
      applyRevoke(windowRef.current, id);
      publish();
    } catch (err) {
      if (isOutcomeUnknown(err)) {
        setNotice("撤回结果待确认。请等待回显，不要重复提交。");
        return;
      }
      setError(toUserErrorMessage(err));
    }
  }, [publish]);

  const rebuild = useCallback(async (): Promise<void> => {
    if (!activeRef.current || busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    phaseRef.current = "boot";
    bufferRef.current = [];
    setConnectionStatus("connecting");
    try {
      await invokeChatroomDisconnect();
      const connected = await invokeChatroomConnect();
      if (!activeRef.current) {
        return;
      }
      acceptConnection(connected);
      clearMessagesKeepRevokes(windowRef.current);
      seedFromOffline();
      setWindowEpoch((epoch) => epoch + 1);
      publish();
      await runInitialSync();
    } catch (err) {
      setError(toUserErrorMessage(err));
      setConnectionStatus(INITIAL_CONNECTION_STATUS);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [acceptConnection, publish, runInitialSync, seedFromOffline]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!activeRef.current || busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    phaseRef.current = "await-history";
    try {
      clearMessagesKeepRevokes(windowRef.current);
      seedFromOffline();
      setWindowEpoch((epoch) => epoch + 1);
      publish();
      await runInitialSync();
    } catch (err) {
      setError(toUserErrorMessage(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [publish, runInitialSync, seedFromOffline]);

  return {
    messages,
    redpacketWho,
    topic,
    onlineCount,
    users,
    connectionStatus,
    loading,
    loadingMore,
    hasMore,
    historyIncomplete,
    notice,
    error,
    sending,
    pendingConfirm,
    busy,
    selfUserName,
    selfRole,
    windowEpoch,
    sendDisabled: isDisconnectedStatus(connectionStatus) || busy,
    send,
    revoke,
    loadMore,
    rebuild,
    refresh,
  };
}
