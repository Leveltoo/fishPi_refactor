//! 聊天室查询、发送与实时事件 DTO。
//!
//! 事件里的 `sessionGeneration` / `connectionGeneration` 由 Bridge 注入，不来自 SDK。
//! `ConnectionEvent.status` 是 Bridge **已证实**的状态，不是 SDK `on_open` 直通；
//! SDK 1.1.0 的 `ChatRoomConnection` 未公开 open/close/error，观测不到就标 [`ConnectionStatus::Unknown`]。

use fishpi_sdk::domain::chatroom::{ChatRoomEvent, ChatRoomMessageMode, OnlineInfo};
use fishpi_sdk::domain::redpacket::RedPacketStatusMsg;
use serde::{Deserialize, Serialize};

use super::message::ChatMessageDto;

/// 在线列表中的用户摘要。不含主页 URL 等 P0 用不到的字段。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OnlineUser {
    pub user_name: String,
    pub user_avatar_url: String,
}

impl From<&OnlineInfo> for OnlineUser {
    fn from(user: &OnlineInfo) -> Self {
        Self {
            user_name: user.user_name.clone(),
            user_avatar_url: user.user_avatar_url.clone(),
        }
    }
}

impl From<OnlineInfo> for OnlineUser {
    fn from(user: OnlineInfo) -> Self {
        Self::from(&user)
    }
}

/// `chatroom://online`
///
/// `onlineCount` 必须用服务端 `onlineChatCnt` / `onlineCnt`。
/// **不得**用 `users.len()` 覆盖：列表可能被截断或为空，长度不是官方在线人数。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OnlineEvent {
    pub session_generation: u64,
    pub connection_generation: u64,
    pub users: Vec<OnlineUser>,
    /// `None` 表示本帧未带话题；清空话题走 [`DiscussEvent`] 的空字符串。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub discussing: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub online_count: Option<u64>,
}

impl OnlineEvent {
    /// `online_chat_cnt` 原样映射为 `onlineCount`，缺省就是 `None`，不用列表长度填。
    pub fn from_sdk(
        session_generation: u64,
        connection_generation: u64,
        users: Vec<OnlineInfo>,
        discussing: Option<String>,
        online_chat_cnt: Option<usize>,
    ) -> Self {
        Self {
            session_generation,
            connection_generation,
            users: users.iter().map(OnlineUser::from).collect(),
            discussing,
            online_count: online_chat_cnt.map(|count| count as u64),
        }
    }
}

/// `chatroom://discuss`。空字符串表示清空话题，这是合法状态。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscussEvent {
    pub session_generation: u64,
    pub connection_generation: u64,
    pub discussing: String,
}

impl DiscussEvent {
    pub fn new(
        session_generation: u64,
        connection_generation: u64,
        discussing: impl Into<String>,
    ) -> Self {
        Self {
            session_generation,
            connection_generation,
            discussing: discussing.into(),
        }
    }
}

/// `chatroom://revoke`。允许先于对应历史消息到达；前端按 ID 打撤回标记。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RevokeEvent {
    pub session_generation: u64,
    pub connection_generation: u64,
    pub message_id: String,
}

impl RevokeEvent {
    pub fn new(
        session_generation: u64,
        connection_generation: u64,
        message_id: impl Into<String>,
    ) -> Self {
        Self {
            session_generation,
            connection_generation,
            message_id: message_id.into(),
        }
    }
}

/// `chatroom://redpacket-status`。P0 UI 可忽略，字段留给 P1 状态合并。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RedpacketStatusEvent {
    pub session_generation: u64,
    pub connection_generation: u64,
    pub message_id: String,
    pub count: u32,
    pub got: u32,
    pub who_give: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub who_got: Vec<String>,
}

impl RedpacketStatusEvent {
    pub fn from_status(
        session_generation: u64,
        connection_generation: u64,
        status: RedPacketStatusMsg,
    ) -> Self {
        Self {
            session_generation,
            connection_generation,
            message_id: status.o_id.to_string(),
            count: status.count,
            got: status.got,
            who_give: status.who_give,
            who_got: status.who_got,
        }
    }
}

