//! 聊天室 IPC：连接、断开、发送、历史、撤回。
//!
//! # 首包窗口
//!
//! `client.chatroom().connect().await` 会先建连再返回句柄。句柄到手后、本 command
//! 返回前，必须注册完 `on_all`（见 [`crate::realtime::attach_chatroom_forwarder`]）。
//! 这只能保证「前端收到 connect 结果时，Bridge 侧监听已挂上」，**不能**消除 SDK
//! 内部已经漏掉的首包。
//!
//! # 为何 send 没有本地 echo 冒充成功
//!
//! `chatroom().send()` 成功时不带服务端消息 ID。P0 不得伪造一条「已确认」消息塞进列表，
//! 也不按相同文本去重。`SendResult.accepted = true` 只表示 HTTP 请求被接受；
//! 真实气泡等 WS / 历史里的那条。超时且无法判断服务端是否落库时 `outcomeUnknown`，
//! **禁止自动重试**（HTTP `max_retries` 由认证侧构造客户端时设 0，这里也不再包一层循环）。
//!
//! # 连接状态
//!
//! 见 `realtime.rs`：`Connected` / `Disconnected` 只在 Bridge 能证实的时刻发出。
//! 运行中掉线 SDK 不公开生命周期回调。幂等 `connect` 若已有活句柄，返回 `Connected`
//! 只表示「句柄仍在 Bridge 手中、尚未本地断开」，不是心跳探测。
//!
//! `AppState::reserve_connection_generation` 先占用代次，再 `install_chatroom_connection`
//! 入库（不再二次 bump）。不要另起无条件 WS 重连循环；不要解析 `log_hook` 当连接协议。

use fishpi_sdk::client::ChatRoomConnection;
use fishpi_sdk::domain::chatroom::{ChatContentType, ChatRoomMessageMode, ChatRoomMsg};
use fishpi_sdk::utils::error::Error as SdkError;
use fishpi_sdk::FishPi;
use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::dto::message::safe_css_color;
use crate::dto::{
    ChatMessageDto, ConnectionEvent, ConnectionStatus, HistoryMode, HistoryQuery, HistoryResult,
    RevokeRequest, SendRequest, SendResult,
};
use crate::error::AppError;
use crate::realtime::{attach_chatroom_forwarder, emit_connection_status};
use crate::state::AppState;

/// 锚点补拉未指定 `size` 时的默认条数。有界，不承诺一次拉完整段历史。
const DEFAULT_AROUND_SIZE: u32 = 25;

