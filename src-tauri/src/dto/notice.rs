//! 通知 HTTP / 实时事件 DTO。列表项只给纯文本，不转发原始 HTML。

use fishpi_sdk::domain::notice::{NoticeCount, NoticeItem, NoticeMsg};
use serde::{Deserialize, Serialize};

use crate::text::{html_to_text, nonempty_text};

/// `notice://broadcast`
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoticeBroadcastEvent {
    pub session_generation: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_generation: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub who: Option<String>,
}

impl NoticeBroadcastEvent {
    pub fn from_msg(session_generation: u64, connection_generation: u64, msg: NoticeMsg) -> Self {
        Self {
            session_generation,
            connection_generation: Some(connection_generation),
            content: msg.content.as_deref().and_then(nonempty_text),
            who: msg.who.filter(|who| !who.trim().is_empty()),
        }
    }
}

/// `notice_count` 未读计数。不含 token。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoticeCountDto {
    pub session_generation: u64,
    pub notify_status: bool,
    pub count: u64,
    pub reply: u64,
    pub point: u64,
    pub at: u64,
    pub broadcast: u64,
    pub sys_announce: u64,
    pub new_follower: u64,
    pub following: u64,
    pub commented: u64,
}

impl NoticeCountDto {
    pub fn from_sdk(session_generation: u64, count: NoticeCount) -> Self {
        Self {
            session_generation,
            notify_status: count.notify_status,
            count: count.count,
            reply: count.reply,
            point: count.point,
            at: count.at,
            broadcast: count.broadcast,
            sys_announce: count.sys_announce,
            new_follower: count.new_follower,
            following: count.following,
            commented: count.commented,
        }
    }
}

/// `notice_list` 入参。`broadcast` 由 command 拦截为 business，不调 SDK。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoticeListRequest {
    #[serde(rename = "type")]
    pub notice_type: String,
}

/// 通知列表。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoticeListResult {
    pub session_generation: u64,
    pub items: Vec<NoticeItemDto>,
}

/// 统一通知项。`text` / `content` 已剥 HTML。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoticeItemDto {
    pub id: String,
    pub kind: String,
    pub has_read: bool,
    pub create_time: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_avatar_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub article_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_type: Option<u32>,
    #[serde(default)]
    pub deleted: bool,
}

impl From<NoticeItem> for NoticeItemDto {
    fn from(notice: NoticeItem) -> Self {
        let (url, data_id, data_type, deleted) = match &notice {
            NoticeItem::Comment(n) => (community_url(&n.sharp_url), None, None, false),
            NoticeItem::Reply(n) => (community_url(&n.sharp_url), None, Some(n.data_type), false),
            NoticeItem::At(n) => (
                community_url(&n.url),
                nonempty_owned(&n.data_id),
                Some(n.data_type),
                n.deleted,
            ),
            NoticeItem::Follow(n) => (community_url(&n.url), None, Some(n.data_type), false),
            NoticeItem::System(n) => (
                if n.data_id.chars().all(|ch| ch.is_ascii_digit()) && !n.data_id.is_empty() {
                    Some(format!("https://fishpi.cn/article/{}", n.data_id))
                } else {
                    None
                },
                nonempty_owned(&n.data_id),
                Some(n.data_type),
                false,
            ),
            NoticeItem::Point(_) => (None, None, None, false),
        };
        let mut dto = match notice {
            NoticeItem::Point(n) => item(
                n.id,
                "point",
                n.has_read,
                n.create_time,
                nonempty_text(&html_to_text(&n.description)),
                None,
                None,
                None,
                None,
            ),
            NoticeItem::Comment(n) => item(
                n.id,
                "commented",
                n.has_read,
                n.create_time,
                nonempty_text(&html_to_text(&n.content)),
                nonempty_owned(&n.title),
                nonempty_owned(&n.author),
                nonempty_owned(&n.thumbnail_url),
                None,
            ),
            NoticeItem::Reply(n) => item(
                n.id,
                "reply",
                n.has_read,
                n.create_time,
                nonempty_text(&html_to_text(&n.content)),
                nonempty_owned(&n.title),
                nonempty_owned(&n.author),
                nonempty_owned(&n.thumbnail_url),
                None,
            ),
            NoticeItem::At(n) => item(
                n.id,
                "at",
                n.has_read,
                n.create_time,
                nonempty_text(&html_to_text(&n.content))
                    .or_else(|| nonempty_text(&html_to_text(&n.description))),
                nonempty_owned(&n.article_title),
                nonempty_owned(&n.user_name).or_else(|| nonempty_owned(&n.author_name)),
                nonempty_owned(&n.user_avatar_url).or_else(|| nonempty_owned(&n.avatar_url)),
                nonempty_owned(n.article_id.as_str()),
            ),
            NoticeItem::Follow(n) => item(
                n.id,
                "following",
                n.has_read,
                n.create_time,
                nonempty_text(&html_to_text(&n.content)),
                nonempty_owned(&n.title),
                nonempty_owned(&n.author),
                nonempty_owned(&n.thumbnail_url),
                None,
            ),
            NoticeItem::System(n) => item(
                n.id,
                "sys-announce",
                n.has_read,
                n.create_time,
                nonempty_text(&html_to_text(&n.description))
                    .or_else(|| nonempty_text(&html_to_text(&n.content))),
                None,
                None,
                None,
                None,
            ),
        };
        dto.url = url;
        dto.data_id = data_id;
        dto.data_type = data_type;
        dto.deleted = deleted;
        dto
    }
}

/// `notice_make_read` 入参。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoticeMakeReadRequest {
    #[serde(rename = "type")]
    pub notice_type: String,
}

fn item(
    id: String,
    kind: &str,
    has_read: bool,
    create_time: String,
    text: Option<String>,
    title: Option<String>,
    user_name: Option<String>,
    user_avatar_url: Option<String>,
    article_id: Option<String>,
) -> NoticeItemDto {
    NoticeItemDto {
        id,
        kind: kind.to_string(),
        has_read,
        create_time,
        content: text.clone(),
        text,
        title,
        user_name,
        user_avatar_url,
        article_id,
        url: None,
        data_id: None,
        data_type: None,
        deleted: false,
    }
}

fn community_url(value: &str) -> Option<String> {
    let base = reqwest::Url::parse("https://fishpi.cn").ok()?;
    let url = base.join(value.trim()).ok()?;
    if value.trim().is_empty()
        || url.scheme() != "https"
        || url.host_str() != Some("fishpi.cn")
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    Some(url.to_string())
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
    fn count_uses_camel_case() {
        let dto = NoticeCountDto {
            session_generation: 1,
            notify_status: true,
            count: 3,
            reply: 1,
            point: 0,
            at: 0,
            broadcast: 0,
            sys_announce: 0,
            new_follower: 0,
            following: 0,
            commented: 2,
        };
        let value = serde_json::to_value(&dto).expect("serialize");
        assert_eq!(value["sessionGeneration"], 1);
        assert_eq!(value["notifyStatus"], true);
        assert_eq!(value["sysAnnounce"], 0);
        assert_eq!(value["newFollower"], 0);
    }

    #[test]
    fn notice_targets_only_allow_community_https() {
        assert_eq!(
            community_url("/article/123#456").as_deref(),
            Some("https://fishpi.cn/article/123#456")
        );
        for url in [
            "",
            "javascript:alert(1)",
            "//evil.example/x",
            "https://fishpi.cn.evil.example/x",
            "https://user:pass@fishpi.cn/x",
            "http://fishpi.cn/x",
            "https://fishpi.cn:444/x",
        ] {
            assert!(community_url(url).is_none(), "{url}");
        }
    }
}
