//! 私聊 IPC：列表、未读、历史、发送、已读、连接、撤回。
//!
//! `chat_send` **必须**走已建立的 `ChatConnection::send`。没有连接时报业务错，
//! 不用 HTTP 假装成功。成功形状学 [`crate::dto::SendResult`]：不带消息 ID。
//!
//! `userName` 缺省的 `chat_connect` 连全局 user-channel；同时尽量拉起通知连接，
//! 以便 `notice://refresh` / `notice://broadcast` 在 connect 返回前已挂好监听。

use fishpi_sdk::client::ChatConnection;
use fishpi_sdk::utils::error::Error as SdkError;
use tauri::{AppHandle, State};

use crate::commands::common::{
    ensure_same_session, is_uncertain_write, map_send_result, require_client, require_nonempty,
};
use crate::commands::notice::ensure_notice_connected;
use crate::dto::{
    ChatConnectRequest, ChatConnectResult, ChatConversationDto, ChatHistoryQuery,
    ChatHistoryResult, ChatListResult, ChatRevokeRequest, ChatSendRequest, ChatUnreadResult,
    PrivateMessageDto, SendResult,
};
use crate::error::AppError;
use crate::realtime::attach_chat_forwarder;
use crate::state::AppState;

const DEFAULT_HISTORY_PAGE: u32 = 1;
const DEFAULT_HISTORY_SIZE: u32 = 20;

/// 私聊会话列表。每条 `unread` 为 0，未读数由 `chat_unread` 另拉。
#[tauri::command(rename_all = "camelCase")]
pub async fn chat_list(state: State<'_, AppState>) -> Result<ChatListResult, AppError> {
    let (client, session_generation) = require_client(&state)?;
    let list = client.chat().list().await?;
    ensure_same_session(&state, session_generation)?;
    Ok(ChatListResult {
        session_generation,
        conversations: list
            .into_iter()
            .map(|item| ChatConversationDto::from_data(item, 0))
            .collect(),
    })
}

/// 未读私聊。每条至少记 1，由前端按对端累加。
#[tauri::command(rename_all = "camelCase")]
pub async fn chat_unread(state: State<'_, AppState>) -> Result<ChatUnreadResult, AppError> {
    let (client, session_generation) = require_client(&state)?;
    let list = client.chat().unread().await?;
    ensure_same_session(&state, session_generation)?;
    Ok(ChatUnreadResult {
        session_generation,
        messages: list
            .into_iter()
            .map(|item| ChatConversationDto::from_data(item, 1))
            .collect(),
    })
}

/// 与指定用户的历史。`autoread` 固定 false，已读由前端另调 `chat_mark_read`。
#[tauri::command(rename_all = "camelCase")]
pub async fn chat_history(
    state: State<'_, AppState>,
    query: ChatHistoryQuery,
) -> Result<ChatHistoryResult, AppError> {
    let user_name = require_nonempty(&query.user_name, "用户名不能为空")?;
    let page = query.page.unwrap_or(DEFAULT_HISTORY_PAGE);
    if page == 0 {
        return Err(AppError::business("page 必须从 1 开始"));
    }
    let size = query.size.unwrap_or(DEFAULT_HISTORY_SIZE);
    if size == 0 {
        return Err(AppError::business("size 必须大于 0"));
    }

    let (client, session_generation) = require_client(&state)?;
    let messages = client
        .chat()
        .history(user_name, page, size, false)
        .await?;
    ensure_same_session(&state, session_generation)?;
    let exhausted = messages.is_empty() || (messages.len() as u32) < size;
    Ok(ChatHistoryResult {
        session_generation,
        messages: messages.into_iter().map(PrivateMessageDto::from).collect(),
        exhausted: Some(exhausted),
    })
}

