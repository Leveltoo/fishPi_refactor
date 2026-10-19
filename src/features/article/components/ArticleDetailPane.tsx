import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  ArrowLeftIcon,
  ChatCircleIcon,
  EyeIcon,
} from "@phosphor-icons/react";

import { CommentComposer } from "../CommentComposer";
import { ArticleRichBody } from "../MarkdownBody";
import type {
  ArticleComment,
  ArticleDetail,
  ArticleVoteDirection,
  CommentReplyTarget,
  CommentSubmit,
} from "../types";
import { ArticleActions } from "./ArticleActions";
import { ArticleReward } from "./ArticleReward";
import { AuthorChip } from "./AuthorChip";
import { CommentItem } from "./CommentItem";

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

export function ArticleDetailPane({
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
    document.getElementById("article-composer")?.scrollIntoView({
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
        <Button type="button" variant="ghost" size="icon-sm" title="刷新详情"
          aria-label="刷新详情" disabled={loading || loadingMore} onClick={onRetry}>
          <RefreshCw />
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
                isOwn={selfUserName != null && selfUserName === detail.authorUserName}
                onThank={onThank}
                onVote={onVote}
              />
            </div>
            <ArticleRichBody
              markdown={detail.markdown}
              html={detail.html}
              empty="这篇帖子没有正文。"
            />
            {detail.updatedTime || detail.createdTime ? (
              <p className="article-time">
                {detail.updated ? "更新于 " : "发表于 "}
                <time>{detail.updated ? detail.updatedTime : detail.createdTime}</time>
              </p>
            ) : null}
            {detail.rewardPoint > 0 ? (
              <ArticleReward
                detail={detail}
                available={rewardAvailable}
                rewarding={rewarding}
                onReward={onReward}
              />
            ) : null}

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
            <h3 className="article-comments-title" id="article-comments">
              评论
              {detail.commentCount > 0 ? (
                <span> {detail.commentCount}</span>
              ) : null}
            </h3>
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
                {[...detail.comments].reverse().map((comment) => (
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

          </div>
        )}
      </ScrollArea>
    </section>
  );
}
