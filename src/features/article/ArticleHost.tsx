import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  ArrowBendUpLeftIcon,
  ArrowLeftIcon,
  ChatCircleIcon,
  EyeIcon,
  HeartIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";

import { sanitizeHttpUrl } from "../../lib/markdown";
import { setHeaderTitle } from "../../lib/headerTitle";
import { CommentComposer } from "./CommentComposer";
import { dispatchPreviewImage, dispatchUserCard } from "./events";
import { ArticleRichBody } from "./MarkdownBody";
import type {
  ArticleComment,
  ArticleDetail,
  ArticleListType,
  ArticleSummary,
  ArticleVoteDirection,
  CommentReplyTarget,
  CommentSubmit,
} from "./types";
import {
  ARTICLE_LIST_TYPE_LABEL,
  ARTICLE_LIST_TYPES,
} from "./types";
import { useArticles } from "./useArticles";
import "./article.css";

/**
 * 帖子宿主：列表 + 详情 + 评论。无必填 props。
 *
 * 命令缺失时界面可预览，评论不会伪装发出。
 *
 * 事件（只 `dispatchEvent`，不渲染 overlay）：
 *
 * 1. 图片点击 → `window` CustomEvent `"fishpi:preview-image"`
 *    `detail`：`{ src, alt? }`
 * 2. 用户名 / 头像点击 → `"fishpi:user-card"`
 *    `detail`：`{ userName }`
 */
export function ArticleHost() {
  const articles = useArticles();
  const showingDetail = articles.activeId != null;
  const bridgeMissing = !articles.loadingList && !articles.capabilities.list;
  const detailTitle = articles.detail?.title ?? null;

  // 对齐旧版：详情页标题用文章名，列表恢复「帖子」
  useEffect(() => {
    setHeaderTitle("article", showingDetail ? detailTitle : null);
    return () => setHeaderTitle("article", null);
  }, [showingDetail, detailTitle]);

  return (
    <div className="article" id="article">
      <h1 className="visually-hidden">帖子</h1>

      {bridgeMissing ? (
        <Alert className="article-alert">
          <WarningIcon />
          <AlertTitle>帖子 Bridge 尚未接入</AlertTitle>
          <AlertDescription>
            src-tauri 当前没有 article_list / article_detail / comment_post。界面可预览，评论不会伪装发出。
          </AlertDescription>
        </Alert>
      ) : null}

      {articles.error ? (
        <Alert variant="destructive" className="article-alert">
          <WarningIcon />
          <AlertTitle>帖子请求失败</AlertTitle>
          <AlertDescription>{articles.error}</AlertDescription>
        </Alert>
      ) : null}

      {articles.notice ? (
        <Alert className="article-alert">
          <AlertDescription>{articles.notice}</AlertDescription>
        </Alert>
      ) : null}

      {showingDetail ? (
        <ArticleDetailPane
          detail={articles.detail}
          loading={articles.loadingDetail}
          loadingMore={articles.loadingMoreComments}
          sending={articles.sending}
          pendingConfirm={articles.pendingConfirm}
          commentAvailable={articles.capabilities.comment}
          detailAvailable={articles.capabilities.detail}
          onBack={articles.closeArticle}
          onRetry={articles.retryDetail}
          onLoadEarlier={articles.loadEarlierComments}
          onLoadLater={articles.loadLaterComments}
          onSend={articles.sendComment}
          heatCount={articles.heatCount}
          heatLive={articles.heatLive}
          heatNote={articles.heatNote}
          commentLiveNote={articles.commentLiveNote}
          thankAvailable={articles.capabilities.thank}
          voteAvailable={articles.capabilities.vote}
          rewardAvailable={articles.capabilities.reward}
          thanking={articles.thanking}
          voting={articles.voting}
          rewarding={articles.rewarding}
          selfUserName={articles.selfUserName}
          commentAction={articles.commentAction}
          commentDeleteAvailable={articles.capabilities.commentDelete}
          commentThankAvailable={articles.capabilities.commentThank}
          commentVoteAvailable={articles.capabilities.commentVote}
          onDeleteComment={(commentId) => {
            void articles.deleteComment(commentId);
          }}
          onThankComment={(commentId) => {
            void articles.thankComment(commentId);
          }}
          onVoteComment={(commentId, direction) => {
            void articles.voteComment(commentId, direction);
          }}
          onThank={() => {
            void articles.thankArticle();
          }}
          onVote={(direction) => {
            void articles.voteArticle(direction);
          }}
          onReward={() => {
            void articles.rewardArticle();
          }}
        />
      ) : (
        <ArticleListPane
          listType={articles.listType}
          items={articles.items}
          loading={articles.loadingList}
          loadingMore={articles.loadingMore}
          hasMore={articles.hasMore}
          listAvailable={articles.capabilities.list}
          onChangeType={articles.changeType}
          onOpen={articles.openArticle}
          onLoadMore={articles.loadMore}
          onRetry={articles.retryList}
        />
      )}
    </div>
  );
}