/// 经该用户已建立的长连接发送。没有连接不走 HTTP。
#[tauri::command(rename_all = "camelCase")]
pub async fn chat_send(
    state: State<'_, AppState>,
    request: ChatSendRequest,
) -> Result<SendResult, AppError> {
    let user_name = require_nonempty(&request.user_name, "用户名不能为空")?;
    let content = require_nonempty(&request.content, "消息内容不能为空")?;
    let (_, session_generation) = require_client(&state)?;
    let queued = state.send_user_chat(&user_name, &content)?;
    ensure_same_session(&state, session_generation)?;
    map_send_result(session_generation, queued)
}

/// 标记与某用户的私聊为已读。写操作，超时走 `outcome_unknown`。
#[tauri::command(rename_all = "camelCase")]
pub async fn chat_mark_read(
    state: State<'_, AppState>,
    request: ChatConnectRequest,
) -> Result<(), AppError> {
    let user_name = request
        .peer_user()
        .ok_or_else(|| AppError::business("用户名不能为空"))?;
    let (client, session_generation) = require_client(&state)?;
    let result = client.chat().mark_as_read(user_name).await;
    ensure_same_session(&state, session_generation)?;
    map_mark_read(result)
}

/// 同一会话内按用户幂等建连。`userName` 缺省 = 全局 user-channel。
#[tauri::command(rename_all = "camelCase")]
pub async fn chat_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ChatConnectRequest,
) -> Result<ChatConnectResult, AppError> {
    match request.peer_user() {
        Some(user) => connect_user(&app, &state, user).await,
        None => {
            let result = connect_global(&app, &state).await?;
            let _ = ensure_notice_connected(&app, &state).await;
            Ok(result)
        }
    }
}

/// 幂等断开。`userName` 缺省断开全局频道，不拆其他用户连接。
#[tauri::command(rename_all = "camelCase")]
pub async fn chat_disconnect(
    state: State<'_, AppState>,
    request: ChatConnectRequest,
) -> Result<(), AppError> {
    match request.peer_user() {
        Some(user) => {
            if let Some(mut connection) = state.take_user_chat(&user) {
                connection.disconnect();
            }
        }
        None => {
            if let Some(mut connection) = state.take_global_chat() {
                connection.disconnect();
            }
        }
    }
    Ok(())
}

/// 按消息 ID 撤回私聊。超时且不确定时 `outcome_unknown`，不自动重试。
#[tauri::command(rename_all = "camelCase")]
pub async fn chat_revoke(
    state: State<'_, AppState>,
    request: ChatRevokeRequest,
) -> Result<(), AppError> {
    let message_id = require_nonempty(&request.message_id, "撤回消息 ID 不能为空")?;
    let (client, session_generation) = require_client(&state)?;
    let result = client.chat().revoke(message_id).await;
    ensure_same_session(&state, session_generation)?;
    map_revoke(result)
}

async fn connect_user(
    app: &AppHandle,
    state: &AppState,
    user: String,
) -> Result<ChatConnectResult, AppError> {
    if state.has_user_chat(&user) {
        return Ok(current_user_snapshot(state, &user));
    }

    let (client, session_generation) = require_client(state)?;
    let Some(generation) = state.reserve_user_chat(&user, session_generation)? else {
        return Ok(current_user_snapshot(state, &user));
    };

    let mut connection = match client.chat().connect(Some(&user)).await {
        Ok(connection) => connection,
        Err(err) => {
            state.cancel_pending_user_chat(&user, generation);
            return Err(AppError::from(err));
        }
    };

    if let Some(snapshot) = abort_user_if_unusable(state, &user, session_generation, generation, &mut connection)?
    {
        return Ok(snapshot);
    }

    attach_chat_forwarder(app, &connection, session_generation, generation, Some(user.clone()))
        .await;

    if state.session_generation() != session_generation {
        state.cancel_pending_user_chat(&user, generation);
        connection.disconnect();
        return Err(AppError::session_superseded());
    }

    match state.install_user_chat(&user, session_generation, generation, connection) {
        Ok(installed) => Ok(ChatConnectResult::new(session_generation, installed)),
        Err(mut rejected) => {
            rejected.disconnect();
            if state.has_user_chat(&user) {
                return Ok(current_user_snapshot(state, &user));
            }
            Err(AppError::session_superseded())
        }
    }
}