/// Bridge 已证实的连接状态。未知就必须是 `unknown`，不能用「暂时没消息」推断离线。
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionStatus {
    Connecting,
    Connected,
    Unknown,
    Disconnected,
    Reconnecting,
}

/// `chatroom://connection`，也可作为 `chatroom_connect` 的返回值。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionEvent {
    pub session_generation: u64,
    pub connection_generation: u64,
    pub status: ConnectionStatus,
}

impl ConnectionEvent {
    pub fn new(
        session_generation: u64,
        connection_generation: u64,
        status: ConnectionStatus,
    ) -> Self {
        Self {
            session_generation,
            connection_generation,
            status,
        }
    }
}

/// `chatroom://msg` 载荷：与历史相同的 [`ChatMessageDto`]，外加会话/连接代次。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageEvent {
    pub session_generation: u64,
    pub connection_generation: u64,
    #[serde(flatten)]
    pub message: ChatMessageDto,
}

impl ChatMessageEvent {
    pub fn new(
        session_generation: u64,
        connection_generation: u64,
        message: ChatMessageDto,
    ) -> Self {
        Self {
            session_generation,
            connection_generation,
            message,
        }
    }

    /// 把 SDK 实时事件中的消息类变体打上代次；非消息事件返回 `None`。
    pub fn from_chat_event(
        session_generation: u64,
        connection_generation: u64,
        event: ChatRoomEvent,
    ) -> Option<Self> {
        ChatMessageDto::from_event(event)
            .map(|message| Self::new(session_generation, connection_generation, message))
    }
}

/// 历史锚点方位，对应 SDK [`ChatRoomMessageMode`]。
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HistoryMode {
    Before,
    After,
    Context,
}

impl From<HistoryMode> for ChatRoomMessageMode {
    fn from(mode: HistoryMode) -> Self {
        match mode {
            HistoryMode::Before => Self::Before,
            HistoryMode::After => Self::After,
            HistoryMode::Context => Self::Context,
        }
    }
}

/// `chatroom_history` 查询。
///
/// `page` 与 `aroundId` 互斥：有页码走 `history(page, Markdown)`，
/// 有锚点走 `msg_around(id, mode, size, Markdown)`。优先 Markdown，不要默认 HTML。
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryQuery {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub around_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<HistoryMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u32>,
}

impl HistoryQuery {
    /// 同时给了页码和锚点即为非法，command 应返回 business 错误。
    pub fn has_conflicting_cursors(&self) -> bool {
        self.page.is_some() && self.has_around_id()
    }

    pub fn has_around_id(&self) -> bool {
        self.around_id
            .as_deref()
            .is_some_and(|id| !id.trim().is_empty())
    }
}

/// 历史查询结果。`exhausted` 表示这一方向没有更多消息（例如空页）。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryResult {
    pub session_generation: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_generation: Option<u64>,
    pub messages: Vec<ChatMessageDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exhausted: Option<bool>,
}

/// 发送入参。成功不带服务端消息 ID，不要在本地伪造已确认气泡。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SendRequest {
    pub content: String,
}

/// 发送结果。`accepted` 只表示请求已被接受；超时且无法确认服务端结果时 `outcomeUnknown`。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    pub session_generation: u64,
    pub accepted: bool,
    pub outcome_unknown: bool,
}

impl SendResult {
    pub fn accepted(session_generation: u64) -> Self {
        Self {
            session_generation,
            accepted: true,
            outcome_unknown: false,
        }
    }

    pub fn outcome_unknown(session_generation: u64) -> Self {
        Self {
            session_generation,
            accepted: false,
            outcome_unknown: true,
        }
    }
}

/// 撤回入参。消息 ID 必须是字符串。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RevokeRequest {
    pub message_id: String,
}
