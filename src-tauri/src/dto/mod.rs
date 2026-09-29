//! 桌面端前后端契约（DTO）。
//!
//! SDK 的 domain 类型大多没有 `Serialize`，且可能夹带内部细节或凭据相关字段。
//! Bridge 只把当前阶段真正用到的字段映射成 camelCase DTO，而不是把 domain 整包丢给 WebView。
//!
//! 约定：
//! - 消息 ID 一律用 [`String`]：服务端 `oId` 是数字字符串，JS `number` 会丢精度。
//! - 业务响应带 `sessionGeneration`；与长连接相关的响应/事件另带 `connectionGeneration`。
//! - **出站** DTO / 事件禁止出现 `apiKey` / `token` / `password` / `mfa`。
//!   [`LoginRequest`] 是唯一允许短暂持有密码与 MFA 的**入参**，且不实现 `Serialize`。
//! - 私聊 / 通知仍给 markdown 或剥过的纯文本。帖子详情正文、评论、清风明月保留富文本
//!   （HTML 或 markdown），由前端 DOMPurify 渲染，禁止在 Bridge 里 html_to_text 丢掉图和链。

pub mod article;
pub mod auth;
pub mod breezemoon;
pub mod chat;
pub mod chatroom;
pub mod message;
pub mod notice;
pub mod redpacket;
pub mod settings;
pub mod user;

pub use article::*;
pub use auth::*;
pub use breezemoon::*;
pub use chat::{
    ChatConnectRequest, ChatConnectResult, ChatConversationDto, ChatHistoryQuery,
    ChatHistoryResult, ChatListResult, ChatNoticeEvent, ChatRevokeEvent, ChatRevokeRequest,
    ChatSendRequest, ChatUnreadResult, ChatUserRequest, PrivateChatMessageEvent,
    PrivateMessageDto,
};
pub use chatroom::*;
pub use message::*;
pub use notice::*;
pub use redpacket::*;
pub use settings::*;
pub use user::*;
