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
import type { BreezemoonDto } from "./types";
import { BREEZEMOON_COMMAND, PAGE_SIZE } from "./types";
import { mergeById } from "../article/contentState";

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
  const [scrollReset, setScrollReset] = useState(0);

  const pageRef = useRef(1);
  const loadSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const sendLock = useRef(false);
  const pagingLock = useRef(false);
  const sessionGeneration = useRef(0);
  const userNameRef = useRef(userName);
  userNameRef.current = userName;

  function acceptSession(generation: number): boolean {
    if (generation <= 0) return false;
    if (sessionGeneration.current === 0) sessionGeneration.current = generation;
    return sessionGeneration.current === generation;
  }

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
      pagingLock.current = true;
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
        if (!mountedRef.current || seq !== loadSeqRef.current ||
          !acceptSession(result.sessionGeneration)) {
          return;
        }
        pageRef.current = page;
        setHasMore(!result.exhausted && result.items.length > 0);
        setItems((current) =>
          append ? mergeById(current, result.items) : result.items,
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
          pagingLock.current = false;
        }
      }
    },
    [markGap],
  );

  const refresh = useCallback((): Promise<void> => {
    return loadPage(1, false);
  }, [loadPage]);

  const loadMore = useCallback((): void => {
    if (loading || loadingMore || !hasMore || pagingLock.current) {
      return;
    }
    void loadPage(pageRef.current + 1, true);
  }, [hasMore, loadPage, loading, loadingMore]);

  const send = useCallback(
    async (content: string): Promise<boolean> => {
      const text = content.trim();
      if (text.length === 0 || sendLock.current || pendingConfirm) {
        return false;
      }
      if (isCommandMissing(BREEZEMOON_COMMAND.send)) {
        setError(new BridgeGapError(BREEZEMOON_COMMAND.send).message);
        return false;
      }
      sendLock.current = true;
      setSending(true);
      setError(null);
      const targetUser = userNameRef.current;
      try {
        const result = await invokeBreezemoonSend({ content: text });
        if (!mountedRef.current || targetUser !== userNameRef.current ||
          !acceptSession(result.sessionGeneration)) {
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
        const seq = ++loadSeqRef.current;
        pagingLock.current = true;
        try {
          const first = await invokeBreezemoonList({
            page: 1, size: PAGE_SIZE, userName: targetUser,
          });
          if (mountedRef.current && seq === loadSeqRef.current &&
            acceptSession(first.sessionGeneration)) {
            setItems((current) => mergeById(first.items, current));
            if (pageRef.current === 1) setHasMore(!first.exhausted);
            setScrollReset((value) => value + 1);
          }
        } catch (err) {
          if (mountedRef.current && seq === loadSeqRef.current) {
            setError(`已发送，列表刷新失败：${toUserErrorMessage(err)}`);
          }
        } finally {
          if (mountedRef.current && seq === loadSeqRef.current) {
            setLoading(false);
            setLoadingMore(false);
            pagingLock.current = false;
          }
        }
        return true;
      } catch (err) {
        if (!mountedRef.current || targetUser !== userNameRef.current) {
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
        sendLock.current = false;
        if (mountedRef.current) {
          setSending(false);
        }
      }
    },
    [markGap, pendingConfirm],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadSeqRef.current += 1;
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
    scrollReset,
    refresh,
    loadMore,
    send,
  };
}
