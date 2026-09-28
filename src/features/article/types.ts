/**
 * 帖子前后端契约（camelCase）。
 *
 * 感谢、投票、打赏、在看、评论删除/感谢/赞踩都走 Rust invoke。
 * 命令缺失时不得伪装已感谢、已删除或已投票。
 */

export const ARTICLE_COMMAND = {
  list: "article_list",
  detail: "article_detail",
  comment: "comment_post",
  commentDelete: "comment_delete",
  commentThank: "comment_thank",
  commentVote: "comment_vote",
  thank: "article_thank",
  vote: "article_vote",
  reward: "article_reward",
  heat: "article_heat",
  heatWatch: "article_heat_watch",
  heatClose: "article_heat_close",
} as const;

export const ARTICLE_HEAT_EVENT = "article://heat";

export const ARTICLE_LIST_TYPES = [
  "recent",
  "hot",
  "good",
  "reply",
  "long",
] as const;

export type ArticleListType = (typeof ARTICLE_LIST_TYPES)[number];

export const ARTICLE_LIST_TYPE_LABEL: Record<ArticleListType, string> = {
  recent: "最新",
  hot: "热门",
  good: "好评",
  reply: "回帖",
  long: "长文",
};

export const ARTICLE_COMMAND_LABEL: Record<string, string> = {
  article_list: "帖子列表",
  article_detail: "帖子详情",
  comment_post: "发表评论",
  comment_delete: "删除评论",
  comment_thank: "感谢评论",
  comment_vote: "评论赞踩",
  article_thank: "感谢",
  article_vote: "点赞点踩",
  article_reward: "打赏",
  article_heat: "在看人数",
  article_heat_watch: "在看监听",
  article_heat_close: "关闭在看监听",
};

export type ArticleListRequest = {
  type?: ArticleListType;
  page: number;
};

export type ArticleDetailRequest = {
  id: string;
  page?: number;
};

/** 对齐 SDK `CommentPost` 的必要字段。 */
export type CommentPostRequest = {
  articleId: string;
  commentContent: string;
};

export type CommentIdRequest = {
  id: string;
};

export type CommentVoteRequest = {
  id: string;
  direction: ArticleVoteDirection;
};

export type ArticleVoteDirection = "up" | "down";

export type ArticleVoteResult = {
  accepted: boolean;
  outcomeUnknown: boolean;
  active: boolean;
};

/**
 * 评论赞踩结果。只表示写是否确定落成。
 * SDK `comment().vote` 的 bool 对 down 不可靠，状态由前端按切换语义更新。
 */
export type CommentVoteResult = CommentPostResult;

export type ArticleRewardResult = {
  accepted: boolean;
  outcomeUnknown: boolean;
  rewarded: boolean;
  rewardContent: string;
  rewardedCount: number;
};

export type ArticleHeatResult = {
  count: number;
};

export type ArticleHeatWatchResult = {
  watchGeneration: number;
};

export type ArticleHeatEvent = {
  articleId: string;
  delta: number;
};

export type ArticleSummary = {
  id: string;
  title: string;
  authorUserName: string;
  authorNickname: string;
  avatarUrl: string;
  time: string;
  tags: string;
  preview: string;
  commentCount: number;
  viewCount: number;
  thumbnailUrl: string;
  sticky: boolean;
  perfect: boolean;
};

export type ArticleComment = {
  id: string;
  userName: string;
  displayName: string;
  avatarUrl: string;
  time: string;
  markdown: string;
  /** 评论感谢数（旧客户端 commentThankCnt）。 */
  thankCount: number;
  /** 当前用户是否已感谢过。 */
  thanked: boolean;
  goodCount: number;
  badCount: number;
  vote: "up" | "down" | "none";
};

export type ArticleDetail = {
  id: string;
  title: string;
  authorUserName: string;
  authorNickname: string;
  avatarUrl: string;
  time: string;
  tags: string;
  markdown: string;
  commentCount: number;
  commentable: boolean;
  comments: ArticleComment[];
  commentPage: number;
  commentHasMore: boolean;
  thanked: boolean;
  thankCount: number;
  goodCount: number;
  badCount: number;
  vote: "up" | "down" | "none";
  rewarded: boolean;
  rewardPoint: number;
  rewardedCount: number;
  /** 仅 rewarded 时有正文。未打赏必须是空串。 */
  rewardContent: string;
  articleType: number;
};

export type ArticleListResult = {
  items: ArticleSummary[];
  page: number;
  hasMore: boolean;
};

export type CommentPostResult = {
  accepted: boolean;
  outcomeUnknown: boolean;
};

export type ArticleCapabilities = {
  list: boolean;
  detail: boolean;
  comment: boolean;
  commentDelete: boolean;
  commentThank: boolean;
  commentVote: boolean;
  thank: boolean;
  vote: boolean;
  reward: boolean;
  heat: boolean;
  heatWatch: boolean;
};
