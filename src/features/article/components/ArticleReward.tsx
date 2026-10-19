import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { ArticleRichBody } from "../MarkdownBody";
import type { ArticleDetail } from "../types";

type ArticleRewardProps = {
  detail: ArticleDetail;
  available: boolean;
  rewarding: boolean;
  onReward: () => void;
};

export function ArticleReward({
  detail,
  available,
  rewarding,
  onReward,
}: ArticleRewardProps) {
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
