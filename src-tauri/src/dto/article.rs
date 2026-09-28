//! 帖子列表 / 详情 / 评论 DTO。只给 markdown 与剥过的纯文本，不转发原始 HTML。

use fishpi_sdk::domain::article::{
    ArticleComment, ArticleDetail, ArticleList, Pagination, VoteStatus,
};
use serde::{Deserialize, Serialize};

use crate::text::{html_to_text, markdown_or_none, nonempty_text};

/// `article_list` 查询。`type` 为 recent/hot/good/reply/long/perfect。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleListQuery {
    #[serde(rename = "type", default)]
    pub list_type: Option<String>,
    #[serde(default)]
    pub page: Option<u32>,
    #[serde(default)]
    pub size: Option<u32>,
}

/// 列表结果。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleListResult {
    pub session_generation: u64,
    pub articles: Vec<ArticleSummaryDto>,
    pub page: u32,
    pub page_count: u32,
    pub has_more: bool,
}

impl ArticleListResult {
    pub fn from_sdk(session_generation: u64, page: u32, list: ArticleList) -> Self {
        let page_count = list.pagination.count;
        let articles: Vec<ArticleSummaryDto> =
            list.list.into_iter().map(ArticleSummaryDto::from).collect();
        let has_more = if page_count > 0 {
            page < page_count
        } else {
            !articles.is_empty()
        };
        Self {
            session_generation,
            articles,
            page,
            page_count,
            has_more,
        }
    }
}

/// 列表摘要。`preview` 已剥 HTML。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleSummaryDto {
    pub id: String,
    pub title: String,
    pub author_user_name: String,
    pub author_avatar_url: String,
    pub avatar_url: String,
    pub time: String,
    pub tags: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    pub comment_count: u64,
    pub good_count: u64,
    pub view_count: u64,
    pub perfect: bool,
}

impl From<ArticleDetail> for ArticleSummaryDto {
    fn from(item: ArticleDetail) -> Self {
        let title = display_title(&item);
        let time = if item.time_ago.trim().is_empty() {
            item.create_time_str
        } else {
            item.time_ago
        };
        Self {
            id: item.id,
            title,
            author_user_name: item.author_name,
            author_avatar_url: item.thumbnail_url48.clone(),
            avatar_url: item.thumbnail_url48,
            time,
            tags: item.tags,
            preview: nonempty_text(&html_to_text(&item.preview_content)),
            comment_count: item.comment_count,
            good_count: item.good_count,
            view_count: item.view_count,
            perfect: item.perfect,
        }
    }
}

/// `article_detail` 查询。`page` 是评论页码。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleDetailQuery {
    pub id: String,
    #[serde(default)]
    pub page: Option<u32>,
}

/// 详情。`md` 优先 Markdown 原文；没有则只给剥过的 `text`。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleDetailResult {
    pub session_generation: u64,
    pub article: ArticleDetailDto,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleDetailDto {
    pub id: String,
    pub title: String,
    pub author_user_name: String,
    pub author_avatar_url: String,
    pub avatar_url: String,
    pub time: String,
    pub tags: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub md: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub markdown: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    pub comment_count: u64,
    pub commentable: bool,
    pub perfect: bool,
    pub comments: Vec<ArticleCommentDto>,
    pub page_count: u32,
    #[serde(default)]
    pub thanked: bool,
    #[serde(default)]
    pub thank_count: u64,
    #[serde(default)]
    pub good_count: u64,
    #[serde(default)]
    pub bad_count: u64,
    /// `up` / `down` / `none`。缺省空串，前端当未投票。
    #[serde(default)]
    pub vote: String,
    #[serde(default)]
    pub rewarded: bool,
    #[serde(default)]
    pub reward_point: u64,
    #[serde(default)]
    pub rewarded_count: u64,
    /// 仅 `rewarded` 时有值。未打赏不带隐藏正文。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reward_content: Option<String>,
    /// SDK `ArticleType` 的数值，供在看频道使用。
    #[serde(default)]
    pub article_type: u8,
}

