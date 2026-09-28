//! 聊天室实时转发：把 SDK `ChatRoomEvent` 映到计划中的 `chatroom://*` 事件。
//!
//! # 为何 connection 不是 SDK 生命周期直通
//!
//! SDK 1.1.0 的 `ChatRoomConnection` **没有**公开 `on_open` / `on_close` / `on_error`。
//! 底层 `WebSocketClient` 虽有这些钩子，但没有从连接句柄暴露出来。
//! `set_log_hook` 只是字符串日志，**不能**当成正式连接协议去解析 “connected / disconnected”。
//!
//! 因此 `chatroom://connection` 只发 Bridge **已经证实**的状态：
//! - `connect()` 返回成功 → 可以发 `Connected`（命令本身证明刚建连成功）
//! - 本进程调用 `disconnect()` → 可以发 `Disconnected`
//! - 运行中掉线、SDK 内部重连成功/失败 → **观测不到**，保持 `Unknown`，不要装
//!
//! # 首包窗口
//!
//! `ChatRoomApi::connect()` 先建立底层 WS，再把句柄返回给调用方注册监听。
//! 在返回与 `on_all` 注册之间，以及 SDK 内部更早的窗口里，首包（常见是 `online`）可能已经到了。
//! 前端 `listen` 先于 `invoke connect` **不能**消除这段 SDK 窗口；我们能做的是：
//! 在把 command 结果交回前端之前注册完 `on_all`，并给每条事件打上代次，供前端暂存/丢弃。
//!
//! # 监听范围
//!
//! 必须用 `on_all`，不要只听 `on_msg`：音乐、天气是独立 kind，只听普通消息会丢。
//! 未知 WS `type` 在 SDK 解析层会变成 decode 错误并丢包，到不了本模块；
//! 本模块仍把映射/emit 包在 catch 里，避免我们自己的转换把消息流打崩。
//!
//! # 锁
//!
//! 回调里只短暂读取代次，立刻放开 `AppState`；映射和 `emit` 都不持锁。

use std::panic::{self, AssertUnwindSafe};

use fishpi_sdk::client::{ChatConnection, ChatRoomConnection, NoticeConnection};
use fishpi_sdk::domain::chat::{ChatData, ChatNotice, ChatRevoke};
use fishpi_sdk::domain::chatroom::ChatRoomEvent;
use fishpi_sdk::domain::notice::NoticeMsg;
use tauri::{AppHandle, Emitter, Manager};

use crate::dto::{
    ChatMessageDto, ChatMessageEvent, ChatNoticeEvent, ChatRevokeEvent, ConnectionEvent,
    ConnectionStatus, DiscussEvent, NoticeBroadcastEvent, OnlineEvent, PrivateChatMessageEvent,
    RedpacketStatusEvent, RevokeEvent,
};
use crate::state::AppState;

/// `chatroom://online`：在线列表、可选人数、本帧话题。人数只用事件里的 `onlineChatCnt`。
pub const EVENT_ONLINE: &str = "chatroom://online";
/// `chatroom://discuss`：独立话题更新，空字符串表示清空。
pub const EVENT_DISCUSS: &str = "chatroom://discuss";
/// `chatroom://msg`：普通/音乐/天气/红包/弹幕/进出场，统一 [`ChatMessageDto`] + `kind`。
pub const EVENT_MSG: &str = "chatroom://msg";
/// `chatroom://revoke`：按消息 ID 撤回，允许先于历史到达。
pub const EVENT_REVOKE: &str = "chatroom://revoke";
/// `chatroom://redpacket-status`：领取进度。P0 UI 可忽略。
pub const EVENT_REDPACKET_STATUS: &str = "chatroom://redpacket-status";
/// `chatroom://connection`：仅 Bridge 已证实的连接状态。
pub const EVENT_CONNECTION: &str = "chatroom://connection";

/// 在返回 `chatroom_connect` 之前调用：用 `on_all` 挂上转发，尽量缩短（但不能消除）首包窗口。
pub async fn attach_chatroom_forwarder(
    app: &AppHandle,
    connection: &ChatRoomConnection,
    session_generation: u64,
    connection_generation: u64,
) {
    let app = app.clone();
    connection
        .on_all(move |event| {
            forward_chatroom_event(&app, session_generation, connection_generation, event);
        })
        .await;
}

/// 核心层骨架名。实际仍是 `on_all` 注册，必须在 command 返回前 `await` 完成。
pub async fn spawn_chatroom_forwarders(
    app: AppHandle,
    connection: &ChatRoomConnection,
    session_generation: u64,
    connection_generation: u64,
) {
    attach_chatroom_forwarder(
        &app,
        connection,
        session_generation,
        connection_generation,
    )
    .await;
}

