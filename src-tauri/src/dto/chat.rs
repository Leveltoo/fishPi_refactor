//! 私聊 DTO：会话列表、历史、实时事件。消息 ID 用字符串；不含 token。
//!
//! `content` 若是 HTML 会剥成纯文本；优先给 `md`（Markdown）。

use fishpi_sdk::domain::chat::{ChatData, ChatNotice};
use serde::{Deserialize, Serialize};

use crate::text::{markdown_or_none, nonempty_text};

/// 会话列表项。peer 由前端按当前用户与 sender/receiver 推得。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatConversationDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub sender_user_name: String,
    pub receiver_user_name: String,
    pub sender_avatar_url: String,
    pub receiver_avatar_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time: Option<String>,
    pub unread: u32,
}

impl ChatConversationDto {
    pub fn from_data(data: ChatData, unread: u32) -> Self {
        let preview = nonempty_text(&data.preview)
            .or_else(|| markdown_or_none(&data.markdown))
            .or_else(|| nonempty_text(&data.content));
        Self {
            id: nonempty_owned(&data.id),
            sender_user_name: data.sender_user_name,
            receiver_user_name: data.receiver_user_name,
            sender_avatar_url: data.sender_avatar,
            receiver_avatar_url: data.receiver_avatar,
            preview,
            time: nonempty_owned(&data.time),
            unread,
        }
    }
}

/// `chat_list` 结果。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatListResult {
    pub session_generation: u64,
    pub conversations: Vec<ChatConversationDto>,
}

/// `chat_unread` 结果。每条未读会话 `unread` 至少为 1，由前端按对端累加。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatUnreadResult {
    pub session_generation: u64,
    pub messages: Vec<ChatConversationDto>,
}

/// 一条私聊消息（历史与实时同一形状）。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateMessageDto {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub md: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    pub user_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_nickname: Option<String>,
    pub user_avatar_url: String,
    pub time: String,
    pub revoked: bool,
}

impl From<&ChatData> for PrivateMessageDto {
    fn from(data: &ChatData) -> Self {
        let md = markdown_or_none(&data.markdown);
        let text = if md.is_some() {
            None
        } else {
            nonempty_text(&data.content).or_else(|| nonempty_text(&data.preview))
        };
        Self {
            id: data.id.clone(),
            md,
            text,
            user_name: data.sender_user_name.clone(),
            user_nickname: None,
            user_avatar_url: data.sender_avatar.clone(),
            time: data.time.clone(),
            revoked: false,
        }
    }
}

impl From<ChatData> for PrivateMessageDto {
    fn from(data: ChatData) -> Self {
        Self::from(&data)
    }
}

/// `chat_history` 查询。`autoread` 由前端另调 `chat_mark_read`，这里固定 false。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryQuery {
    pub user_name: String,
    #[serde(default)]
    pub page: Option<u32>,
    #[serde(default)]
    pub size: Option<u32>,
}

/// 历史结果。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryResult {
    pub session_generation: u64,
    pub messages: Vec<PrivateMessageDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exhausted: Option<bool>,
}

/// `chat_send` 入参。必须走该用户已建立的 `ChatConnection::send`。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatSendRequest {
    pub user_name: String,
    pub content: String,
}

/// `chat_revoke` 入参。消息 ID 用字符串。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatRevokeRequest {
    #[serde(alias = "id")]
    pub message_id: String,
}

/// 只带对端用户名的请求（已读 / 断开指定连接）。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatUserRequest {
    pub user_name: String,
}

/// `userName` 缺省或空字符串 = 全局通知频道（SDK `chat().connect(None)`）。
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatConnectRequest {
    #[serde(default)]
    pub user_name: Option<String>,
}

impl ChatConnectRequest {
    /// 规范化后的对端用户名；`None` 表示全局频道。
    pub fn peer_user(&self) -> Option<String> {
        self.user_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
    }
}

/// `chat_connect` 返回。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatConnectResult {
    pub session_generation: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_generation: Option<u64>,
}

impl ChatConnectResult {
    pub fn new(session_generation: u64, connection_generation: u64) -> Self {
        Self {
            session_generation,
            connection_generation: Some(connection_generation),
        }
    }
}

/// `chat://msg`（私聊）。与聊天室 [`crate::dto::ChatMessageEvent`] 同名职责不同，故用此前缀。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateChatMessageEvent {
    pub session_generation: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_generation: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_name: Option<String>,
    pub message: PrivateMessageDto,
}