/// 同一会话内幂等建立聊天室长连接，返回连接代次及已证实状态。
///
/// 已有活句柄时不重建 socket。新建：网络 `connect` 不持锁 → 校验代次 →
/// **先 reserve 连接代次再 `on_all`** → `install_chatroom_connection`（不再二次 bump）→ 发 `Connected`。
/// 必须先 reserve：转发回调按当前代次过滤，若等入库才 bump，attach 到入库之间的首包会被丢掉。
#[tauri::command(rename_all = "camelCase")]
pub async fn chatroom_connect(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ConnectionEvent, AppError> {
    if state.has_chatroom_connection() {
        return Ok(current_connection_snapshot(&state));
    }

    let (client, session_generation) = require_client(&state)?;
    let mut connection = client.chatroom().connect().await?;

    if let Some(snapshot) = abort_if_unusable(&state, session_generation, &mut connection)? {
        return Ok(snapshot);
    }

    let reserved_generation = state.reserve_connection_generation();
    attach_chatroom_forwarder(&app, &connection, session_generation, reserved_generation)
        .await;

    if state.session_generation() != session_generation {
        connection.disconnect();
        return Err(AppError::session_superseded());
    }

    match state.install_chatroom_connection(reserved_generation, connection) {
        Ok(installed) => {
            if let Some(mut previous) = installed.previous_chatroom {
                previous.disconnect();
            }

            emit_connection_status(
                &app,
                session_generation,
                installed.connection_generation,
                ConnectionStatus::Connected,
            );

            Ok(ConnectionEvent::new(
                session_generation,
                installed.connection_generation,
                ConnectionStatus::Connected,
            ))
        }
        Err(mut rejected) => {
            rejected.disconnect();
            if state.has_chatroom_connection() {
                return Ok(current_connection_snapshot(&state));
            }
            Err(AppError::session_superseded())
        }
    }
}

/// 幂等断开聊天室。`take_chatroom_connection` 会作废连接代次；无连接时不补发事件。
#[tauri::command(rename_all = "camelCase")]
pub async fn chatroom_disconnect(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let session_generation = state.session_generation();
    let connection_generation = state.connection_generation();
    if let Some(mut connection) = state.take_chatroom_connection() {
        connection.disconnect();
        emit_connection_status(
            &app,
            session_generation,
            connection_generation,
            ConnectionStatus::Disconnected,
        );
    }

    Ok(())
}

/// 发送聊天室消息。成功不带消息 ID：`accepted` 不是「列表里已经有这条」。
///
/// 写操作禁止自动重试。超时或中途断连、无法判断服务端是否落库时返回
/// `outcomeUnknown`，由前端提示「结果待确认」并等回显，不在这里补发。
#[tauri::command(rename_all = "camelCase")]
pub async fn chatroom_send(
    state: State<'_, AppState>,
    request: SendRequest,
) -> Result<SendResult, AppError> {
    let content = request.content.trim();
    if content.is_empty() {
        return Err(AppError::business("消息内容不能为空"));
    }
    let content = content.to_string();

    let (client, session_generation) = require_client(&state)?;
    let result = client.chatroom().send(content).await;
    ensure_same_session(&state, session_generation)?;
    map_send_result(session_generation, result)
}

/// 拉取历史。`page` 与 `aroundId` 互斥；内容类型固定 Markdown，与实时 DTO 同一形状。
#[tauri::command(rename_all = "camelCase")]
pub async fn chatroom_history(
    state: State<'_, AppState>,
    query: HistoryQuery,
) -> Result<HistoryResult, AppError> {
    let call = parse_history_query(&query)?;
    let (client, session_generation) = require_client(&state)?;
    let messages = fetch_history(&client, call).await?;
    ensure_same_session(&state, session_generation)?;

    let connection_generation = if state.has_chatroom_connection() {
        Some(state.connection_generation())
    } else {
        None
    };

    Ok(HistoryResult {
        session_generation,
        connection_generation,
        exhausted: Some(messages.is_empty()),
        messages: ChatMessageDto::from_history(messages),
    })
}

/// 按消息 ID 撤回。成功只表示这次 HTTP 被接受；重复的撤回事件由前端按 ID 去重。
/// 超时且不确定服务端结果时返回 `outcome_unknown`，不自动重试。
#[tauri::command(rename_all = "camelCase")]
pub async fn chatroom_revoke(
    state: State<'_, AppState>,
    request: RevokeRequest,
) -> Result<(), AppError> {
    let message_id = request.message_id.trim();
    if message_id.is_empty() {
        return Err(AppError::business("撤回消息 ID 不能为空"));
    }
    let message_id = message_id.to_string();

    let (client, session_generation) = require_client(&state)?;
    let result = client.chatroom().revoke(message_id).await;
    ensure_same_session(&state, session_generation)?;
    map_revoke_result(result)
}

/// 取服务端消息原文（对齐旧版「复制消息」优先 `md`，否则 `cr/raw/{id}`）。
#[tauri::command(rename_all = "camelCase")]
pub async fn chatroom_raw(
    state: State<'_, AppState>,
    request: RevokeRequest,
) -> Result<String, AppError> {
    let message_id = request.message_id.trim();
    if message_id.is_empty() {
        return Err(AppError::business("消息 ID 不能为空"));
    }
    if !message_id.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::business("消息 ID 无效"));
    }
    let message_id = message_id.to_string();
    let (client, session_generation) = require_client(&state)?;
    let raw = client.chatroom().raw_message(message_id).await;
    ensure_same_session(&state, session_generation)?;
    Ok(raw?)
}

fn require_client(state: &AppState) -> Result<(FishPi, u64), AppError> {
    let handle = state.clone_fishpi().ok_or_else(AppError::unauthorized)?;
    Ok((handle.client, handle.session_generation))
}

fn ensure_same_session(state: &AppState, expected: u64) -> Result<(), AppError> {
    if state.session_generation() != expected {
        return Err(AppError::session_superseded());
    }
    Ok(())
}

fn current_connection_snapshot(state: &AppState) -> ConnectionEvent {
    let status = if state.has_chatroom_connection() {
        ConnectionStatus::Connected
    } else {
        ConnectionStatus::Unknown
    };
    ConnectionEvent::new(
        state.session_generation(),
        state.connection_generation(),
        status,
    )
}

/// 换号则拆掉本次 socket 并报错；已有活连接则拆掉本次 socket，让调用方走幂等返回。
fn abort_if_unusable(
    state: &AppState,
    expected_session: u64,
    connection: &mut ChatRoomConnection,
) -> Result<Option<ConnectionEvent>, AppError> {
    if state.session_generation() != expected_session {
        connection.disconnect();
        return Err(AppError::session_superseded());
    }
    if state.has_chatroom_connection() {
        connection.disconnect();
        return Ok(Some(current_connection_snapshot(state)));
    }
    Ok(None)
}