/// 发出一条 Bridge 已证实的连接状态。调用方必须保证这个状态确实被证实过。
pub fn emit_connection_status(
    app: &AppHandle,
    session_generation: u64,
    connection_generation: u64,
    status: ConnectionStatus,
) {
    let payload = ConnectionEvent::new(session_generation, connection_generation, status);
    let _ = app.emit(EVENT_CONNECTION, payload);
}

fn forward_chatroom_event(
    app: &AppHandle,
    session_generation: u64,
    connection_generation: u64,
    event: ChatRoomEvent,
) {
    if !generations_are_current(app, session_generation, connection_generation) {
        return;
    }

    // SDK 解析失败只是单包 decode；我们自己的映射/序列化也不得让后续消息停掉。
    let app = app.clone();
    let _ = panic::catch_unwind(AssertUnwindSafe(move || {
        dispatch_chatroom_event(&app, session_generation, connection_generation, event);
    }));
}

fn generations_are_current(
    app: &AppHandle,
    session_generation: u64,
    connection_generation: u64,
) -> bool {
    let state = app.state::<AppState>();
    let current_session = state.session_generation();
    let current_connection = state.connection_generation();
    current_session == session_generation && current_connection == connection_generation
}

fn dispatch_chatroom_event(
    app: &AppHandle,
    session_generation: u64,
    connection_generation: u64,
    event: ChatRoomEvent,
) {
    match event {
        ChatRoomEvent::Online {
            users,
            discussing,
            online_chat_cnt,
        } => {
            // onlineCount 只用事件字段；空 users 时 SDK 内部缓存可能不更新，这里以本帧为准。
            let payload = OnlineEvent::from_sdk(
                session_generation,
                connection_generation,
                users,
                discussing,
                online_chat_cnt,
            );
            let _ = app.emit(EVENT_ONLINE, payload);
        }
        ChatRoomEvent::DiscussChanged(discussing) => {
            let payload = DiscussEvent::new(session_generation, connection_generation, discussing);
            let _ = app.emit(EVENT_DISCUSS, payload);
        }
        ChatRoomEvent::Revoke(message_id) => {
            let payload = RevokeEvent::new(session_generation, connection_generation, message_id);
            let _ = app.emit(EVENT_REVOKE, payload);
        }
        ChatRoomEvent::RedPacketStatus(status) => {
            let payload = RedpacketStatusEvent::from_status(
                session_generation,
                connection_generation,
                status,
            );
            let _ = app.emit(EVENT_REDPACKET_STATUS, payload);
        }
        ChatRoomEvent::Msg(msg) => emit_message(app, session_generation, connection_generation, msg),
        ChatRoomEvent::Music(msg) => {
            emit_message(app, session_generation, connection_generation, msg)
        }
        ChatRoomEvent::Weather(msg) => {
            emit_message(app, session_generation, connection_generation, msg)
        }
        ChatRoomEvent::RedPacket(msg) => {
            emit_message(app, session_generation, connection_generation, msg)
        }
        ChatRoomEvent::Barrager(msg) => {
            emit_message(app, session_generation, connection_generation, msg)
        }
        ChatRoomEvent::Custom(msg) => {
            emit_message(app, session_generation, connection_generation, msg)
        }
        ChatRoomEvent::ChatReaction(_) => {
            // P0 明确忽略表态；P1 再按消息 ID 合并 reaction_summary。
        }
    }
}

fn emit_message(
    app: &AppHandle,
    session_generation: u64,
    connection_generation: u64,
    message: impl Into<ChatMessageDto>,
) {
    let payload = ChatMessageEvent::new(session_generation, connection_generation, message.into());
    let _ = app.emit(EVENT_MSG, payload);
}

/// `chat://msg`
pub const EVENT_CHAT_MSG: &str = "chat://msg";
/// `chat://notice`：私聊频道上的系统通知（未读刷新 / 闲置新消息）。
pub const EVENT_CHAT_NOTICE: &str = "chat://notice";
/// `chat://revoke`
pub const EVENT_CHAT_REVOKE: &str = "chat://revoke";
/// `notice://refresh`：来自 `notice().connect()` 的刷新通知数。
pub const EVENT_NOTICE_REFRESH: &str = "notice://refresh";
/// `notice://broadcast`：全局公告。
pub const EVENT_NOTICE_BROADCAST: &str = "notice://broadcast";

/// 在返回 `chat_connect` 之前注册完私聊监听。`peer_user` 为 `None` 表示全局频道。
pub async fn attach_chat_forwarder(
    app: &AppHandle,
    connection: &ChatConnection,
    session_generation: u64,
    connection_generation: u64,
    peer_user: Option<String>,
) {
    let app_data = app.clone();
    let peer_data = peer_user.clone();
    connection
        .on_data(move |data| {
            forward_chat_data(
                &app_data,
                session_generation,
                connection_generation,
                peer_data.clone(),
                data,
            );
        })
        .await;

    let app_notice = app.clone();
    connection
        .on_notice(move |notice| {
            forward_chat_notice(&app_notice, session_generation, connection_generation, notice);
        })
        .await;

    let app_revoke = app.clone();
    let peer_revoke = peer_user;
    connection
        .on_revoke(move |revoke| {
            forward_chat_revoke(
                &app_revoke,
                session_generation,
                connection_generation,
                peer_revoke.clone(),
                revoke,
            );
        })
        .await;
}