type ArticleListPaneProps = {
  listType: ArticleListType;
  items: ArticleSummary[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  listAvailable: boolean;
  onChangeType: (type: ArticleListType) => void;
  onOpen: (id: string) => void;
  onLoadMore: () => void;
  onRetry: () => void;
};

function ArticleListPane({
  listType,
  items,
  loading,
  loadingMore,
  hasMore,
  listAvailable,
  onChangeType,
  onOpen,
  onLoadMore,
  onRetry,
}: ArticleListPaneProps) {
  return (
    <section className="article-pane" aria-label="帖子列表">
      <header className="article-head">
        <p className="article-kicker">帖子</p>
        <div className="article-tabs" role="tablist" aria-label="列表类型">
          {ARTICLE_LIST_TYPES.map((type) => {
            const active = type === listType;
            return (
              <button
                key={type}
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? "article-tab is-active" : "article-tab"}
                onClick={() => onChangeType(type)}
              >
                {ARTICLE_LIST_TYPE_LABEL[type]}
              </button>
            );
          })}
        </div>
      </header>

      <ScrollArea className="article-scroll">
        {loading ? (
          <div className="article-skel" aria-busy="true" aria-label="正在加载帖子">
            <Skeleton className="article-skel-row" />
            <Skeleton className="article-skel-row" />
            <Skeleton className="article-skel-row" />
          </div>
        ) : items.length === 0 ? (
          <div className="article-empty">
            <p>{listAvailable ? "暂无帖子" : "列表命令尚未接入，无法加载。"}</p>
            {listAvailable ? (
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                重试
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="article-list">
            {items.map((item) => (
              <li key={item.id}>
                <ArticleRow item={item} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        )}

        {hasMore && !loading ? (
          <div className="article-more">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loadingMore}
              onClick={onLoadMore}
            >
              {loadingMore ? <Spinner /> : null}
              {loadingMore ? "加载中" : "加载更多"}
            </Button>
          </div>
        ) : null}
      </ScrollArea>
    </section>
  );
}

type ArticleRowProps = {
  item: ArticleSummary;
  onOpen: (id: string) => void;
};

function ArticleRow({ item, onOpen }: ArticleRowProps) {
  const thumb = sanitizeHttpUrl(item.thumbnailUrl);
  return (
    <article className="article-row">
      <div className="article-row-main">
        <button
          type="button"
          className="article-row-open"
          onClick={() => onOpen(item.id)}
        >
          <span className="article-row-title">
            {item.sticky ? <Badge className="article-flag">置顶</Badge> : null}
            {item.perfect ? <Badge className="article-flag">优选</Badge> : null}
            {item.title}
          </span>
          {item.preview ? (
            <span className="article-row-preview">{item.preview}</span>
          ) : null}
        </button>
        <div className="article-row-meta">
          <AuthorChip
            userName={item.authorUserName}
            displayName={item.authorNickname}
            avatarUrl={item.avatarUrl}
          />
          <span>{item.time}</span>
          <span>{item.commentCount} 评</span>
          {item.viewCount > 0 ? (
            <span className="article-views">{item.viewCount} 阅</span>
          ) : null}
        </div>
      </div>
      {thumb ? (
        <button
          type="button"
          className="article-thumb"
          aria-label="预览封面"
          onClick={() => dispatchPreviewImage(thumb, item.title)}
        >
          <img src={thumb} alt="" />
        </button>
      ) : null}
    </article>
  );
}

type ArticleDetailPaneProps = {
  detail: ArticleDetail | null;
  loading: boolean;
  loadingMore: boolean;
  sending: boolean;
  pendingConfirm: boolean;
  commentAvailable: boolean;
  detailAvailable: boolean;
  onBack: () => void;
  onRetry: () => void;
  onLoadEarlier: () => void;
  onLoadLater: () => void;
  onSend: (draft: CommentSubmit) => Promise<boolean>;
  heatCount: number | null;
  heatLive: boolean;
  heatNote: string | null;
  commentLiveNote: string | null;
  thankAvailable: boolean;
  voteAvailable: boolean;
  rewardAvailable: boolean;
  thanking: boolean;
  voting: ArticleVoteDirection | null;
  rewarding: boolean;
  selfUserName: string | null;
  commentAction: { id: string; kind: "delete" | "thank" | "vote" } | null;
  commentDeleteAvailable: boolean;
  commentThankAvailable: boolean;
  commentVoteAvailable: boolean;
  onDeleteComment: (commentId: string) => void;
  onThankComment: (commentId: string) => void;
  onVoteComment: (commentId: string, direction: ArticleVoteDirection) => void;
  onThank: () => void;
  onVote: (direction: ArticleVoteDirection) => void;
  onReward: () => void;
};

function ArticleDetailPane({
  detail,
  loading,
  loadingMore,
  sending,
  pendingConfirm,
  commentAvailable,
  detailAvailable,
  onBack,
  onRetry,
  onLoadEarlier,
  onLoadLater,
  onSend,
  heatCount,
  heatLive,
  heatNote,
  commentLiveNote,
  thankAvailable,
  voteAvailable,
  rewardAvailable,
  thanking,
  voting,
  rewarding,
  selfUserName,
  commentAction,
  commentDeleteAvailable,
  commentThankAvailable,
  commentVoteAvailable,
  onDeleteComment,
  onThankComment,
  onVoteComment,
  onThank,
  onVote,
  onReward,
}: ArticleDetailPaneProps) {
  const [reply, setReply] = useState<CommentReplyTarget | null>(null);
  const [jumpMiss, setJumpMiss] = useState<string | null>(null);

  function jumpToComments(): void {
    document.getElementById("article-comments")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function jumpToComment(commentId: string): void {
    const node = document.getElementById(`comment-item-${commentId}`);
    if (node == null) {
      setJumpMiss("该评论不在当前已加载范围，可先点「加载更早评论」。");
      return;
    }
    setJumpMiss(null);
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.add("is-flash");
    window.setTimeout(() => {
      node.classList.remove("is-flash");
    }, 1200);
  }

  function startReply(comment: ArticleComment): void {
    setReply({
      id: comment.id,
      userName: comment.userName,
      content: comment.markdown || comment.html,
    });
    document.getElementById("article-composer")?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  return (
    <section className="article-pane" aria-label="帖子详情">
      <header className="article-head article-head-detail">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          aria-label="返回列表"
        >
          <ArrowLeftIcon />
          返回
        </Button>
      </header>

      <ScrollArea className="article-scroll">
        {loading && !detail ? (
          <div className="article-skel" aria-busy="true" aria-label="正在加载详情">
            <Skeleton className="article-skel-title" />
            <Skeleton className="article-skel-row" />
            <Skeleton className="article-skel-row" />
          </div>
        ) : !detail ? (
          <div className="article-empty">
            <p>{detailAvailable ? "详情加载失败" : "详情命令尚未接入，无法打开。"}</p>
            {detailAvailable ? (
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                重试
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="article-detail">
            <div className="article-detail-head">
              <h2 className="article-title">{detail.title}</h2>
              <div className="article-byline">
                <AuthorChip
                  userName={detail.authorUserName}
                  displayName={detail.authorNickname}
                  avatarUrl={detail.avatarUrl}
                  size="default"
                />
                <span>{detail.time}</span>
                {detail.viewCount > 0 ? (
                  <span className="article-views" title="浏览数">
                    <EyeIcon />
                    {detail.viewCount}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="article-jump-comments"
                  title="跳到评论区"
                  onClick={jumpToComments}
                >
                  <ChatCircleIcon />
                  {detail.commentCount} 评
                </button>
                {detail.tags ? (
                  <span className="article-tags">{detail.tags}</span>
                ) : null}
              </div>
              <ArticleActions
                detail={detail}
                heatCount={heatCount}
                heatLive={heatLive}
                heatNote={heatNote}
                thankAvailable={thankAvailable}
                voteAvailable={voteAvailable}
                thanking={thanking}
                voting={voting}
                onThank={onThank}
                onVote={onVote}
              />
            </div>
            <ArticleRichBody
              markdown={detail.markdown}
              html={detail.html}
              empty="这篇帖子没有正文。"
            />
            {detail.rewardPoint > 0 ? (
              <ArticleReward
                detail={detail}
                available={rewardAvailable}
                rewarding={rewarding}
                onReward={onReward}
              />
            ) : null}

            <h3 className="article-comments-title" id="article-comments">
              评论
              {detail.commentCount > 0 ? (
                <span> {detail.commentCount}</span>
              ) : null}
            </h3>
            <p className="article-comments-hint">
              从最后一页打开，最新评论在底部；可向上加载更早评论（对齐旧版从末页往前翻）。
            </p>
            {commentLiveNote ? (
              <p className="article-heat-note">{commentLiveNote}</p>
            ) : null}
            {jumpMiss ? (
              <p className="article-heat-note">{jumpMiss}</p>
            ) : null}

            {detail.commentHasEarlier ? (
              <div className="article-more">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={loadingMore}
                  onClick={onLoadEarlier}
                >
                  {loadingMore ? <Spinner /> : null}
                  {loadingMore ? "加载中" : "加载更早评论"}
                </Button>
              </div>
            ) : null}

            {detail.comments.length === 0 ? (
              <p className="article-empty-copy">还没有评论。</p>
            ) : (
              <ul className="article-comments">
                {detail.comments.map((comment) => (
                  <li key={comment.id} id={`comment-item-${comment.id}`}>
                    <CommentItem
                      comment={comment}
                      original={
                        comment.replyId
                          ? detail.comments.find((item) => item.id === comment.replyId) ??
                            null
                          : null
                      }
                      selfUserName={selfUserName}
                      action={commentAction}
                      deleteAvailable={commentDeleteAvailable}
                      thankAvailable={commentThankAvailable}
                      voteAvailable={commentVoteAvailable}
                      onDelete={onDeleteComment}
                      onThank={onThankComment}
                      onVote={onVoteComment}
                      onReply={() => startReply(comment)}
                      onJumpReply={
                        comment.replyId
                          ? () => jumpToComment(comment.replyId)
                          : undefined
                      }
                    />
                  </li>
                ))}
              </ul>
            )}

            {detail.commentHasMore ? (
              <div className="article-more">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={loadingMore}
                  onClick={onLoadLater}
                >
                  {loadingMore ? <Spinner /> : null}
                  {loadingMore ? "加载中" : "更多评论"}
                </Button>
              </div>
            ) : null}

            <CommentComposer
              disabled={!detail.commentable || sending}
              sending={sending}
              pendingConfirm={pendingConfirm}
              commentAvailable={commentAvailable}
              commentable={detail.commentable}
              reply={reply}
              onClearReply={() => setReply(null)}
              onSend={onSend}
            />
          </div>
        )}
      </ScrollArea>
    </section>
  );
}

function ArticleActions({
  detail,
  heatCount,
  heatLive,
  heatNote,
  thankAvailable,
  voteAvailable,
  thanking,
  voting,
  onThank,
  onVote,
}: {
  detail: ArticleDetail;
  heatCount: number | null;
  heatLive: boolean;
  heatNote: string | null;
  thankAvailable: boolean;
  voteAvailable: boolean;
  thanking: boolean;
  voting: ArticleVoteDirection | null;
  onThank: () => void;
  onVote: (direction: ArticleVoteDirection) => void;
}) {
  const thankTitle = !thankAvailable
    ? "感谢命令尚未接入"
    : detail.thanked
      ? "已感谢"
      : "确认赠送 20 积分给该帖作者以表感谢";
  const voteTitle = voteAvailable ? undefined : "点赞点踩命令尚未接入";

  function thank() {
    if (!thankAvailable || detail.thanked || thanking) {
      return;
    }
    if (!window.confirm("确认赠送 20 积分给该帖作者以表感谢？")) {
      return;
    }
    onThank();
  }

  return (
    <div className="article-actions">
      <p
        className="article-heat"
        title={heatLive ? "在看人数随频道加减" : "拉取到的在看人数"}
      >
        {heatCount == null ? (heatNote ?? "正在获取在看人数") : `${heatCount} 人在看`}
      </p>
      {heatCount != null && heatNote ? (
        <p className="article-heat-note">{heatNote}</p>
      ) : null}
      <Button
        type="button"
        variant={detail.thanked ? "secondary" : "outline"}
        size="sm"
        disabled={!thankAvailable || detail.thanked || thanking}
        title={thankTitle}
        onClick={thank}
      >
        {thanking ? <Spinner /> : null}
        {detail.thanked ? "已感谢" : "感谢"} {detail.thankCount}
      </Button>
      <Button
        type="button"
        variant={detail.vote === "up" ? "secondary" : "outline"}
        size="sm"
        aria-pressed={detail.vote === "up"}
        disabled={!voteAvailable || voting != null}
        title={voteTitle}
        onClick={() => onVote("up")}
      >
        {voting === "up" ? <Spinner /> : null}
        赞 {detail.goodCount}
      </Button>
      <Button
        type="button"
        variant={detail.vote === "down" ? "secondary" : "outline"}
        size="sm"
        aria-pressed={detail.vote === "down"}
        disabled={!voteAvailable || voting != null}
        title={voteTitle}
        onClick={() => onVote("down")}
      >
        {voting === "down" ? <Spinner /> : null}
        踩 {detail.badCount}
      </Button>
    </div>
  );
}

function ArticleReward({
  detail,
  available,
  rewarding,
  onReward,
}: {
  detail: ArticleDetail;
  available: boolean;
  rewarding: boolean;
  onReward: () => void;
}) {
  if (detail.rewarded) {
    return (
      <section className="article-reward">
        {detail.rewardContent ? (
          <ArticleRichBody
            markdown={detail.rewardContent}
            empty="已打赏，没有可显示的隐藏正文。"
          />
        ) : (
          <p className="article-empty-copy">已打赏，没有可显示的隐藏正文。</p>
        )}
        <p className="article-reward-count">{detail.rewardedCount} 打赏</p>
      </section>
    );
  }

  const title = available
    ? `确定要打赏 ${detail.rewardPoint} 积分给该帖子作者？`
    : "打赏命令尚未接入，隐藏正文不会放开";

  function reward() {
    if (!available || rewarding) {
      return;
    }
    if (!window.confirm(`确定要打赏 ${detail.rewardPoint} 积分给该帖子作者？`)) {
      return;
    }
    onReward();
  }

  return (
    <section className="article-reward">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!available || rewarding}
        title={title}
        onClick={reward}
      >
        {rewarding ? <Spinner /> : null}
        打赏 {detail.rewardPoint} 积分后可见
      </Button>
      <p className="article-reward-count">{detail.rewardedCount} 打赏</p>
      {!available ? (
        <p className="article-heat-note">打赏命令尚未接入，隐藏正文不会放开。</p>
      ) : null}
    </section>
  );
}

function CommentItem({
  comment,
  original,
  selfUserName,
  action,
  deleteAvailable,
  thankAvailable,
  voteAvailable,
  onDelete,
  onThank,
  onVote,
  onReply,
  onJumpReply,
}: {
  comment: ArticleComment;
  original: ArticleComment | null;
  selfUserName: string | null;
  action: { id: string; kind: "delete" | "thank" | "vote" } | null;
  deleteAvailable: boolean;
  thankAvailable: boolean;
  voteAvailable: boolean;
  onDelete: (commentId: string) => void;
  onThank: (commentId: string) => void;
  onVote: (commentId: string, direction: ArticleVoteDirection) => void;
  onReply: () => void;
  onJumpReply?: () => void;
}) {
  const self = selfUserName?.trim() ?? "";
  const author = comment.userName.trim();
  const isOwn = self.length > 0 && author === self;
  const busy = action?.id === comment.id;
  const busyKind = busy ? action?.kind : null;

  const deleteTitle = !deleteAvailable
    ? "删除评论命令尚未接入"
    : "删除这条评论";
  const thankTitle = !thankAvailable
    ? "感谢评论命令尚未接入"
    : comment.thanked
      ? "已感谢"
      : isOwn
        ? "不能感谢自己的评论"
        : `确认赠送 15 积分给 ${comment.userName} 以表感谢？`;
  const voteTitle = voteAvailable ? undefined : "评论赞踩命令尚未接入";
  const replyLabel = original
    ? original.displayName.trim() || original.userName.trim()
    : "";
  const replyAvatar = sanitizeHttpUrl(
    original?.avatarUrl || comment.replyAvatarUrl,
  );

  function remove() {
    if (!deleteAvailable || busy) {
      return;
    }
    if (!window.confirm("你确定要删除这条评论吗？")) {
      return;
    }
    onDelete(comment.id);
  }

  function thank() {
    if (!thankAvailable || comment.thanked || isOwn || busy) {
      return;
    }
    if (
      !window.confirm(
        `确认赠送 15 积分给 ${comment.userName} 以表感谢？`,
      )
    ) {
      return;
    }
    onThank(comment.id);
  }

  return (
    <article className="article-comment">
      <AuthorChip
        userName={comment.userName}
        displayName={comment.displayName}
        avatarUrl={comment.avatarUrl}
        showName={false}
      />
      <div className="article-comment-body">
        <p className="article-comment-meta">
          <button
            type="button"
            className="article-name"
            onClick={() => dispatchUserCard(comment.userName)}
          >
            {comment.displayName || comment.userName}
          </button>
          {comment.replyId ? (
            <button
              type="button"
              className="article-comment-reply"
              title="跳转回复"
              onClick={onJumpReply}
            >
              <ArrowBendUpLeftIcon />
              {replyAvatar ? (
                <Avatar size="sm" className="article-reply-avatar">
                  <AvatarImage src={replyAvatar} alt="" />
                  <AvatarFallback>
                    {replyLabel.slice(0, 1)}
                  </AvatarFallback>
                </Avatar>
              ) : null}
              <span>
                {original
                  ? `回复 ${replyLabel}`
                  : "回复"}
              </span>
            </button>
          ) : null}
          <span>{comment.time}</span>
        </p>
        <ArticleRichBody
          markdown={comment.markdown}
          html={comment.html}
          className="article-md article-md-comment"
          empty="（空评论）"
        />
        <div className="article-comment-footer">
          {isOwn ? (
            <button
              type="button"
              className="article-comment-action"
              title={deleteTitle}
              disabled={!deleteAvailable || busy}
              onClick={remove}
            >
              {busyKind === "delete" ? <Spinner /> : <TrashIcon />}
              <span>删除</span>
            </button>
          ) : null}
          <button
            type="button"
            className={
              comment.thanked
                ? "article-comment-action is-on"
                : "article-comment-action"
            }
            title={thankTitle}
            disabled={!thankAvailable || comment.thanked || isOwn || busy}
            onClick={thank}
          >
            {busyKind === "thank" ? <Spinner /> : <HeartIcon />}
            <span>{comment.thankCount}</span>
          </button>
          <button
            type="button"
            className={
              comment.vote === "up"
                ? "article-comment-action is-on"
                : "article-comment-action"
            }
            title={voteTitle}
            aria-pressed={comment.vote === "up"}
            disabled={!voteAvailable || busy}
            onClick={() => onVote(comment.id, "up")}
          >
            {busyKind === "vote" ? <Spinner /> : <ThumbsUpIcon />}
            <span>{comment.goodCount}</span>
          </button>
          <button
            type="button"
            className={
              comment.vote === "down"
                ? "article-comment-action is-on"
                : "article-comment-action"
            }
            title={voteTitle}
            aria-pressed={comment.vote === "down"}
            disabled={!voteAvailable || busy}
            onClick={() => onVote(comment.id, "down")}
          >
            {busyKind === "vote" ? <Spinner /> : <ThumbsDownIcon />}
            <span>{comment.badCount}</span>
          </button>
          <button
            type="button"
            className="article-comment-action"
            title="回复"
            onClick={onReply}
          >
            <ArrowBendUpLeftIcon />
            <span>回复</span>
          </button>
        </div>
      </div>
    </article>
  );
}

type AuthorChipProps = {
  userName: string;
  displayName: string;
  avatarUrl: string;
  size?: "default" | "sm";
  showName?: boolean;
};

function AuthorChip({
  userName,
  displayName,
  avatarUrl,
  size = "sm",
  showName = true,
}: AuthorChipProps) {
  const href = sanitizeHttpUrl(avatarUrl);
  const label = displayName.trim() || userName.trim() || "?";
  const letter = label.slice(0, 1);

  return (
    <button
      type="button"
      className="article-author"
      aria-label={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dispatchUserCard(userName || displayName);
      }}
    >
      <Avatar size={size} className="article-avatar">
        {href ? <AvatarImage src={href} alt="" /> : null}
        <AvatarFallback>{letter}</AvatarFallback>
      </Avatar>
      {showName ? <span className="article-author-name">{label}</span> : null}
    </button>
  );
}


