import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { mapComment } from "./api";
import {
  invokeArticleDetail,
  invokeArticleHeat,
  invokeArticleHeatClose,
  invokeArticleHeatWatch,
  invokeArticleList,
  invokeArticleReward,
  invokeArticleThank,
  invokeArticleVote,
  invokeCommentDelete,
  invokeCommentPost,
  invokeCommentThank,
  invokeCommentVote,
} from "./api";
import {
  isBridgeGapError,
  isOutcomeUnknown,
  toUserErrorMessage,
} from "./errors";
import { invokeAuthMe } from "../../lib/tauri";
import { acceptsChannel, applyVote, mergeById } from "./contentState";
import type {
  ArticleCapabilities,
  ArticleCommentPushEvent,
  ArticleDetail,
  ArticleHeatEvent,
  ArticleListType,
  ArticleSummary,
  ArticleVoteDirection,
  CommentSubmit,
} from "./types";
import { ARTICLE_COMMAND, ARTICLE_COMMENT_EVENT, ARTICLE_HEAT_EVENT } from "./types";

const ALL_READY: ArticleCapabilities = {
  list: true,
  detail: true,
  comment: true,
  commentDelete: true,
  commentThank: true,
  commentVote: true,
  thank: true,
  vote: true,
  reward: true,
  heat: true,
  heatWatch: true,
};

type CommentActionKind = "delete" | "thank" | "vote";

type WriteAck = {
  sessionGeneration: number;
  accepted: boolean;
  outcomeUnknown: boolean;
};

