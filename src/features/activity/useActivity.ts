import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  invokeNoticeCount,
  invokeNoticeList,
  invokeNoticeMakeRead,
  invokeNoticeReadAll,
  invokeUserCheckin,
  invokeUserIsCheckin,
  invokeUserIsCollectedLiveness,
  invokeUserLiveness,
  invokeUserRewardLiveness,
  listenNoticeEvents,
  type UnlistenFn,
} from "./api";
import { DEFAULT_NOTICE_TYPE, LIVENESS_POLL_MS } from "./constants";
import { BridgeGapError, isBridgeGapError } from "./errors";
import type {
  NoticeCountDto,
  NoticeItemDto,
  NoticeListenEvent,
  NoticeType,
} from "./types";
import { NOTICE_COMMAND, USER_COMMAND } from "./types";

export type ActivityCapabilities = {
  count: boolean;
  list: boolean;
  makeRead: boolean;
  readAll: boolean;
  liveness: boolean;
  checkin: boolean;
  collected: boolean;
  reward: boolean;
};

const ALL_READY: ActivityCapabilities = {
  count: true,
  list: true,
  makeRead: true,
  readAll: true,
  liveness: true,
  checkin: true,
  collected: true,
  reward: true,
};

const EMPTY_COUNT: NoticeCountDto = {
  sessionGeneration: 0,
  notifyStatus: false,
  count: 0,
  reply: 0,
  point: 0,
  at: 0,
  broadcast: 0,
  sysAnnounce: 0,
  newFollower: 0,
  following: 0,
  commented: 0,
};