impl ArticleDetailDto {
    pub fn from_sdk(detail: ArticleDetail) -> Self {
        let title = display_title(&detail);
        let time = if detail.time_ago.trim().is_empty() {
            detail.create_time_str.clone()
        } else {
            detail.time_ago.clone()
        };
        let md = markdown_or_none(detail.markdown_content());
        let text = if md.is_some() {
            None
        } else {
            nonempty_text(&html_to_text(detail.html_content()))
        };
        let page_count = pagination_count(detail.pagination.as_ref());
        Self {
            id: detail.id,
            title,
            author_user_name: detail.author_name,
            author_avatar_url: detail.thumbnail_url48.clone(),
            avatar_url: detail.thumbnail_url48,
            time,
            tags: detail.tags,
            md: md.clone(),
            markdown: md,
            text,
            comment_count: detail.comment_count,
            commentable: detail.commentable,
            perfect: detail.perfect,
            comments: detail
                .comments
                .into_iter()
                .map(ArticleCommentDto::from)
                .collect(),
            page_count,
            thanked: detail.thanked,
            thank_count: if detail.thank_count > 0 {
                detail.thank_count
            } else {
                detail.thanked_count
            },
            good_count: detail.good_count,
            bad_count: detail.bad_count,
            vote: vote_name(detail.vote),
            rewarded: detail.rewarded,
            reward_point: detail.reward_point,
            rewarded_count: detail.rewarded_count,
            reward_content: visible_reward_body(detail.rewarded, &detail.reward_content),
            article_type: detail.type_ as u8,
        }
    }
}

/// 未打赏一律 `None`，避免把隐藏正文交给 WebView。
fn visible_reward_body(rewarded: bool, raw: &str) -> Option<String> {
    if !rewarded {
        return None;
    }
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(markdown) = markdown_or_none(trimmed) {
        return Some(markdown);
    }
    nonempty_text(trimmed)
}

fn vote_name(vote: VoteStatus) -> String {
    match vote {
        VoteStatus::Up => "up".to_string(),
        VoteStatus::Down => "down".to_string(),
        VoteStatus::Normal => "none".to_string(),
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleCommentDto {
    pub id: String,
    pub author_user_name: String,
    pub user_name: String,
    pub author_avatar_url: String,
    pub avatar_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub markdown: Option<String>,
    pub time: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_id: Option<String>,
    #[serde(default)]
    pub thank_count: u64,
    #[serde(default)]
    pub good_count: u64,
    #[serde(default)]
    pub bad_count: u64,
    /// `up` / `down` / `none`。缺省空串，前端当未投票。
    #[serde(default)]
    pub vote: String,
    /// 当前用户是否已感谢过这条评论。
    #[serde(default)]
    pub rewarded: bool,
}

impl From<ArticleComment> for ArticleCommentDto {
    fn from(comment: ArticleComment) -> Self {
        let author_user_name = if comment.commenter.user_name.trim().is_empty() {
            comment.author
        } else {
            comment.commenter.user_name
        };
        let time = if comment.time_ago.trim().is_empty() {
            comment.create_time_str
        } else {
            comment.time_ago
        };
        let text = nonempty_text(&html_to_text(&comment.content));
        Self {
            id: comment.id,
            author_user_name: author_user_name.clone(),
            user_name: author_user_name,
            author_avatar_url: comment.thumbnail_url.clone(),
            avatar_url: comment.thumbnail_url,
            content: text.clone(),
            markdown: text.clone(),
            text,
            time,
            reply_id: nonempty_owned(&comment.reply_id),
            thank_count: comment.thank_count,
            good_count: comment.good_count,
            bad_count: comment.bad_count,
            vote: vote_name(comment.vote),
            rewarded: comment.rewarded,
        }
    }
}

/// `comment_post` 入参。写操作，成功不带评论 ID。
///
/// 前端字段是 `commentContent`；也接受 `content`。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommentPostRequest {
    pub article_id: String,
    #[serde(alias = "content")]
    pub comment_content: String,
    #[serde(default)]
    pub reply_id: Option<String>,
    #[serde(default)]
    pub anonymous: Option<bool>,
}

/// 感谢 / 在看人数等只需要帖子 ID 的入参。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleIdRequest {
    pub id: String,
}

