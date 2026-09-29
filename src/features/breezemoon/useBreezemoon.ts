import { useCallback, useEffect, useRef, useState } from "react";

import {
  invokeBreezemoonList,
  invokeBreezemoonSend,
  isCommandMissing,
} from "./api";
import {
  BridgeGapError,
  isBridgeGapError,
  isOutcomeUnknown,
  toUserErrorMessage,
} from "./errors";
import { invokeAuthMe } from "../../lib/tauri";
import type { BreezemoonDto } from "./types";
import { BREEZEMOON_COMMAND, PAGE_SIZE } from "./types";

export type BreezemoonCapabilities = {
  list: boolean;
  send: boolean;
};

const ALL_READY: BreezemoonCapabilities = { list: true, send: true };

type UseBreezemoonOptions = {
  userName?: string;
};

export function useBreezemoon(options: UseBreezemoonOptions = {}) {
  const userName = options.userName?.trim() || undefined;
  const [items, setItems] = useState<BreezemoonDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [sending, setSending] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] =
    useState<BreezemoonCapabilities>(ALL_READY);
  const [selfUserName, setSelfUserName] = useState<string | null>(null);

  const pageRef = useRef(1);
  const loadSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const userNameRef = useRef(userName);
  userNameRef.current = userName;

  const markGap = useCallback((command: string): void => {
    setCapabilities((prev) => {
      if (command === BREEZEMOON_COMMAND.list && prev.list) {
        return { ...prev, list: false };
      }
      if (command === BREEZEMOON_COMMAND.send && prev.send) {
        return { ...prev, send: false };
      }
      return prev;
    });
  }, []);

  const loadPage = useCallback(
    async (page: number, append: boolean): Promise<void> => {
      if (isCommandMissing(BREEZEMOON_COMMAND.list)) {
        markGap(BREEZEMOON_COMMAND.list);
        setLoading(false);
        setLoadingMore(false);
        setHasMore(false);
        return;
      }
      const seq = ++loadSeqRef.current;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError(null);
      }
      try {
        const result = await invokeBreezemoonList({
          page,
          size: PAGE_SIZE,
          userName: userNameRef.current,
        });
        if (!mountedRef.current || seq !== loadSeqRef.current) {
          return;
        }
        pageRef.current = page;
        setHasMore(!result.exhausted && result.items.length > 0);
        setItems((current) =>
          append ? mergeUnique(current, result.items) : result.items,
        );
      } catch (err) {
        if (!mountedRef.current || seq !== loadSeqRef.current) {
          return;
        }
        if (isBridgeGapError(err)) {
          markGap(err.command);
          setHasMore(false);
          return;
        }
        setError(toUserErrorMessage(err));
      } finally {
        if (mountedRef.current && seq === loadSeqRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [markGap],
  );

  const refresh = useCallback((): Promise<void> => {
    return loadPage(1, false);
  }, [loadPage]);

  const loadMore = useCallback((): void => {
    if (loading || loadingMore || !hasMore) {
      return;
    }
    void loadPage(pageRef.current + 1, true);
  }, [hasMore, loadPage, loading, loadingMore]);

  const send = useCallback(
    async (content: string): Promise<boolean> => {
      const text = content.trim();
      if (text.length === 0) {
        return false;
      }
      if (isCommandMissing(BREEZEMOON_COMMAND.send)) {
        setError(new BridgeGapError(BREEZEMOON_COMMAND.send).message);
        return false;
      }
      setSending(true);
      setError(null);
      try {
        const result = await invokeBreezemoonSend({ content: text });
        if (!mountedRef.current) {
          return false;
        }
        if (result.outcomeUnknown) {
          setPendingConfirm(true);
          return false;
        }
        if (!result.accepted) {
          setError("发送未被接受，内容未发出");
          return false;
        }
        setPendingConfirm(false);
        // 已接受只表示请求进了服务端；用列表回读，不把草稿插进时间线冒充成功。
        void loadPage(1, false);
        return true;
      } catch (err) {
        if (!mountedRef.current) {
          return false;
        }
        if (isBridgeGapError(err)) {
          markGap(err.command);
          setError(err.message);
          return false;
        }
        if (isOutcomeUnknown(err)) {
          setPendingConfirm(true);
          return false;
        }
        setError(toUserErrorMessage(err));
        return false;
      } finally {
        if (mountedRef.current) {
          setSending(false);
        }
      }
    },
    [loadPage, markGap],
  );

  useEffect(() => {
    mountedRef.current = true;
    void (async () => {
      try {
        const me = await invokeAuthMe();
        if (mountedRef.current) {
          setSelfUserName(me.user?.userName ?? null);
        }
      } catch {
        // 读不到当前用户时不显示编辑/删除入口。
      }
    })();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    pageRef.current = 1;
    setItems([]);
    setHasMore(true);
    void loadPage(1, false);
  }, [loadPage, userName]);

  return {
    items,
    loading,
    loadingMore,
    hasMore,
    sending,
    pendingConfirm,
    error,
    capabilities,
    selfUserName,
    refresh,
    loadMore,
    send,
  };
}

function mergeUnique(
  current: BreezemoonDto[],
  incoming: BreezemoonDto[],
): BreezemoonDto[] {
  if (incoming.length === 0) {
    return current;
  }
  const seen = new Set(current.map((item) => item.id));
  const extra = incoming.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
  return extra.length === 0 ? current : [...current, ...extra];
}