async fn connect_global(
    app: &AppHandle,
    state: &AppState,
) -> Result<ChatConnectResult, AppError> {
    if state.has_global_chat() {
        return Ok(current_global_snapshot(state));
    }

    let (client, session_generation) = require_client(state)?;
    let Some(generation) = state.reserve_global_chat(session_generation)? else {
        return Ok(current_global_snapshot(state));
    };

    let mut connection = match client.chat().connect(None).await {
        Ok(connection) => connection,
        Err(err) => {
            state.cancel_pending_global_chat(generation);
            return Err(AppError::from(err));
        }
    };

    if let Some(snapshot) = abort_global_if_unusable(state, session_generation, generation, &mut connection)?
    {
        return Ok(snapshot);
    }

    attach_chat_forwarder(app, &connection, session_generation, generation, None).await;

    if state.session_generation() != session_generation {
        state.cancel_pending_global_chat(generation);
        connection.disconnect();
        return Err(AppError::session_superseded());
    }

    match state.install_global_chat(session_generation, generation, connection) {
        Ok(installed) => Ok(ChatConnectResult::new(session_generation, installed)),
        Err(mut rejected) => {
            rejected.disconnect();
            if state.has_global_chat() {
                return Ok(current_global_snapshot(state));
            }
            Err(AppError::session_superseded())
        }
    }
}

fn current_user_snapshot(state: &AppState, user: &str) -> ChatConnectResult {
    ChatConnectResult::new(
        state.session_generation(),
        state.user_chat_generation(user).unwrap_or(0),
    )
}

fn current_global_snapshot(state: &AppState) -> ChatConnectResult {
    ChatConnectResult::new(
        state.session_generation(),
        state.global_chat_generation().unwrap_or(0),
    )
}

fn abort_user_if_unusable(
    state: &AppState,
    user: &str,
    expected_session: u64,
    generation: u64,
    connection: &mut ChatConnection,
) -> Result<Option<ChatConnectResult>, AppError> {
    if state.session_generation() != expected_session {
        state.cancel_pending_user_chat(user, generation);
        connection.disconnect();
        return Err(AppError::session_superseded());
    }
    if state.user_chat_generation(user) != Some(generation) && state.has_user_chat(user) {
        state.cancel_pending_user_chat(user, generation);
        connection.disconnect();
        return Ok(Some(current_user_snapshot(state, user)));
    }
    Ok(None)
}

fn abort_global_if_unusable(
    state: &AppState,
    expected_session: u64,
    generation: u64,
    connection: &mut ChatConnection,
) -> Result<Option<ChatConnectResult>, AppError> {
    if state.session_generation() != expected_session {
        state.cancel_pending_global_chat(generation);
        connection.disconnect();
        return Err(AppError::session_superseded());
    }
    if state.global_chat_generation() != Some(generation) && state.has_global_chat() {
        state.cancel_pending_global_chat(generation);
        connection.disconnect();
        return Ok(Some(current_global_snapshot(state)));
    }
    Ok(None)
}

fn map_mark_read(result: Result<bool, SdkError>) -> Result<(), AppError> {
    match result {
        Ok(_) => Ok(()),
        Err(err) if is_uncertain_write(&err) => Err(AppError::outcome_unknown()),
        Err(err) => Err(AppError::from(err)),
    }
}

fn map_revoke(result: Result<bool, SdkError>) -> Result<(), AppError> {
    match result {
        Ok(_) => Ok(()),
        Err(err) if is_uncertain_write(&err) => Err(AppError::outcome_unknown()),
        Err(err) => Err(AppError::from(err)),
    }
}
