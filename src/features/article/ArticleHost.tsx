import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { sanitizeHttpUrl } from "../../lib/markdown";
import { setHeaderTitle } from "../../lib/headerTitle";
import { CommentComposer } from "./CommentComposer";
import { dispatchUserCard } from "./events";
import { ArticleRichBody } from "./MarkdownBody";
import type {
  ArticleComment,
  ArticleDetail,
  ArticleSummary,
  ArticleVoteDirection,
  CommentReplyTarget,
  CommentSubmit,
} from "./types";
import { useArticles } from "./useArticles";
import "./article.css";

export function ArticleHost() {
  const articles = useArticles();
  const showingDetail = articles.activeId != null;
  const detailTitle = articles.detail?.title ?? null;

  useEffect(() => {
    setHeaderTitle("article", showingDetail ? detailTitle : null);
    return () => setHeaderTitle("article", null);
  }, [showingDetail, detailTitle]);

  useEffect(() => {
    if (articles.error) toast.error(articles.error);
  }, [articles.error]);

  useEffect(() => {
    if (articles.notice) toast.error(articles.notice);
  }, [articles.notice]);

  useEffect(() => {
    if (!articles.loadingList && !articles.capabilities.list) {
      toast.error("帖子列表加载失败");
    }
  }, [articles.capabilities.list, articles.loadingList]);

  return (
    <div
      className={showingDetail ? "article is-detail" : "article is-list"}
      id="article"
    >
      {showingDetail ? (
        <ArticleDetailPane
          key={articles.activeId}
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
          items={articles.items}
          loading={articles.loadingList}
          loadingMore={articles.loadingMore}
          hasMore={articles.hasMore}
          onOpen={articles.openArticle}
          onLoadMore={articles.loadMore}
          onRetry={articles.retryList}
        />
      )}
    </div>
  );
}