impl PrivateChatMessageEvent {
    pub fn from_data(
        session_generation: u64,
        connection_generation: u64,
        peer_user: Option<String>,
        data: ChatData,
    ) -> Self {
        Self {
            session_generation,
            connection_generation: Some(connection_generation),
            user_name: peer_user,
            message: PrivateMessageDto::from(data),
        }
    }
}

/// `chat://notice` / `notice://refresh` 共用形状（refresh 只填 command）。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatNoticeEvent {
    pub session_generation: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_generation: Option<u64>,
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sender_user_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sender_avatar_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

impl ChatNoticeEvent {
    pub fn from_chat_notice(
        session_generation: u64,
        connection_generation: u64,
        notice: ChatNotice,
    ) -> Self {
        Self {
            session_generation,
            connection_generation: Some(connection_generation),
            command: notice.command,
            count: None,
            sender_user_name: nonempty_owned(&notice.sender_user_name),
            sender_avatar_url: nonempty_owned(&notice.sender_avatar),
            preview: nonempty_text(&notice.preview),
        }
    }

    pub fn refresh(
        session_generation: u64,
        connection_generation: u64,
        command: String,
    ) -> Self {
        Self {
            session_generation,
            connection_generation: Some(connection_generation),
            command,
            count: None,
            sender_user_name: None,
            sender_avatar_url: None,
            preview: None,
        }
    }
}

/// `chat://revoke`
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatRevokeEvent {
    pub session_generation: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_generation: Option<u64>,
    pub message_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_name: Option<String>,
}

impl ChatRevokeEvent {
    pub fn new(
        session_generation: u64,
        connection_generation: u64,
        message_id: impl Into<String>,
        user_name: Option<String>,
    ) -> Self {
        Self {
            session_generation,
            connection_generation: Some(connection_generation),
            message_id: message_id.into(),
            user_name,
        }
    }
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
    use serde_json::json;

    #[test]
    fn conversation_uses_camel_case() {
        let dto = ChatConversationDto {
            id: Some("1".into()),
            sender_user_name: "alice".into(),
            receiver_user_name: "bob".into(),
            sender_avatar_url: "".into(),
            receiver_avatar_url: "".into(),
            preview: Some("hi".into()),
            time: Some("12:00".into()),
            unread: 2,
        };
        let value = serde_json::to_value(&dto).expect("serialize");
        assert_eq!(value["senderUserName"], "alice");
        assert_eq!(value["receiverUserName"], "bob");
        assert_eq!(value["senderAvatarUrl"], "");
        assert_eq!(value["unread"], 2);
    }

    #[test]
    fn private_message_prefers_markdown_not_html() {
        let data = ChatData {
            id: "99".into(),
            to_id: String::new(),
            from_id: String::new(),
            preview: String::new(),
            user_session: String::new(),
            sender_avatar: "a.png".into(),
            sender_user_name: "alice".into(),
            receiver_avatar: String::new(),
            receiver_user_name: "bob".into(),
            markdown: "**hi**".into(),
            content: "<p>hi</p>".into(),
            time: "1".into(),
        };
        let dto = PrivateMessageDto::from(data);
        assert_eq!(dto.md.as_deref(), Some("**hi**"));
        assert!(dto.text.is_none());
        let value = serde_json::to_value(&dto).expect("serialize");
        assert_eq!(value["userName"], "alice");
        assert_eq!(value["userAvatarUrl"], "a.png");
        assert_eq!(value["id"], "99");
    }

    #[test]
    fn html_content_becomes_text() {
        let data = ChatData {
            id: "1".into(),
            to_id: String::new(),
            from_id: String::new(),
            preview: String::new(),
            user_session: String::new(),
            sender_avatar: String::new(),
            sender_user_name: "alice".into(),
            receiver_avatar: String::new(),
            receiver_user_name: "bob".into(),
            markdown: String::new(),
            content: "<p>你好&nbsp;世界</p>".into(),
            time: String::new(),
        };
        let dto = PrivateMessageDto::from(data);
        assert!(dto.md.is_none());
        assert_eq!(dto.text.as_deref(), Some("你好 世界"));
    }

    #[test]
    fn connect_request_empty_user_is_global() {
        let req: ChatConnectRequest =
            serde_json::from_value(json!({ "userName": "  " })).expect("deserialize");
        assert!(req.peer_user().is_none());
    }
}