fn parse_history_query(query: &HistoryQuery) -> Result<HistoryCall, AppError> {
    if query.has_conflicting_cursors() {
        return Err(AppError::business("page 与 aroundId 不能同时使用"));
    }

    if query.has_around_id() {
        let id = query
            .around_id
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_string();
        let mode = query.mode.ok_or_else(|| {
            AppError::business("around 查询必须指定 mode（before / after / context）")
        })?;
        let size = query.size.unwrap_or(DEFAULT_AROUND_SIZE);
        if size == 0 {
            return Err(AppError::business("around 的 size 必须大于 0"));
        }
        return Ok(HistoryCall::Around { id, mode, size });
    }

    match query.page {
        Some(page) if page >= 1 => Ok(HistoryCall::Page(page)),
        Some(_) => Err(AppError::business("page 必须从 1 开始")),
        None => Err(AppError::business("必须指定 page 或 aroundId")),
    }
}

enum HistoryCall {
    Page(u32),
    Around {
        id: String,
        mode: HistoryMode,
        size: u32,
    },
}

async fn fetch_history(client: &FishPi, call: HistoryCall) -> Result<Vec<ChatRoomMsg>, AppError> {
    let api = client.chatroom();
    match call {
        HistoryCall::Page(page) => Ok(api.history(page, ChatContentType::Markdown).await?),
        HistoryCall::Around { id, mode, size } => {
            let mode = ChatRoomMessageMode::from(mode);
            Ok(api
                .msg_around(id, mode, size, ChatContentType::Markdown)
                .await?)
        }
    }
}

fn map_send_result(
    session_generation: u64,
    result: Result<(), SdkError>,
) -> Result<SendResult, AppError> {
    match result {
        Ok(()) => Ok(SendResult::accepted(session_generation)),
        Err(err) if is_uncertain_write(&err) => Ok(SendResult::outcome_unknown(session_generation)),
        Err(err) => Err(AppError::from(err)),
    }
}

/// 弹幕 +1。走 SDK `chatroom().barrager()`，颜色先过滤，不安全则让 SDK 用它自己的默认色。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BarragerRequest {
    pub content: String,
    #[serde(default)]
    pub color: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn chatroom_barrager(
    state: State<'_, AppState>,
    request: BarragerRequest,
) -> Result<SendResult, AppError> {
    let content = request.content.trim();
    if content.is_empty() {
        return Err(AppError::business("弹幕内容不能为空"));
    }
    let content = content.to_string();
    let color = request
        .color
        .as_deref()
        .and_then(safe_css_color);

    let (client, session_generation) = require_client(&state)?;
    let result = client
        .chatroom()
        .barrager(content, color.as_deref())
        .await;
    ensure_same_session(&state, session_generation)?;
    match result {
        Ok(_) => Ok(SendResult::accepted(session_generation)),
        Err(err) if is_uncertain_write(&err) => Ok(SendResult::outcome_unknown(session_generation)),
        Err(err) => Err(AppError::from(err)),
    }
}

/// 弹幕费用 DTO，camelCase 直出前端。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BarrageCostDto {
    pub cost: u32,
    pub unit: String,
}

impl From<fishpi_sdk::domain::chatroom::BarragerCost> for BarrageCostDto {
    fn from(value: fishpi_sdk::domain::chatroom::BarragerCost) -> Self {
        Self {
            cost: value.cost,
            unit: value.unit,
        }
    }
}

/// 拉取发弹幕费用（`chat-room/barrager/get`），供前端展示。
#[tauri::command(rename_all = "camelCase")]
pub async fn chatroom_barrage_cost(
    state: State<'_, AppState>,
) -> Result<BarrageCostDto, AppError> {
    let (client, session_generation) = require_client(&state)?;
    let cost = client.chatroom().barrage_cost().await;
    ensure_same_session(&state, session_generation)?;
    Ok(cost?.into())
}

fn map_revoke_result(result: Result<String, SdkError>) -> Result<(), AppError> {
    match result {
        Ok(_) => Ok(()),
        Err(err) if is_uncertain_write(&err) => Err(AppError::outcome_unknown()),
        Err(err) => Err(AppError::from(err)),
    }
}

/// 超时或中途传输出错：请求可能已经到达服务端，不能当成确定失败去自动重发。
///
/// 连不上（`is_connect`）说明请求没发出去，交给普通 network 错误。
fn is_uncertain_write(err: &SdkError) -> bool {
    match err {
        SdkError::Transport(inner) => inner.is_timeout() || inner.is_body() || !inner.is_connect(),
        SdkError::Request(_) => true,
        _ => false,
    }
}
