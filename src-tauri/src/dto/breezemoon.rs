//! 清风明月 DTO。正文只给剥过的纯文本。

use fishpi_sdk::domain::breezemoon::Breezemoon;
use serde::{Deserialize, Serialize};

use crate::text::{html_to_text, nonempty_text};

/// `breezemoon_list` 查询。
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BreezemoonListQuery {
    #[serde(default)]
    pub page: Option<u32>,
    #[serde(default)]
    pub size: Option<u32>,
    #[serde(default, alias = "user")]
    pub user_name: Option<String>,
}

/// 列表结果。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BreezemoonListResult {
    pub session_generation: u64,
    pub items: Vec<BreezemoonDto>,
    pub exhausted: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BreezemoonDto {
    pub id: String,
    pub author_name: String,
    pub author_avatar_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    pub content: String,
    pub city: String,
    pub time: String,
    pub time_ago: String,
    pub created: String,
}

impl From<Breezemoon> for BreezemoonDto {
    fn from(item: Breezemoon) -> Self {
        let content = html_to_text(&item.content);
        let text = nonempty_text(&content);
        let time = if item.time_ago.trim().is_empty() {
            item.create_time.clone()
        } else {
            item.time_ago.clone()
        };
        Self {
            id: item.id,
            author_name: item.author_name,
            author_avatar_url: item.author_avatar,
            text,
            content,
            city: item.city,
            time,
            time_ago: item.time_ago,
            created: if item.created.trim().is_empty() {
                item.create_time
            } else {
                item.created
            },
        }
    }
}

/// `breezemoon_send` 入参。写操作，成功不带 ID。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BreezemoonSendRequest {
    pub content: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dto_camel_case_string_id() {
        let dto = BreezemoonDto {
            id: "123".into(),
            author_name: "alice".into(),
            author_avatar_url: "".into(),
            text: Some("hi".into()),
            content: "hi".into(),
            city: "上海".into(),
            time: "刚刚".into(),
            time_ago: "刚刚".into(),
            created: "1".into(),
        };
        let value = serde_json::to_value(&dto).expect("serialize");
        assert_eq!(value["authorName"], "alice");
        assert_eq!(value["authorAvatarUrl"], "");
        assert_eq!(value["id"], "123");
        assert_eq!(value["content"], "hi");
        assert_eq!(value["timeAgo"], "刚刚");
    }
}