/// 点赞或点踩。`direction` 为 `up` / `down`。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleVoteRequest {
    pub id: String,
    pub direction: String,
}

/// 投票结果。`active` 仅在确定成功时表示该方向现在是否选中。
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleVoteResult {
    pub session_generation: u64,
    pub accepted: bool,
    pub outcome_unknown: bool,
    pub active: bool,
}

impl ArticleVoteResult {
    pub fn accepted(session_generation: u64, active: bool) -> Self {
        Self {
            session_generation,
            accepted: true,
            outcome_unknown: false,
            active,
        }
    }

    pub fn unconfirmed(session_generation: u64) -> Self {
        Self {
            session_generation,
            accepted: false,
            outcome_unknown: true,
            active: false,
        }
    }
}

/// 打赏结果。未确认或未打赏时不带隐藏正文。
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleRewardResult {
    pub session_generation: u64,
    pub accepted: bool,
    pub outcome_unknown: bool,
    pub rewarded: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reward_content: Option<String>,
    #[serde(default)]
    pub rewarded_count: u64,
}

impl ArticleRewardResult {
    pub fn opened(
        session_generation: u64,
        reward_content: Option<String>,
        rewarded_count: u64,
    ) -> Self {
        Self {
            session_generation,
            accepted: true,
            outcome_unknown: false,
            rewarded: true,
            reward_content,
            rewarded_count,
        }
    }

    pub fn unconfirmed(session_generation: u64) -> Self {
        Self {
            session_generation,
            accepted: false,
            outcome_unknown: true,
            rewarded: false,
            reward_content: None,
            rewarded_count: 0,
        }
    }
}

/// `article().heat` 拉到的在看人数。
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleHeatResult {
    pub session_generation: u64,
    pub count: u32,
}

/// 订阅文章频道。`articleType` 缺省按普通帖。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleHeatWatchRequest {
    pub id: String,
    #[serde(default)]
    pub article_type: Option<u8>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleHeatWatchResult {
    pub session_generation: u64,
    pub watch_generation: u64,
}

/// 只关掉这一代监听。旧的 close 不能拆掉后打开的连接。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleHeatCloseRequest {
    #[serde(default)]
    pub watch_generation: u64,
}

/// `article://heat`。`delta` 只可能是 1 或 -1。
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleHeatEvent {
    pub session_generation: u64,
    pub article_id: String,
    pub delta: i32,
}

fn display_title(item: &ArticleDetail) -> String {
    for candidate in [
        item.title_emoji_unicode.trim(),
        item.title_emoji.trim(),
        item.title.trim(),
    ] {
        if !candidate.is_empty() {
            return candidate.to_string();
        }
    }
    "[无标题]".to_string()
}

fn pagination_count(pagination: Option<&Pagination>) -> u32 {
    pagination.map(|p| p.count).unwrap_or(0)
}

fn nonempty_owned(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_camel_case_and_string_id() {
        let dto = ArticleSummaryDto {
            id: "1760000000000".into(),
            title: "hello".into(),
            author_user_name: "alice".into(),
            author_avatar_url: "".into(),
            avatar_url: "".into(),
            time: "1 小时前".into(),
            tags: "rust".into(),
            preview: Some("hi".into()),
            comment_count: 2,
            good_count: 1,
            view_count: 10,
            perfect: false,
        };
        let value = serde_json::to_value(&dto).expect("serialize");
        assert_eq!(value["id"], "1760000000000");
        assert_eq!(value["authorUserName"], "alice");
        assert_eq!(value["authorAvatarUrl"], "");
        assert_eq!(value["commentCount"], 2);
        assert!(value.get("content").is_none());
    }

    #[test]
    fn hidden_reward_body_stays_hidden() {
        assert_eq!(super::visible_reward_body(false, "<p>secret</p>"), None);
        assert_eq!(super::visible_reward_body(false, "plain secret"), None);
        assert_eq!(
            super::visible_reward_body(true, "<p>hello</p>").as_deref(),
            Some("hello")
        );
        assert_eq!(
            super::visible_reward_body(true, "hello **x**").as_deref(),
            Some("hello **x**")
        );
    }
}
