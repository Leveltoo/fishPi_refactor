import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
import {
  ArrowBendUpLeftIcon,
  HeartIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TrashIcon,
} from "@phosphor-icons/react";

import { sanitizeHttpUrl } from "../../../lib/markdown";
import { dispatchUserCard } from "../events";
import { ArticleRichBody } from "../MarkdownBody";
import type { ArticleComment, ArticleVoteDirection } from "../types";
import { AuthorChip } from "./AuthorChip";

type CommentItemProps = {
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
};

export function CommentItem({
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
}: CommentItemProps) {
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
            aria-label={`感谢 ${comment.thankCount}`}
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
            title={voteTitle ?? "点赞"}
            aria-label={`点赞 ${comment.goodCount}`}
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
            title={voteTitle ?? "点踩"}
            aria-label={`点踩 ${comment.badCount}`}
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
