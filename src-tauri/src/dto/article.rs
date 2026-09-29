//! 帖子列表 / 详情 / 评论 DTO。列表预览可剥 HTML；详情正文与评论保留富文本。

use fishpi_sdk::domain::article::{
    ArticleComment, ArticleDetail, ArticleList, Pagination, VoteStatus,
};
use serde::{Deserialize, Serialize};

use crate::text::{html_to_text, keep_renderable, markdown_or_none, nonempty_text, split_rich_body};

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
    pub html: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    pub comment_count: u64,
    pub commentable: bool,
    pub perfect: bool,
    pub comments: Vec<ArticleCommentDto>,
    pub page_count: u32,
    /// 本次返回的评论页。缺省请求时是最后一页。
    #[serde(default)]
    pub comment_page: u32,
    /// 还有更早的评论页（page > 1）。
    #[serde(default)]
    pub comment_has_earlier: bool,
    #[serde(default)]
    pub comment_has_more: bool,
    #[serde(default)]
    pub view_count: u64,
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
        let rich = split_rich_body(if detail.markdown_content().trim().is_empty() {
            detail.html_content()
        } else {
            detail.markdown_content()
        });
        // 有独立 markdown 源时优先 md；否则保留 HTML，不要剥成纯文本。
        let md = markdown_or_none(detail.markdown_content()).or(rich.markdown.clone());
        let html = if md.is_some() { None } else { rich.html };
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
            html,
            text: None,
            comment_count: detail.comment_count,
            commentable: detail.commentable,
            perfect: detail.perfect,
            comments: detail
                .comments
                .into_iter()
                .map(ArticleCommentDto::from)
                .collect(),
            page_count,
            comment_page: 0,
            comment_has_earlier: false,
            comment_has_more: false,
            view_count: detail.view_count,
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

    /// 带上本次评论页。`comment_page == 0` 视为最后一页。
    pub fn at_comment_page(mut self, comment_page: u32) -> Self {
        let total = self.page_count.max(1);
        let page = if comment_page == 0 {
            total
        } else {
            comment_page.min(total)
        };
        self.comment_page = page;
        self.comment_has_earlier = page > 1;
        self.comment_has_more = page < total;
        self
    }
}

/// 未打赏一律 `None`，避免把隐藏正文交给 WebView。已打赏保留图和链。
fn visible_reward_body(rewarded: bool, raw: &str) -> Option<String> {
    if !rewarded {
        return None;
    }
    keep_renderable(raw)
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    pub time: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_id: Option<String>,
    /// 被回复者头像。仅频道 JSON 自带时才有；SDK 详情没有该字段，不伪造。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_avatar_url: Option<String>,
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
        let rich = split_rich_body(&comment.content);
        let original = keep_renderable(&comment.content);
        Self {
            id: comment.id,
            author_user_name: author_user_name.clone(),
            user_name: author_user_name,
            author_avatar_url: comment.thumbnail_url.clone(),
            avatar_url: comment.thumbnail_url,
            content: original.clone(),
            markdown: rich.markdown.clone(),
            html: rich.html,
            text: rich.markdown,
            time,
            reply_id: nonempty_owned(&comment.reply_id),
            reply_avatar_url: None,
            thank_count: comment.thank_count,
            good_count: comment.good_count,
            bad_count: comment.bad_count,
            vote: vote_name(comment.vote),
            rewarded: comment.rewarded,
        }
    }
}