/// 在返回 connect 之前注册完通知监听。
pub async fn attach_notice_forwarder(
    app: &AppHandle,
    connection: &NoticeConnection,
    session_generation: u64,
    notice_generation: u64,
) {
    let app_refresh = app.clone();
    connection
        .on_refresh(move |msg| {
            forward_notice_refresh(&app_refresh, session_generation, notice_generation, msg);
        })
        .await;

    let app_broadcast = app.clone();
    connection
        .on_broadcast(move |msg| {
            forward_notice_broadcast(&app_broadcast, session_generation, notice_generation, msg);
        })
        .await;
}

fn chat_generations_are_current(
    app: &AppHandle,
    session_generation: u64,
    connection_generation: u64,
    peer_user: Option<&str>,
) -> bool {
    let state = app.state::<AppState>();
    if state.session_generation() != session_generation {
        return false;
    }
    match peer_user {
        Some(user) => state.user_chat_generation(user) == Some(connection_generation),
        None => state.global_chat_generation() == Some(connection_generation),
    }
}

fn notice_generations_are_current(
    app: &AppHandle,
    session_generation: u64,
    notice_generation: u64,
) -> bool {
    let state = app.state::<AppState>();
    state.session_generation() == session_generation
        && state.notice_generation() == Some(notice_generation)
}

fn forward_chat_data(
    app: &AppHandle,
    session_generation: u64,
    connection_generation: u64,
    peer_user: Option<String>,
    data: ChatData,
) {
    if !chat_generations_are_current(
        app,
        session_generation,
        connection_generation,
        peer_user.as_deref(),
    ) {
        return;
    }
    let app = app.clone();
    let _ = panic::catch_unwind(AssertUnwindSafe(move || {
        let payload = PrivateChatMessageEvent::from_data(
            session_generation,
            connection_generation,
            peer_user,
            data,
        );
        let _ = app.emit(EVENT_CHAT_MSG, payload);
    }));
}

fn forward_chat_notice(
    app: &AppHandle,
    session_generation: u64,
    connection_generation: u64,
    notice: ChatNotice,
) {
    // 全局频道与用户频道都可能推 notice；代次按「这条连接是否仍在」过滤。
    let state = app.state::<AppState>();
    if state.session_generation() != session_generation {
        return;
    }
    let still_live = state.global_chat_generation() == Some(connection_generation)
        || state
            .user_chat_generation(notice.sender_user_name.as_str())
            .is_some_and(|gen| gen == connection_generation);
    if !still_live {
        return;
    }
    let app = app.clone();
    let _ = panic::catch_unwind(AssertUnwindSafe(move || {
        let payload = ChatNoticeEvent::from_chat_notice(session_generation, connection_generation, notice);
        let _ = app.emit(EVENT_CHAT_NOTICE, payload);
    }));
}

fn forward_chat_revoke(
    app: &AppHandle,
    session_generation: u64,
    connection_generation: u64,
    peer_user: Option<String>,
    revoke: ChatRevoke,
) {
    if !chat_generations_are_current(
        app,
        session_generation,
        connection_generation,
        peer_user.as_deref(),
    ) {
        return;
    }
    let app = app.clone();
    let _ = panic::catch_unwind(AssertUnwindSafe(move || {
        let payload = ChatRevokeEvent::new(session_generation, connection_generation, revoke.id, peer_user);
        let _ = app.emit(EVENT_CHAT_REVOKE, payload);
    }));
}

fn forward_notice_refresh(
    app: &AppHandle,
    session_generation: u64,
    notice_generation: u64,
    msg: NoticeMsg,
) {
    if !notice_generations_are_current(app, session_generation, notice_generation) {
        return;
    }
    let app = app.clone();
    let _ = panic::catch_unwind(AssertUnwindSafe(move || {
        let payload = ChatNoticeEvent::refresh(session_generation, notice_generation, msg.command);
        let _ = app.emit(EVENT_NOTICE_REFRESH, payload);
    }));
}

fn forward_notice_broadcast(
    app: &AppHandle,
    session_generation: u64,
    notice_generation: u64,
    msg: NoticeMsg,
) {
    if !notice_generations_are_current(app, session_generation, notice_generation) {
        return;
    }
    let app = app.clone();
    let _ = panic::catch_unwind(AssertUnwindSafe(move || {
        let payload = NoticeBroadcastEvent::from_msg(session_generation, notice_generation, msg);
        let _ = app.emit(EVENT_NOTICE_BROADCAST, payload);
    }));
}