export function useActivity() {
  const [count, setCount] = useState<NoticeCountDto>(EMPTY_COUNT);
  const [noticeType, setNoticeType] = useState<NoticeType>(DEFAULT_NOTICE_TYPE);
  const [items, setItems] = useState<NoticeItemDto[]>([]);
  const [liveness, setLiveness] = useState<number | null>(null);
  const [checkedIn, setCheckedIn] = useState(false);
  const [collected, setCollected] = useState(false);
  const [loadingCount, setLoadingCount] = useState(true);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDaily, setLoadingDaily] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [rewarding, setRewarding] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const [capabilities, setCapabilities] =
    useState<ActivityCapabilities>(ALL_READY);

  const mountedRef = useRef(true);
  const sessionGenRef = useRef(0);
  const typeRef = useRef<NoticeType>(DEFAULT_NOTICE_TYPE);
  const intervalRef = useRef<number | null>(null);
  const handleEventRef = useRef<(event: NoticeListenEvent) => void>(
    () => undefined,
  );

  const markGap = useCallback((command: string): void => {
    setCapabilities((prev) => {
      if (command === NOTICE_COMMAND.count && prev.count) {
        return { ...prev, count: false };
      }
      if (command === NOTICE_COMMAND.list && prev.list) {
        return { ...prev, list: false };
      }
      if (command === NOTICE_COMMAND.makeRead && prev.makeRead) {
        return { ...prev, makeRead: false };
      }
      if (command === NOTICE_COMMAND.readAll && prev.readAll) {
        return { ...prev, readAll: false };
      }
      if (command === USER_COMMAND.liveness && prev.liveness) {
        return { ...prev, liveness: false };
      }
      if (command === USER_COMMAND.isCheckin && prev.checkin) {
        return { ...prev, checkin: false };
      }
      if (command === USER_COMMAND.checkin && prev.checkin) {
        return { ...prev, checkin: false };
      }
      if (command === USER_COMMAND.isCollectedLiveness && prev.collected) {
        return { ...prev, collected: false };
      }
      if (command === USER_COMMAND.rewardLiveness && prev.reward) {
        return { ...prev, reward: false };
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

  const rememberGeneration = useCallback((eventGen: number): void => {
    if (eventGen > 0) {
      sessionGenRef.current = eventGen;
    }
  }, []);

  const stopLivenessPoll = useCallback((): void => {
    if (intervalRef.current == null) {
      return;
    }
    window.clearInterval(intervalRef.current);
    intervalRef.current = null;
  }, []);

  const refreshCount = useCallback(async (): Promise<void> => {
    try {
      const result = await invokeNoticeCount();
      if (!mountedRef.current || !acceptSession(result.sessionGeneration)) {
        return;
      }
      rememberGeneration(result.sessionGeneration);
      setCount(result);
    } catch (error) {
      if (isBridgeGapError(error)) {
        markGap(error.command);
      }
    } finally {
      if (mountedRef.current) {
        setLoadingCount(false);
      }
    }
  }, [acceptSession, markGap, rememberGeneration]);

  const loadList = useCallback(
    async (type: NoticeType): Promise<void> => {
      setLoadingList(true);
      try {
        const result = await invokeNoticeList({ type });
        if (!mountedRef.current || typeRef.current !== type) {
          return;
        }
        if (!acceptSession(result.sessionGeneration)) {
          return;
        }
        rememberGeneration(result.sessionGeneration);
        setItems(result.items);
      } catch (error) {
        if (isBridgeGapError(error)) {
          markGap(error.command);
        }
        if (mountedRef.current && typeRef.current === type) {
          setItems([]);
        }
      } finally {
        if (mountedRef.current && typeRef.current === type) {
          setLoadingList(false);
        }
      }
    },
    [acceptSession, markGap, rememberGeneration],
  );

  const refreshLiveness = useCallback(async (): Promise<void> => {
    try {
      const value = await invokeUserLiveness();
      if (!mountedRef.current) {
        return;
      }
      setLiveness(value);
    } catch (error) {
      if (isBridgeGapError(error)) {
        markGap(error.command);
        stopLivenessPoll();
      }
    }
  }, [markGap, stopLivenessPoll]);

  const refreshDaily = useCallback(async (): Promise<void> => {
    const [checkinResult, collectedResult] = await Promise.allSettled([
      invokeUserIsCheckin(),
      invokeUserIsCollectedLiveness(),
    ]);
    if (!mountedRef.current) {
      return;
    }
    if (checkinResult.status === "fulfilled") {
      setCheckedIn(checkinResult.value);
    } else if (isBridgeGapError(checkinResult.reason)) {
      markGap(checkinResult.reason.command);
    }
    if (collectedResult.status === "fulfilled") {
      setCollected(collectedResult.value);
    } else if (isBridgeGapError(collectedResult.reason)) {
      markGap(collectedResult.reason.command);
    }
    setLoadingDaily(false);
  }, [markGap]);

  const selectType = useCallback(
    (type: NoticeType): void => {
      typeRef.current = type;
      setNoticeType(type);
      void loadList(type);
    },
    [loadList],
  );

  const checkin = useCallback(async (): Promise<void> => {
    if (checkingIn || checkedIn) {
      return;
    }
    setCheckingIn(true);
    const outcome = await invokeUserCheckin();
    if (!mountedRef.current) {
      return;
    }
    setCheckingIn(false);
    if (outcome.status === "unavailable") {
      markGap(USER_COMMAND.checkin);
      toast.error(outcome.message);
      return;
    }
    if (outcome.status === "outcome_unknown") {
      toast.warning(outcome.message);
      void refreshDaily();
      return;
    }
    if (outcome.status === "ok" && outcome.checkedIn) {
      setCheckedIn(true);
      toast.success(outcome.message);
      return;
    }
    toast.error(outcome.message);
  }, [checkedIn, checkingIn, markGap, refreshDaily]);

  const claimReward = useCallback(async (): Promise<void> => {
    if (rewarding || collected) {
      return;
    }
    setRewarding(true);
    const outcome = await invokeUserRewardLiveness();
    if (!mountedRef.current) {
      return;
    }
    setRewarding(false);
    if (outcome.status === "unavailable") {
      markGap(USER_COMMAND.rewardLiveness);
      toast.error(outcome.message);
      return;
    }
    if (outcome.status === "outcome_unknown") {
      toast.warning(outcome.message);
      void refreshDaily();
      return;
    }
    if (outcome.status === "ok") {
      setCollected(true);
      toast.success(outcome.message);
      return;
    }
    toast.error(outcome.message);
  }, [collected, markGap, refreshDaily, rewarding]);

  const markTypeRead = useCallback(async (): Promise<void> => {
    if (markingRead) {
      return;
    }
    setMarkingRead(true);
    const outcome = await invokeNoticeMakeRead({ type: typeRef.current });
    if (!mountedRef.current) {
      return;
    }
    setMarkingRead(false);
    if (outcome.status === "unavailable") {
      markGap(NOTICE_COMMAND.makeRead);
      toast.error(outcome.message);
      return;
    }
    if (outcome.status === "outcome_unknown") {
      toast.warning(outcome.message);
      void refreshCount();
      return;
    }
    if (outcome.status === "ok") {
      setItems((current) =>
        current.map((item) => ({ ...item, hasRead: true })),
      );
      toast.success(outcome.message);
      void refreshCount();
      return;
    }
    toast.error(outcome.message);
  }, [markGap, markingRead, refreshCount]);

  const markAllRead = useCallback(async (): Promise<void> => {
    if (markingRead) {
      return;
    }
    setMarkingRead(true);
    const outcome = await invokeNoticeReadAll();
    if (!mountedRef.current) {
      return;
    }
    setMarkingRead(false);
    if (outcome.status === "unavailable") {
      markGap(NOTICE_COMMAND.readAll);
      toast.error(outcome.message);
      return;
    }
    if (outcome.status === "outcome_unknown") {
      toast.warning(outcome.message);
      void refreshCount();
      return;
    }
    if (outcome.status === "ok") {
      setItems((current) =>
        current.map((item) => ({ ...item, hasRead: true })),
      );
      toast.success(outcome.message);
      void refreshCount();
      return;
    }
    toast.error(outcome.message);
  }, [markGap, markingRead, refreshCount]);

  useEffect(() => {
    handleEventRef.current = (event: NoticeListenEvent) => {
      if (event.event === "notice://refresh") {
        if (!acceptSession(event.payload.sessionGeneration)) {
          return;
        }
        void refreshCount();
        void loadList(typeRef.current);
      }
      // notice://broadcast 由壳层文本模态显示，活动页不再弹 toast。
    };
  }, [acceptSession, loadList, refreshCount]);

  useEffect(() => {
    mountedRef.current = true;
    let unlistens: UnlistenFn | undefined;
    let listenCancelled = false;

    void listenNoticeEvents((event) => {
      handleEventRef.current(event);
    })
      .then((fn) => {
        if (listenCancelled) {
          fn();
          return;
        }
        unlistens = fn;
      })
      .catch((error: unknown) => {
        if (error instanceof BridgeGapError) {
          markGap(error.command);
        }
      });

    void refreshCount();
    void refreshDaily();
    void refreshLiveness();
    void loadList(typeRef.current);

    const intervalId = window.setInterval(() => {
      void refreshLiveness();
    }, LIVENESS_POLL_MS);
    intervalRef.current = intervalId;

    return () => {
      mountedRef.current = false;
      listenCancelled = true;
      window.clearInterval(intervalId);
      intervalRef.current = null;
      unlistens?.();
    };
  }, [loadList, markGap, refreshCount, refreshDaily, refreshLiveness]);

  return {
    count,
    noticeType,
    items,
    liveness,
    checkedIn,
    collected,
    loadingCount,
    loadingList,
    loadingDaily,
    checkingIn,
    rewarding,
    markingRead,
    capabilities,
    selectType,
    checkin,
    claimReward,
    markTypeRead,
    markAllRead,
  };
}