function ArticleListPane({
  items,
  loading,
  loadingMore,
  hasMore,
  onOpen,
  onLoadMore,
  onRetry,
}: {
  items: ArticleSummary[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onOpen: (id: string) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  return (
    <section className="content article-scroll" aria-label="帖子列表">
      {loading ? (
        <div className="article-status" role="status">
          <i className="fa fa-spinner fa-spin" aria-label="正在加载" />
        </div>
      ) : items.length === 0 ? (
        <div className="article-status">
          <Button variant="ghost" type="button" title="重试" aria-label="重试" onClick={onRetry}>
            <i className="fa fa-refresh" aria-hidden="true" />
          </Button>
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
      {!loading && items.length > 0 ? (
        <section className="more">
          <Button variant="ghost"
            type="button"
            title="加载更多"
            aria-label="加载更多"
            disabled={!hasMore || loadingMore}
            onClick={onLoadMore}
          >
            <i
              className={loadingMore ? "fa fa-spinner fa-spin" : "fa fa-caret-down"}
              aria-hidden="true"
            />
          </Button>
        </section>
      ) : null}
    </section>
  );
}

function ArticleRow({
  item,
  onOpen,
}: {
  item: ArticleSummary;
  onOpen: (id: string) => void;
}) {
  return (
    <article className="item article-row">
      <UserAvatar
        className="msg-avatar"
        userName={item.authorUserName}
        displayName={item.authorNickname}
        avatarUrl={item.avatarUrl}
        size={25}
      />
      <Button variant="ghost"
        type="button"
        className="content article-row-open"
        onClick={() => onOpen(item.id)}
      >
        {item.title}
      </Button>
      <span className="views">{item.viewCountDisplay || item.viewCount}</span>
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

  useEffect(() => {
    if (commentLiveNote) toast.error(commentLiveNote);
  }, [commentLiveNote]);

  function jumpToComposer(): void {
    document.getElementById("article-composer")?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }

  function jumpToComment(commentId: string): void {
    const node = document.getElementById(`comment-item-${commentId}`);
    if (node == null) {
      toast.error("该评论不在当前加载范围");
      return;
    }
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.add("is-flash");
    window.setTimeout(() => node.classList.remove("is-flash"), 1200);
  }

  function startReply(comment: ArticleComment): void {
    setReply({
      id: comment.id,
      userName: comment.userName,
      content: comment.markdown || comment.html,
    });
    jumpToComposer();
  }

  if (loading && !detail) {
    return (
      <div className="article-status" role="status">
        <i className="fa fa-spinner fa-spin" aria-label="正在加载" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="article-status">
        {detailAvailable ? (
          <Button variant="ghost" type="button" title="重试" aria-label="重试" onClick={onRetry}>
            <i className="fa fa-refresh" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    );
  }

  const self = selfUserName?.trim() ?? "";
  const isOwn = self.length > 0 && self === detail.authorUserName;
  const heat = heatCount ?? 0;
  const thankIcon = detail.thanked ? "fa-solid fa-heart" : "fa-regular fa-heart";
  const thankTitle = detail.thanked
    ? "已感谢"
    : isOwn
      ? "不能感谢自己的帖子"
      : "确认赠送 20 积分给该帖作者以表感谢？";

  return (
    <>
      <header>
        <div
          className="view-list"
          title={heatNote ?? `有 ${heat} 个人和你一起在看`}
          aria-label={`${heat} 个人和你一起在看`}
        >
          <div
            className={heatLive ? "view-item is-live" : "view-item"}
            style={{ width: `${Math.max(0, heat) * 3}px` }}
          />
        </div>
        <Button variant="ghost"
          type="button"
          title="返回"
          className="back-btn"
          aria-label="返回列表"
          onClick={onBack}
        >
          <i className="fa-solid fa-caret-left" aria-hidden="true" />
        </Button>
        <h1 className="article-title">{detail.title}</h1>
        <p className="article-meta">
          <UserAvatar
            className="article-author-avatar"
            userName={detail.authorUserName}
            displayName={detail.authorNickname}
            avatarUrl={detail.avatarUrl}
            size={18}
          />
          <span>{detail.authorNickname || detail.authorUserName}</span>
          <span className="info-item">|</span>
          <span className="info-item" title="发布时间">
            <i className="fa-solid fa-eye" aria-hidden="true" /> {detail.time}
          </span>
          <span className="info-item" title="感谢">
            <LegacyConfirm
              title={thankTitle}
              label={`感谢 ${detail.thankCount}`}
              disabled={isOwn || !thankAvailable || detail.thanked || thanking}
              onConfirm={onThank}
            >
              <i
                className={thanking ? "fa fa-spinner fa-spin" : thankIcon}
                aria-hidden="true"
              />
              <span> {detail.thankCount}</span>
            </LegacyConfirm>
          </span>
          <Button variant="ghost"
            type="button"
            className="info-item click"
            title="点赞"
            aria-label={`点赞 ${detail.goodCount}`}
            disabled={!voteAvailable || voting != null}
            onClick={() => onVote("up")}
          >
            <i
              className={
                voting === "up"
                  ? "fa fa-spinner fa-spin"
                  : detail.vote === "up"
                    ? "fa-solid fa-thumbs-up"
                    : "fa-regular fa-thumbs-up"
              }
              aria-hidden="true"
            />
            <span> {detail.goodCount}</span>
          </Button>
          <Button variant="ghost"
            type="button"
            className="info-item click"
            title="点踩"
            aria-label={`点踩 ${detail.badCount}`}
            disabled={!voteAvailable || voting != null}
            onClick={() => onVote("down")}
          >
            <i
              className={
                voting === "down"
                  ? "fa fa-spinner fa-spin"
                  : detail.vote === "down"
                    ? "fa-solid fa-thumbs-up fa-rotate-180"
                    : "fa-regular fa-thumbs-up fa-rotate-180"
              }
              aria-hidden="true"
            />
            <span> {detail.badCount}</span>
          </Button>
          <Button variant="ghost"
            type="button"
            className="info-item click"
            title="评论"
            aria-label="跳到评论区"
            onClick={jumpToComposer}
          >
            <i className="fa-solid fa-message" aria-hidden="true" />
            <span> {detail.commentCount}</span>
          </Button>
        </p>
      </header>

      <section className="container article-detail-scroll">
        <main className="article-detail">
          <ArticleRichBody
            markdown={detail.markdown}
            html={detail.html}
            className="article-content article-md"
          />
          {detail.updatedTime || detail.createdTime ? (
            <section className="article-time">
              {detail.updated ? "更新于 " : "发表于 "}
              <time>{detail.updated ? detail.updatedTime : detail.createdTime}</time>
            </section>
          ) : null}
        </main>

        {detail.rewardPoint > 0 ? (
          <ArticleReward
            detail={detail}
            available={rewardAvailable}
            rewarding={rewarding}
            onReward={onReward}
          />
        ) : null}

        <footer>
          <CommentComposer
            disabled={!detail.commentable || sending || pendingConfirm}
            sending={sending}
            pendingConfirm={pendingConfirm}
            commentAvailable={commentAvailable}
            commentable={detail.commentable}
            reply={reply}
            onClearReply={() => setReply(null)}
            onSend={onSend}
          />
          <CommentList
            comments={detail.comments}
            selfUserName={selfUserName}
            loadingMore={loadingMore}
            hasEarlier={detail.commentHasEarlier}
            hasMore={detail.commentHasMore}
            action={commentAction}
            deleteAvailable={commentDeleteAvailable}
            thankAvailable={commentThankAvailable}
            voteAvailable={commentVoteAvailable}
            onLoadEarlier={onLoadEarlier}
            onLoadLater={onLoadLater}
            onDelete={onDeleteComment}
            onThank={onThankComment}
            onVote={onVoteComment}
            onReply={startReply}
            onJumpReply={jumpToComment}
          />
        </footer>
      </section>
    </>
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
      <section className="rewarded">
        <section className="rewarded-content">
          {detail.rewardContent ? (
            <ArticleRichBody
              markdown={detail.rewardContent}
              className="article-md"
            />
          ) : null}
          <span className="rewarded-count">{detail.rewardedCount} 打赏</span>
        </section>
      </section>
    );
  }

  return (
    <section className="rewarded">
      <LegacyConfirm
        className="rewarded-click"
        title={`确定要打赏 ${detail.rewardPoint} 积分给该帖子作者？`}
        label="打赏"
        disabled={!available || rewarding}
        onConfirm={onReward}
      >
        <span className="rewarded-text">
          {rewarding ? <i className="fa fa-spinner fa-spin" /> : <a>打赏</a>}{" "}
          {detail.rewardPoint} 积分后可见
        </span>
        <span className="rewarded-count">{detail.rewardedCount} 打赏</span>
      </LegacyConfirm>
    </section>
  );
}

function CommentList({
  comments,
  selfUserName,
  loadingMore,
  hasEarlier,
  hasMore,
  action,
  deleteAvailable,
  thankAvailable,
  voteAvailable,
  onLoadEarlier,
  onLoadLater,
  onDelete,
  onThank,
  onVote,
  onReply,
  onJumpReply,
}: {
  comments: ArticleComment[];
  selfUserName: string | null;
  loadingMore: boolean;
  hasEarlier: boolean;
  hasMore: boolean;
  action: { id: string; kind: "delete" | "thank" | "vote" } | null;
  deleteAvailable: boolean;
  thankAvailable: boolean;
  voteAvailable: boolean;
  onLoadEarlier: () => void;
  onLoadLater: () => void;
  onDelete: (commentId: string) => void;
  onThank: (commentId: string) => void;
  onVote: (commentId: string, direction: ArticleVoteDirection) => void;
  onReply: (comment: ArticleComment) => void;
  onJumpReply: (commentId: string) => void;
}) {
  const ordered = [...comments].reverse();
  return (
    <section id="comments">
      {hasEarlier ? (
        <section className="comment-more">
          <Button variant="ghost"
            type="button"
            title="更多评论"
            aria-label="加载更早评论"
            disabled={loadingMore}
            onClick={onLoadEarlier}
          >
            <i
              className={loadingMore ? "fa fa-spinner fa-spin" : "fa fa-caret-up"}
              aria-hidden="true"
            />
          </Button>
        </section>
      ) : null}
      <ul className="article-comments">
        {ordered.map((comment) => (
          <li
            key={comment.id}
            id={`comment-item-${comment.id}`}
            className="comment-item"
            data-id={comment.id}
          >
            <CommentItem
              comment={comment}
              original={
                comment.replyId
                  ? comments.find((item) => item.id === comment.replyId) ?? null
                  : null
              }
              selfUserName={selfUserName}
              action={action}
              deleteAvailable={deleteAvailable}
              thankAvailable={thankAvailable}
              voteAvailable={voteAvailable}
              onDelete={onDelete}
              onThank={onThank}
              onVote={onVote}
              onReply={() => onReply(comment)}
              onJumpReply={
                comment.replyId
                  ? () => onJumpReply(comment.replyId)
                  : undefined
              }
            />
          </li>
        ))}
      </ul>
      {hasMore ? (
        <section className="comment-more">
          <Button variant="ghost"
            type="button"
            title="更多评论"
            aria-label="加载更多评论"
            disabled={loadingMore}
            onClick={onLoadLater}
          >
            <i
              className={loadingMore ? "fa fa-spinner fa-spin" : "fa fa-caret-down"}
              aria-hidden="true"
            />
          </Button>
        </section>
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
  const isOwn = self.length > 0 && self === comment.userName;
  const busy = action?.id === comment.id;
  const busyKind = busy ? action?.kind : null;
  const name = comment.displayName || comment.userName;
  const replyLabel = original?.displayName || original?.userName || "";
  const replyAvatar = sanitizeHttpUrl(
    original?.avatarUrl || comment.replyAvatarUrl,
  );

  return (
    <article className="article-comment">
      <UserAvatar
        className="comment-avatar"
        userName={comment.userName}
        displayName={comment.displayName}
        avatarUrl={comment.avatarUrl}
        size={32}
      />
      <div className="comment-main">
        <div className="comment-header">
          <div className="comment-user">
            <Button variant="ghost"
              type="button"
              className="comment-user-name"
              onClick={() => dispatchUserCard(comment.userName)}
            >
              {name}
            </Button>
            {comment.replyId ? (
              <Button variant="ghost"
                type="button"
                className="comment-reply"
                title="跳转回复"
                aria-label={replyLabel ? `跳转到 ${replyLabel}` : "跳转回复"}
                onClick={onJumpReply}
              >
                <i className="fa-solid fa-reply fa-flip-horizontal" />
                {replyAvatar ? (
                  <AvatarMark
                    src={replyAvatar}
                    label={replyLabel || name}
                    size={15}
                  />
                ) : null}
              </Button>
            ) : null}
          </div>
          <div className="comment-time">{comment.time}</div>
        </div>
        <ArticleRichBody
          markdown={comment.markdown}
          html={comment.html}
          className="comment-content article-md"
        />
        <div className="comment-footer">
          {isOwn ? (
            <LegacyConfirm
              className="info-item click"
              title="你确定要删除这条评论吗？"
              label="删除"
              disabled={!deleteAvailable || busy}
              onConfirm={() => onDelete(comment.id)}
            >
              <i
                className={busyKind === "delete" ? "fa fa-spinner fa-spin" : "fa-solid fa-trash"}
                aria-hidden="true"
              />
            </LegacyConfirm>
          ) : null}
          <span className="info-item" title="感谢">
            {isOwn ? (
              <span>
                <i
                  className={
                    comment.thanked ? "fa-solid fa-heart" : "fa-regular fa-heart"
                  }
                />
                <span> {comment.thankCount}</span>
              </span>
            ) : (
              <LegacyConfirm
                title={`确认赠送 15 积分给 ${name} 以表感谢？`}
                label={`感谢 ${comment.thankCount}`}
                disabled={!thankAvailable || comment.thanked || busy}
                onConfirm={() => onThank(comment.id)}
              >
                <i
                  className={
                    busyKind === "thank"
                      ? "fa fa-spinner fa-spin"
                      : comment.thanked
                        ? "fa-solid fa-heart"
                        : "fa-regular fa-heart"
                  }
                />
                <span> {comment.thankCount}</span>
              </LegacyConfirm>
            )}
          </span>
          <Button variant="ghost"
            type="button"
            className="info-item click"
            title="点赞"
            aria-label={`点赞 ${comment.goodCount}`}
            disabled={!voteAvailable || busy}
            onClick={() => onVote(comment.id, "up")}
          >
            <i
              className={
                busyKind === "vote"
                  ? "fa fa-spinner fa-spin"
                  : comment.vote === "up"
                    ? "fa-solid fa-thumbs-up"
                    : "fa-regular fa-thumbs-up"
              }
            />
            <span> {comment.goodCount}</span>
          </Button>
          <Button variant="ghost"
            type="button"
            className="info-item click"
            title="点踩"
            aria-label={`点踩 ${comment.badCount}`}
            disabled={!voteAvailable || busy}
            onClick={() => onVote(comment.id, "down")}
          >
            <i
              className={
                busyKind === "vote"
                  ? "fa fa-spinner fa-spin"
                  : comment.vote === "down"
                    ? "fa-solid fa-thumbs-up fa-rotate-180"
                    : "fa-regular fa-thumbs-up fa-rotate-180"
              }
            />
            <span> {comment.badCount}</span>
          </Button>
          <Button variant="ghost"
            type="button"
            className="info-item click"
            title="回复"
            aria-label="回复"
            onClick={onReply}
          >
            <i className="fa-solid fa-reply" />
          </Button>
        </div>
      </div>
    </article>
  );
}

function UserAvatar({
  userName,
  displayName,
  avatarUrl,
  size,
  className,
}: {
  userName: string;
  displayName: string;
  avatarUrl: string;
  size: number;
  className?: string;
}) {
  const label = displayName.trim() || userName.trim() || "?";
  return (
    <Button variant="ghost"
      type="button"
      className={className ? `user-avatar-button ${className}` : "user-avatar-button"}
      title={label}
      aria-label={`${label} 的名片`}
      onClick={() => dispatchUserCard(userName)}
    >
      <AvatarMark src={sanitizeHttpUrl(avatarUrl)} label={label} size={size} />
    </Button>
  );
}

function AvatarMark({
  src,
  label,
  size,
}: {
  src: string | null;
  label: string;
  size: number;
}) {
  return (
    <span
      className="legacy-avatar"
      style={{ width: size, height: size, minWidth: size }}
      aria-hidden="true"
    >
      {src ? <img src={src} alt="" /> : <span>{label.slice(0, 1)}</span>}
    </span>
  );
}

function LegacyConfirm({
  title,
  label,
  disabled = false,
  className,
  onConfirm,
  children,
}: {
  title: string;
  label: string;
  disabled?: boolean;
  className?: string;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <span className={className ? `legacy-confirm ${className}` : "legacy-confirm"}>
      <Button variant="ghost"
        type="button"
        title={title}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {children}
      </Button>
      {open ? (
        <span
          className="legacy-confirm-pop"
          role="dialog"
          aria-label={title}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <span className="legacy-confirm-title">{title}</span>
          <span className="legacy-confirm-actions">
            <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button variant="ghost"
              type="button"
              className="primary"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              确定
            </Button>
          </span>
        </span>
      ) : null}
    </span>
  );
}