export function useArticles() {
  const [listType, setListType] = useState<ArticleListType>("reply");
  const [items, setItems] = useState<ArticleSummary[]>([]);
  const [listPage, setListPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ArticleDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingMoreComments, setLoadingMoreComments] = useState(false);

  const [sending, setSending] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [thanking, setThanking] = useState(false);
  const [voting, setVoting] = useState<ArticleVoteDirection | null>(null);
  const [rewarding, setRewarding] = useState(false);
  const [commentAction, setCommentAction] = useState<{
    id: string;
    kind: CommentActionKind;
  } | null>(null);
  const [selfUserName, setSelfUserName] = useState<string | null>(null);
  const [heatCount, setHeatCount] = useState<number | null>(null);
  const [heatLive, setHeatLive] = useState(false);
  const [watchEpoch, setWatchEpoch] = useState(0);
  const [heatNote, setHeatNote] = useState<string | null>(null);
  const [commentLiveNote, setCommentLiveNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [capabilities, setCapabilities] =
    useState<ArticleCapabilities>(ALL_READY);

  const listSeq = useRef(0);
  const detailSeq = useRef(0);
  const navigationSeq = useRef(0);
  const sessionGeneration = useRef(0);
  const mounted = useRef(true);
  const sendingLock = useRef(false);
  const thankLock = useRef(false);
  const voteLock = useRef(false);
  const rewardLock = useRef(false);
  const commentActionLock = useRef(false);

  const acceptSession = useCallback((generation: number): boolean => {
    if (generation <= 0) {
      return false;
    }
    if (sessionGeneration.current === 0) {
      sessionGeneration.current = generation;
    }
    return generation === sessionGeneration.current;
  }, []);

  const markGap = useCallback((command: string): void => {
    setCapabilities((prev) => {
      if (command === ARTICLE_COMMAND.list && prev.list) {
        return { ...prev, list: false };
      }
      if (command === ARTICLE_COMMAND.detail && prev.detail) {
        return { ...prev, detail: false };
      }
      if (command === ARTICLE_COMMAND.comment && prev.comment) {
        return { ...prev, comment: false };
      }
      if (command === ARTICLE_COMMAND.commentDelete && prev.commentDelete) {
        return { ...prev, commentDelete: false };
      }
      if (command === ARTICLE_COMMAND.commentThank && prev.commentThank) {
        return { ...prev, commentThank: false };
      }
      if (command === ARTICLE_COMMAND.commentVote && prev.commentVote) {
        return { ...prev, commentVote: false };
      }
      if (command === ARTICLE_COMMAND.thank && prev.thank) {
        return { ...prev, thank: false };
      }
      if (command === ARTICLE_COMMAND.vote && prev.vote) {
        return { ...prev, vote: false };
      }
      if (command === ARTICLE_COMMAND.reward && prev.reward) {
        return { ...prev, reward: false };
      }
      if (command === ARTICLE_COMMAND.heat && prev.heat) {
        return { ...prev, heat: false };
      }
      if (command === ARTICLE_COMMAND.heatWatch && prev.heatWatch) {
        return { ...prev, heatWatch: false };
      }
      return prev;
    });
  }, []);

  const loadList = useCallback(
    async (type: ArticleListType, page: number, append: boolean) => {
      const seq = ++listSeq.current;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoadingList(true);
        setError(null);
        setItems([]);
      }
      try {
        const result = await invokeArticleList({ type, page });
        if (!mounted.current || seq !== listSeq.current ||
          !acceptSession(result.sessionGeneration)) {
          return;
        }
        setListPage(page);
        setHasMore(result.hasMore);
        setItems((prev) =>
          append ? mergeById(prev, result.items) : result.items,
        );
      } catch (err) {
        if (!mounted.current || seq !== listSeq.current) {
          return;
        }
        if (isBridgeGapError(err)) {
          markGap(err.command);
          if (!append) {
            setItems([]);
          }
          return;
        }
        setError(toUserErrorMessage(err));
      } finally {
        if (mounted.current && seq === listSeq.current) {
          setLoadingList(false);
          setLoadingMore(false);
        }
      }
    },
    [acceptSession, markGap],
  );

  const loadDetail = useCallback(
    async (id: string, page: number | undefined, append: boolean) => {
      const seq = ++detailSeq.current;
      if (append) {
        setLoadingMoreComments(true);
      } else {
        setLoadingDetail(true);
        setError(null);
      }
      try {
        const result = await invokeArticleDetail(
          page == null ? { id } : { id, page },
        );
        if (!mounted.current || seq !== detailSeq.current ||
          !acceptSession(result.sessionGeneration)) {
          return;
        }
        setPendingConfirm(false);
        setDetail((prev) => {
          if (!append || prev == null || prev.id !== result.id) {
            return {
              ...result,
              commentLatestPage: result.commentLatestPage || result.commentPage,
            };
          }
          const goingEarlier = page != null && page < prev.commentPage;
          if (goingEarlier) {
            return {
              ...result,
              comments: mergeById(result.comments, prev.comments),
              commentCount: Math.max(result.commentCount, prev.commentCount),
              commentPage: result.commentPage,
              commentLatestPage: prev.commentLatestPage,
              commentHasEarlier: result.commentHasEarlier,
              commentHasMore: prev.commentHasMore,
            };
          }
          return {
            ...result,
            comments: mergeById(prev.comments, result.comments),
            commentCount: Math.max(result.commentCount, prev.commentCount),
            commentPage: prev.commentPage,
            commentLatestPage: result.commentPage,
            commentHasEarlier: prev.commentHasEarlier,
            commentHasMore: result.commentHasMore,
          };
        });
      } catch (err) {
        if (!mounted.current || seq !== detailSeq.current) {
          return;
        }
        if (isBridgeGapError(err)) {
          markGap(err.command);
          return;
        }
        setError(toUserErrorMessage(err));
      } finally {
        if (mounted.current && seq === detailSeq.current) {
          setLoadingDetail(false);
          setLoadingMoreComments(false);
        }
      }
    },
    [acceptSession, markGap],
  );

  useEffect(() => {
    mounted.current = true;
    void loadList("reply", 1, false);
    void (async () => {
      try {
        const me = await invokeAuthMe();
        if (mounted.current && acceptSession(me.sessionGeneration)) {
          setSelfUserName(me.user?.userName ?? null);
        }
      } catch {
        // 读不到当前用户时隐藏删除，感谢仍按服务端裁决。
      }
    })();
    return () => {
      mounted.current = false;
      listSeq.current += 1;
      detailSeq.current += 1;
      navigationSeq.current += 1;
    };
  }, [acceptSession, loadList]);

  const changeType = useCallback(
    (type: ArticleListType) => {
      navigationSeq.current += 1;
      detailSeq.current += 1;
      setListType(type);
      setActiveId(null);
      setDetail(null);
      void loadList(type, 1, false);
    },
    [loadList],
  );

  const loadMore = useCallback(() => {
    if (loadingList || loadingMore || !hasMore) {
      return;
    }
    void loadList(listType, listPage + 1, true);
  }, [hasMore, listPage, listType, loadList, loadingList, loadingMore]);

  const openArticle = useCallback(
    (id: string) => {
      navigationSeq.current += 1;
      setActiveId(id);
      setDetail(null);
      setNotice(null);
      void loadDetail(id, undefined, false);
    },
    [loadDetail],
  );

  const closeArticle = useCallback(() => {
    navigationSeq.current += 1;
    detailSeq.current += 1;
    setActiveId(null);
    setDetail(null);
    setPendingConfirm(false);
    setNotice(null);
    setLoadingDetail(false);
    setLoadingMoreComments(false);
    setError(null);
  }, []);

  const loadEarlierComments = useCallback(() => {
    if (!detail || loadingDetail || loadingMoreComments) {
      return;
    }
    if (detail.commentHasEarlier && detail.commentPage > 1) {
      void loadDetail(detail.id, detail.commentPage - 1, true);
    }
  }, [detail, loadDetail, loadingDetail, loadingMoreComments]);

  const loadLaterComments = useCallback(() => {
    if (!detail || loadingDetail || loadingMoreComments || !detail.commentHasMore) {
      return;
    }
    void loadDetail(detail.id, detail.commentLatestPage + 1, true);
  }, [detail, loadDetail, loadingDetail, loadingMoreComments]);

  const loadMoreComments = useCallback(() => {
    if (detail?.commentHasEarlier && detail.commentPage > 1) {
      loadEarlierComments();
      return;
    }
    loadLaterComments();
  }, [detail, loadEarlierComments, loadLaterComments]);

  const retryList = useCallback(() => {
    void loadList(listType, 1, false);
  }, [listType, loadList]);

  const retryDetail = useCallback(() => {
    if (!activeId) {
      return;
    }
    void loadDetail(activeId, undefined, false);
  }, [activeId, loadDetail]);

  const sendComment = useCallback(
    async (draft: CommentSubmit): Promise<boolean> => {
      const id = activeId;
      const text = draft.content.trim();
      if (!id || !text || sendingLock.current || pendingConfirm || !detail?.commentable) {
        return false;
      }
      if (!capabilities.comment) {
        setError("发表评论尚未接入 Bridge，请求未发出。");
        return false;
      }
      sendingLock.current = true;
      setSending(true);
      setError(null);
      setNotice(null);
      const navigation = navigationSeq.current;
      try {
        const result = await invokeCommentPost({
          articleId: id,
          commentContent: text,
          replyId: draft.replyId?.trim() || undefined,
          anonymous: draft.anonymous,
          visible: draft.visible,
        });
        if (!mounted.current || navigation !== navigationSeq.current ||
          !acceptSession(result.sessionGeneration)) {
          return false;
        }
        if (result.outcomeUnknown) {
          setPendingConfirm(true);
          setNotice(
            "结果待确认。评论请求已发出，但未能确认是否落成。请稍后刷新详情，请勿重复提交。",
          );
          return false;
        }
        if (!result.accepted) {
          setError("评论未被接受，请稍后重试，不要连续点击。");
          return false;
        }
        setPendingConfirm(false);
        void loadDetail(id, undefined, false);
        return true;
      } catch (err) {
        if (!mounted.current || navigation !== navigationSeq.current) {
          return false;
        }
        if (isBridgeGapError(err)) {
          markGap(err.command);
          setError(err.message);
          return false;
        }
        if (isOutcomeUnknown(err)) {
          setPendingConfirm(true);
          setNotice(
            "结果待确认。评论请求已发出，但未能确认是否落成。请稍后刷新详情，请勿重复提交。",
          );
          return false;
        }
        setError(toUserErrorMessage(err));
        return false;
      } finally {
        sendingLock.current = false;
        if (mounted.current) {
          setSending(false);
        }
      }
    },
    [acceptSession, activeId, capabilities.comment, detail?.commentable, loadDetail, markGap, pendingConfirm],
  );

  const runCommentAction = useCallback(
    async (
      commentId: string,
      kind: "delete" | "thank",
      capability: boolean,
      gapMessage: string,
      unknownMessage: string,
      apply: () => void,
      invoke: (id: string) => Promise<WriteAck>,
    ): Promise<void> => {
      if (!commentId || commentActionLock.current) {
        return;
      }
      if (!capability) {
        setError(gapMessage);
        return;
      }
      commentActionLock.current = true;
      setCommentAction({ id: commentId, kind });
      setError(null);
      setNotice(null);
      const navigation = navigationSeq.current;
      try {
        const result = await invoke(commentId);
        if (!mounted.current || navigation !== navigationSeq.current ||
          !acceptSession(result.sessionGeneration)) {
          return;
        }
        if (result.outcomeUnknown || !result.accepted) {
          setNotice(unknownMessage);
          return;
        }
        apply();
      } catch (err) {
        if (!mounted.current || navigation !== navigationSeq.current) {
          return;
        }
        if (isBridgeGapError(err)) {
          markGap(err.command);
          setError(err.message);
          return;
        }
        if (isOutcomeUnknown(err)) {
          setNotice(unknownMessage);
          return;
        }
        setError(toUserErrorMessage(err));
      } finally {
        commentActionLock.current = false;
        if (mounted.current) {
          setCommentAction(null);
        }
      }
    },
    [acceptSession, markGap],
  );

  const deleteComment = useCallback(
    async (commentId: string): Promise<void> => {
      await runCommentAction(
        commentId,
        "delete",
        capabilities.commentDelete,
        "删除评论命令尚未接入，请求未发出。",
        "结果待确认。评论可能仍在，请刷新后确认，不要重复删除。",
        () => {
          setDetail((prev) => {
            if (!prev) {
              return prev;
            }
            const comments = prev.comments.filter((item) => item.id !== commentId);
            if (comments.length === prev.comments.length) {
              return prev;
            }
            return {
              ...prev,
              comments,
              commentCount: Math.max(0, prev.commentCount - 1),
            };
          });
        },
        (id) => invokeCommentDelete({ id }),
      );
    },
    [capabilities.commentDelete, runCommentAction],
  );

  const thankComment = useCallback(
    async (commentId: string): Promise<void> => {
      await runCommentAction(
        commentId,
        "thank",
        capabilities.commentThank,
        "感谢评论命令尚未接入，请求未发出。",
        "结果待确认。尚未记为已感谢，请勿重复提交。",
        () => {
          setDetail((prev) => {
            if (!prev) {
              return prev;
            }
            let changed = false;
            const comments = prev.comments.map((item) => {
              if (item.id !== commentId || item.thanked) {
                return item;
              }
              changed = true;
              return {
                ...item,
                thanked: true,
                thankCount: item.thankCount + 1,
              };
            });
            return changed ? { ...prev, comments } : prev;
          });
        },
        (id) => invokeCommentThank({ id }),
      );
    },
    [capabilities.commentThank, runCommentAction],
  );

  const voteComment = useCallback(
    async (
      commentId: string,
      direction: ArticleVoteDirection,
    ): Promise<void> => {
      if (!commentId || commentActionLock.current) {
        return;
      }
      if (!capabilities.commentVote) {
        setError("评论赞踩命令尚未接入，请求未发出。");
        return;
      }
      commentActionLock.current = true;
      setCommentAction({ id: commentId, kind: "vote" });
      setError(null);
      setNotice(null);
      const navigation = navigationSeq.current;
      try {
        const result = await invokeCommentVote({ id: commentId, direction });
        if (!mounted.current || navigation !== navigationSeq.current ||
          !acceptSession(result.sessionGeneration)) {
          return;
        }
        if (result.outcomeUnknown || !result.accepted) {
          setNotice("结果待确认。赞踩状态没有改，请勿连续点击。");
          return;
        }
        setDetail((prev) => {
          if (!prev) {
            return prev;
          }
          let changed = false;
          const comments = prev.comments.map((item) => {
            if (item.id !== commentId) {
              return item;
            }
            changed = true;
            return applyVote(item, direction);
          });
          return changed ? { ...prev, comments } : prev;
        });
      } catch (err) {
        if (!mounted.current || navigation !== navigationSeq.current) {
          return;
        }
        if (isBridgeGapError(err)) {
          markGap(err.command);
          setError(err.message);
          return;
        }
        if (isOutcomeUnknown(err)) {
          setNotice("结果待确认。赞踩状态没有改，请勿连续点击。");
          return;
        }
        setError(toUserErrorMessage(err));
      } finally {
        commentActionLock.current = false;
        if (mounted.current) {
          setCommentAction(null);
        }
      }
    },
    [acceptSession, capabilities.commentVote, markGap],
  );

  const heatArticleId = detail?.id ?? null;
  const heatArticleType = detail?.articleType ?? null;

  useEffect(() => {
    if (!heatArticleId || heatArticleType == null) {
      setHeatCount(null);
      setHeatLive(false);
      setHeatNote(null);
      setCommentLiveNote(null);
      return;
    }
    const id = heatArticleId;
    const articleType = heatArticleType;
    const alive = {
      cancelled: false,
      generation: 0,
      unlistenHeat: undefined as UnlistenFn | undefined,
      unlistenComment: undefined as UnlistenFn | undefined,
      unlistenReconnect: undefined as UnlistenFn | undefined,
    };
    const bucket = { ready: false, extra: 0 };
    const queued: Array<ArticleHeatEvent | ArticleCommentPushEvent> = [];
    function receive(payload: ArticleHeatEvent | ArticleCommentPushEvent): void {
      if (alive.cancelled || payload.articleId !== id) {
        return;
      }
      if (alive.generation === 0) {
        queued.push(payload);
        return;
      }
      if (!acceptsChannel(payload, id, sessionGeneration.current, alive.generation)) {
        return;
      }
      if ("delta" in payload) {
        if (payload.delta !== 1 && payload.delta !== -1) {
          return;
        }
        if (!bucket.ready) {
          bucket.extra += payload.delta;
          return;
        }
        setHeatCount((prev) => prev == null ? null : Math.max(0, prev + payload.delta));
        return;
      }
      const comment = mapComment(payload.comment);
      if (!comment) {
        return;
      }
      setDetail((prev) => {
        if (!prev || prev.id !== id || prev.comments.some((item) => item.id === comment.id)) {
          return prev;
        }
        return {
          ...prev,
          comments: [...prev.comments, comment],
          commentCount: prev.commentCount + 1,
        };
      });
    }
    setHeatCount(null);
    setHeatLive(false);
    setHeatNote(null);
    setCommentLiveNote(null);

    void (async () => {
      try {
        alive.unlistenReconnect = await listen<{ sessionGeneration: number }>(
          "desktop://reconnect",
          ({ payload }) => {
            if (!alive.cancelled && sessionGeneration.current > 0 &&
              payload?.sessionGeneration === sessionGeneration.current) {
              setWatchEpoch((value) => value + 1);
            }
          },
        );
      } catch {
        // Reconnect observation unavailable; manual detail reopen still works.
      }
      try {
        alive.unlistenHeat = await listen<ArticleHeatEvent>(ARTICLE_HEAT_EVENT, (event) => {
          const payload = event.payload;
          if (payload) receive(payload);
        });
      } catch {
        // 监听挂不上时仍尝试拉 HTTP 人数。
      }
      try {
        alive.unlistenComment = await listen<ArticleCommentPushEvent>(
          ARTICLE_COMMENT_EVENT,
          (event) => {
            const payload = event.payload;
            if (payload) receive(payload);
          },
        );
      } catch {
        setCommentLiveNote("实时评论监听没有挂上，新评论不会自动出现。");
      }
      if (alive.cancelled) {
        alive.unlistenHeat?.();
        alive.unlistenComment?.();
        alive.unlistenReconnect?.();
        return;
      }
      try {
        const result = await invokeArticleHeat({ id });
        if (alive.cancelled || !acceptSession(result.sessionGeneration)) {
          return;
        }
        const extra = bucket.extra;
        bucket.extra = 0;
        bucket.ready = true;
        setHeatCount(Math.max(0, result.count + extra));
      } catch (err) {
        if (alive.cancelled) {
          return;
        }
        bucket.ready = false;
        setHeatCount(null);
        if (isBridgeGapError(err)) {
          markGap(err.command);
          setHeatNote("在看命令尚未接入，没有本地伪造人数。");
        } else {
          setHeatNote("在看人数没有拉取到。");
        }
      }
      try {
        const watch = await invokeArticleHeatWatch({ id, articleType });
        if (alive.cancelled || !acceptSession(watch.sessionGeneration)) {
          void invokeArticleHeatClose({ watchGeneration: watch.watchGeneration }).catch(
            () => undefined,
          );
          return;
        }
        alive.generation = watch.watchGeneration;
        queued.splice(0).forEach(receive);
        setHeatLive(true);
      } catch (err) {
        if (alive.cancelled) {
          return;
        }
        setHeatLive(false);
        if (isBridgeGapError(err)) {
          markGap(err.command);
          setHeatNote("在看监听命令尚未接入，只显示拉取到的人数。");
          setCommentLiveNote("文章频道未接入，新评论不会实时出现。");
        } else {
          setHeatNote("实时在看没有连上，显示的是拉取到的人数。");
          setCommentLiveNote("实时评论没有连上，新评论不会自动出现。");
        }
      }
    })();

    return () => {
      alive.cancelled = true;
      alive.unlistenHeat?.();
      alive.unlistenComment?.();
      alive.unlistenReconnect?.();
      if (alive.generation > 0) {
        void invokeArticleHeatClose({ watchGeneration: alive.generation }).catch(
          () => undefined,
        );
      }
    };
  }, [acceptSession, heatArticleId, heatArticleType, markGap, watchEpoch]);

  const thankArticle = useCallback(async () => {
    const id = activeId;
    if (!id || !detail || detail.id !== id || detail.thanked || thankLock.current ||
      detail.authorUserName === selfUserName) {
      return;
    }
    if (!capabilities.thank) {
      setError("感谢命令尚未接入，请求未发出。");
      return;
    }
    thankLock.current = true;
    setThanking(true);
    setError(null);
    setNotice(null);
    const navigation = navigationSeq.current;
    try {
      const result = await invokeArticleThank({ id });
      if (!mounted.current || navigation !== navigationSeq.current ||
        !acceptSession(result.sessionGeneration)) {
        return;
      }
      if (result.outcomeUnknown || !result.accepted) {
        setNotice("结果待确认。尚未记为已感谢，请勿重复提交。");
        return;
      }
      setDetail((prev) => {
        if (!prev || prev.id !== id || prev.thanked) {
          return prev;
        }
        return { ...prev, thanked: true, thankCount: prev.thankCount + 1 };
      });
    } catch (err) {
      if (!mounted.current || navigation !== navigationSeq.current) {
        return;
      }
      if (isBridgeGapError(err)) {
        markGap(err.command);
        setError(err.message);
        return;
      }
      if (isOutcomeUnknown(err)) {
        setNotice("结果待确认。尚未记为已感谢，请勿重复提交。");
        return;
      }
      setError(toUserErrorMessage(err));
    } finally {
      thankLock.current = false;
      if (mounted.current) {
        setThanking(false);
      }
    }
  }, [acceptSession, activeId, capabilities.thank, detail, markGap, selfUserName]);

  const voteArticle = useCallback(
    async (direction: ArticleVoteDirection) => {
      const id = activeId;
      if (!id || !detail || detail.id !== id || voteLock.current) {
        return;
      }
      if (!capabilities.vote) {
        setError("点赞点踩命令尚未接入，请求未发出。");
        return;
      }
      voteLock.current = true;
      setVoting(direction);
      setError(null);
      setNotice(null);
      const before = detail;
      const navigation = navigationSeq.current;
      try {
        const result = await invokeArticleVote({ id, direction });
        if (!mounted.current || navigation !== navigationSeq.current ||
          !acceptSession(result.sessionGeneration)) {
          return;
        }
        if (result.outcomeUnknown || !result.accepted) {
          setNotice("结果待确认。赞踩状态没有改，请勿连续点击。");
          return;
        }
        setDetail((prev) => {
          if (!prev || prev.id !== id) {
            return prev;
          }
          return applyVote(
            {
              ...prev,
              vote: before.vote,
              goodCount: before.goodCount,
              badCount: before.badCount,
            },
            direction,
            result.active,
          );
        });
      } catch (err) {
        if (!mounted.current || navigation !== navigationSeq.current) {
          return;
        }
        if (isBridgeGapError(err)) {
          markGap(err.command);
          setError(err.message);
          return;
        }
        if (isOutcomeUnknown(err)) {
          setNotice("结果待确认。赞踩状态没有改，请勿连续点击。");
          return;
        }
        setError(toUserErrorMessage(err));
      } finally {
        voteLock.current = false;
        if (mounted.current) {
          setVoting(null);
        }
      }
    },
    [acceptSession, activeId, capabilities.vote, detail, markGap],
  );

  const rewardArticle = useCallback(async () => {
    const id = activeId;
    if (!id || !detail || detail.id !== id || detail.rewarded || rewardLock.current) {
      return;
    }
    if (!capabilities.reward) {
      setError("打赏命令尚未接入，请求未发出。");
      return;
    }
    rewardLock.current = true;
    setRewarding(true);
    setError(null);
    setNotice(null);
    const navigation = navigationSeq.current;
    try {
      const result = await invokeArticleReward({ id });
      if (!mounted.current || navigation !== navigationSeq.current ||
        !acceptSession(result.sessionGeneration)) {
        return;
      }
      if (result.outcomeUnknown || !result.accepted || !result.rewarded) {
        setNotice("结果待确认。隐藏正文未放开，请勿重复打赏。");
        return;
      }
      setDetail((prev) => {
        if (!prev || prev.id !== id) {
          return prev;
        }
        return {
          ...prev,
          rewarded: true,
          rewardContent: result.rewardContent,
          rewardedCount: result.rewardedCount,
        };
      });
    } catch (err) {
      if (!mounted.current || navigation !== navigationSeq.current) {
        return;
      }
      if (isBridgeGapError(err)) {
        markGap(err.command);
        setError(err.message);
        return;
      }
      if (isOutcomeUnknown(err)) {
        setNotice("结果待确认。隐藏正文未放开，请勿重复打赏。");
        return;
      }
      setError(toUserErrorMessage(err));
    } finally {
      rewardLock.current = false;
      if (mounted.current) {
        setRewarding(false);
      }
    }
  }, [acceptSession, activeId, capabilities.reward, detail, markGap]);

  return {
    listType,
    items,
    hasMore,
    loadingList,
    loadingMore,
    activeId,
    detail,
    loadingDetail,
    loadingMoreComments,
    sending,
    pendingConfirm,
    thanking,
    voting,
    rewarding,
    commentAction,
    selfUserName,
    heatCount,
    heatLive,
    heatNote,
    commentLiveNote,
    error,
    notice,
    capabilities,
    changeType,
    loadMore,
    openArticle,
    closeArticle,
    loadEarlierComments,
    loadLaterComments,
    loadMoreComments,
    retryList,
    retryDetail,
    sendComment,
    deleteComment,
    thankComment,
    voteComment,
    thankArticle,
    voteArticle,
    rewardArticle,
  };
}