impl ArticleCommentDto {
    /// 文章频道推送。对不上 `commentOnArticleId` / 没有 `oId` 则不是评论。
    /// 原作者头像只透传 JSON 里的 `commentOriginalAuthorThumbnailURL`；没有就不填。
    pub fn try_from_channel(value: &serde_json::Value, expected_article_id: &str) -> Option<Self> {
        let rec = match value {
            serde_json::Value::Object(map) => map,
            _ => return None,
        };
        if rec.get("type").and_then(serde_json::Value::as_str) == Some("articleHeat") {
            return None;
        }
        if let Some(nested) = rec.get("comment") {
            if nested.is_object() {
                return Self::try_from_channel(nested, expected_article_id);
            }
        }
        let article_id = json_string(rec, &["commentOnArticleId", "articleId"]).unwrap_or_default();
        if !article_id.is_empty() && article_id != expected_article_id {
            return None;
        }
        let id = json_string(rec, &["oId", "id", "commentId"])?;
        let user_name = json_string(rec, &["commentAuthorName", "userName", "author"]).unwrap_or_default();
        let avatar = json_string(
            rec,
            &[
                "commentAuthorThumbnailURL",
                "avatarUrl",
                "thumbnailUrl",
                "avatar",
            ],
        )
        .unwrap_or_default();
        let raw = json_string(
            rec,
            &["commentContent", "content", "markdown", "html", "md"],
        )
        .unwrap_or_default();
        let rich = split_rich_body(&raw);
        let original = keep_renderable(&raw);
        Some(Self {
            id,
            author_user_name: user_name.clone(),
            user_name,
            author_avatar_url: avatar.clone(),
            avatar_url: avatar,
            content: original.clone(),
            markdown: rich.markdown.clone(),
            html: rich.html,
            text: rich.markdown,
            time: json_string(
                rec,
                &[
                    "commentCreateTimeStr",
                    "timeAgo",
                    "time",
                    "commentCreateTime",
                ],
            )
            .unwrap_or_default(),
            reply_id: json_string(rec, &["commentOriginalCommentId", "replyId"]),
            reply_avatar_url: json_string(
                rec,
                &["commentOriginalAuthorThumbnailURL", "replyAvatarUrl"],
            ),
            thank_count: json_u64(rec, &["commentThankCnt", "thankCount"]),
            good_count: json_u64(rec, &["commentGoodCnt", "goodCount"]),
            bad_count: json_u64(rec, &["commentBadCnt", "badCount"]),
            vote: match json_string(rec, &["commentVote", "vote"]).as_deref() {
                Some("0") | Some("up") => "up".to_string(),
                Some("1") | Some("down") => "down".to_string(),
                _ => "none".to_string(),
            },
            rewarded: json_bool(rec, &["rewarded", "thanked"]),
        })
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
    #[serde(default, alias = "commentOriginalCommentId")]
    pub reply_id: Option<String>,
    #[serde(default, alias = "commentAnonymous")]
    pub anonymous: bool,
    #[serde(default, alias = "commentVisible")]
    pub visible: bool,
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

/// `article://comment`。文章频道里除 heat 外、能识别的新评论。
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleCommentEvent {
    pub session_generation: u64,
    pub article_id: String,
    pub comment: ArticleCommentDto,
}

pub(crate) fn pagination_count(pagination: Option<&Pagination>) -> u32 {
    pagination.map(|p| p.count).unwrap_or(0)
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

fn nonempty_owned(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn json_string(map: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        match map.get(*key) {
            Some(serde_json::Value::String(text)) => {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
            Some(serde_json::Value::Number(num)) => return Some(num.to_string()),
            _ => {}
        }
    }
    None
}

fn json_u64(map: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> u64 {
    for key in keys {
        match map.get(*key) {
            Some(serde_json::Value::Number(num)) => {
                if let Some(n) = num.as_u64() {
                    return n;
                }
            }
            Some(serde_json::Value::String(text)) => {
                if let Ok(n) = text.trim().parse::<u64>() {
                    return n;
                }
            }
            _ => {}
        }
    }
    0
}

fn json_bool(map: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> bool {
    for key in keys {
        match map.get(*key) {
            Some(serde_json::Value::Bool(flag)) => return *flag,
            Some(serde_json::Value::Number(num)) => return num.as_u64() == Some(1),
            Some(serde_json::Value::String(text)) => {
                let t = text.trim();
                if t == "1" || t.eq_ignore_ascii_case("true") {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
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
            Some("<p>hello</p>")
        );
        assert_eq!(
            super::visible_reward_body(true, "hello **x**").as_deref(),
            Some("hello **x**")
        );
    }

    #[test]
    fn channel_comment_keeps_html_and_reply_id() {
        let value = serde_json::json!({
            "oId": "c1",
            "commentOnArticleId": "a1",
            "commentAuthorName": "bob",
            "commentContent": "<p>看 <img src=\"https://a.test/x.png\"></p>",
            "commentOriginalCommentId": "c0",
            "commentAuthorThumbnailURL": "https://a.test/av.png",
            "commentOriginalAuthorThumbnailURL": "https://a.test/orig.png"
        });
        let comment = ArticleCommentDto::try_from_channel(&value, "a1").expect("comment");
        assert_eq!(comment.id, "c1");
        assert_eq!(comment.user_name, "bob");
        assert_eq!(comment.reply_id.as_deref(), Some("c0"));
        assert_eq!(
            comment.reply_avatar_url.as_deref(),
            Some("https://a.test/orig.png")
        );
        assert!(comment.html.unwrap_or_default().contains("<img"));
        assert!(comment.markdown.is_none());
        assert!(ArticleCommentDto::try_from_channel(&value, "other").is_none());
        assert!(ArticleCommentDto::try_from_channel(
            &serde_json::json!({"type": "articleHeat", "operation": "+"}),
            "a1"
        )
        .is_none());
    }
}
