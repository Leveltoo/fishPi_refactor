import { useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { WarningIcon } from "@phosphor-icons/react";

import { setHeaderTitle } from "../../lib/headerTitle";
import { useArticles } from "./useArticles";
import { ArticleDetailPane } from "./components/ArticleDetailPane";
import { ArticleListPane } from "./components/ArticleListPane";
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
            帖子列表暂不可用。
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
      ) : null}
      <div className="article-list-preserved" style={showingDetail ? { display: "none" } : undefined}>
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
      </div>
    </div>
  );
}
