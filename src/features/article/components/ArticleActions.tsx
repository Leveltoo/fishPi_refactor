import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  HeartIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "@phosphor-icons/react";

import type { ArticleDetail, ArticleVoteDirection } from "../types";

type ArticleActionsProps = {
  detail: ArticleDetail;
  heatCount: number | null;
  heatLive: boolean;
  heatNote: string | null;
  thankAvailable: boolean;
  voteAvailable: boolean;
  thanking: boolean;
  voting: ArticleVoteDirection | null;
  isOwn: boolean;
  onThank: () => void;
  onVote: (direction: ArticleVoteDirection) => void;
};

export function ArticleActions({
  detail,
  heatCount,
  heatLive,
  heatNote,
  thankAvailable,
  voteAvailable,
  thanking,
  voting,
  isOwn,
  onThank,
  onVote,
}: ArticleActionsProps) {
  const thankTitle = !thankAvailable
    ? "感谢命令尚未接入"
    : isOwn
      ? "不能感谢自己的帖子"
    : detail.thanked
      ? "已感谢"
      : "确认赠送 20 积分给该帖作者以表感谢";
  const voteTitle = voteAvailable ? undefined : "点赞点踩命令尚未接入";

  function thank() {
    if (!thankAvailable || detail.thanked || thanking || isOwn) {
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
        disabled={!thankAvailable || detail.thanked || thanking || isOwn}
        title={thankTitle}
        onClick={thank}
      >
        {thanking ? <Spinner /> : <HeartIcon />}
        {detail.thanked ? "已感谢" : "感谢"} {detail.thankCount}
      </Button>
      <Button
        type="button"
        variant={detail.vote === "up" ? "secondary" : "outline"}
        size="sm"
        aria-pressed={detail.vote === "up"}
        aria-label={`点赞 ${detail.goodCount}`}
        disabled={!voteAvailable || voting != null}
        title={voteTitle ?? "点赞"}
        onClick={() => onVote("up")}
      >
        {voting === "up" ? <Spinner /> : <ThumbsUpIcon />}
        {detail.goodCount}
      </Button>
      <Button
        type="button"
        variant={detail.vote === "down" ? "secondary" : "outline"}
        size="sm"
        aria-pressed={detail.vote === "down"}
        aria-label={`点踩 ${detail.badCount}`}
        disabled={!voteAvailable || voting != null}
        title={voteTitle ?? "点踩"}
        onClick={() => onVote("down")}
      >
        {voting === "down" ? <Spinner /> : <ThumbsDownIcon />}
        {detail.badCount}
      </Button>
    </div>
  );
}
