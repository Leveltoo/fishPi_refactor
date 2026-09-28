//! 通知 HTTP 与长连接。
//!
//! `notice().list(Broadcast)` 按 SDK 会失败，这里直接映射为 business，不调接口。
//! `notice_connect` 在返回前注册 `on_refresh` / `on_broadcast`。

use fishpi_sdk::client::NoticeConnection;
use fishpi_sdk::domain::notice::NoticeType;
use tauri::{AppHandle, State};

use crate::commands::common::{
    ensure_same_session, is_uncertain_write, map_write_unit, require_client,
};
use crate::dto::{
    ChatConnectResult, NoticeCountDto, NoticeItemDto, NoticeListRequest, NoticeListResult,
    NoticeMakeReadRequest,
};
use crate::error::AppError;
use crate::realtime::attach_notice_forwarder;
use crate::state::AppState;

/// 未读计数。
#[tauri::command(rename_all = "camelCase")]
pub async fn notice_count(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<NoticeCountDto, AppError> {
    let (client, session_generation) = require_client(&state)?;
    let count = client.notice().count().await?;
    ensure_same_session(&state, session_generation)?;
    let _ = ensure_notice_connected(&app, &state).await;
    Ok(NoticeCountDto::from_sdk(session_generation, count))
}

/// 按类型拉通知列表。`broadcast` 不支持。
#[tauri::command(rename_all = "camelCase")]
pub async fn notice_list(
    state: State<'_, AppState>,
    query: NoticeListRequest,
) -> Result<NoticeListResult, AppError> {
    let notice_type = parse_notice_type(&query.notice_type)?;
    if notice_type == NoticeType::Broadcast {
        return Err(AppError::business("broadcast 通知不支持列表查询"));
    }

    let (client, session_generation) = require_client(&state)?;
    let list = client.notice().list(notice_type).await?;
    ensure_same_session(&state, session_generation)?;
    Ok(NoticeListResult {
        session_generation,
        items: list.into_iter().map(NoticeItemDto::from).collect(),
    })
}

/// 将某类通知标为已读。写操作，超时走 `outcome_unknown`。
#[tauri::command(rename_all = "camelCase")]
pub async fn notice_make_read(
    state: State<'_, AppState>,
    request: NoticeMakeReadRequest,
) -> Result<(), AppError> {
    let notice_type = parse_notice_type(&request.notice_type)?;
    let (client, session_generation) = require_client(&state)?;
    let result = client.notice().make_read(notice_type).await;
    ensure_same_session(&state, session_generation)?;
    map_write_unit(result)
}

/// 全部已读。写操作，超时走 `outcome_unknown`。
#[tauri::command(rename_all = "camelCase")]
pub async fn notice_read_all(state: State<'_, AppState>) -> Result<(), AppError> {
    let (client, session_generation) = require_client(&state)?;
    let result = client.notice().read_all().await;
    ensure_same_session(&state, session_generation)?;
    map_write_unit(result)
}

/// 幂等建立通知长连接。返回前注册完 refresh / broadcast 监听。
#[tauri::command(rename_all = "camelCase")]
pub async fn notice_connect(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ChatConnectResult, AppError> {
    ensure_notice_connected(&app, &state).await
}

/// 供私聊全局频道和通知 HTTP 复用：已有连接则直接返回快照。
pub async fn ensure_notice_connected(
    app: &AppHandle,
    state: &AppState,
) -> Result<ChatConnectResult, AppError> {
    if state.has_notice_connection() {
        return Ok(current_notice_snapshot(state));
    }

    let (client, session_generation) = require_client(state)?;
    let Some(generation) = state.reserve_notice_connection(session_generation)? else {
        return Ok(current_notice_snapshot(state));
    };

    let mut connection = match client.notice().connect().await {
        Ok(connection) => connection,
        Err(err) => {
            state.cancel_pending_notice(generation);
            return Err(AppError::from(err));
        }
    };

    if let Some(snapshot) = abort_if_unusable(state, session_generation, generation, &mut connection)?
    {
        return Ok(snapshot);
    }

    attach_notice_forwarder(app, &connection, session_generation, generation).await;

    if state.session_generation() != session_generation {
        state.cancel_pending_notice(generation);
        connection.disconnect();
        return Err(AppError::session_superseded());
    }

    match state.install_notice_connection(session_generation, generation, connection) {
        Ok(installed) => Ok(ChatConnectResult::new(session_generation, installed)),
        Err(mut rejected) => {
            rejected.disconnect();
            if state.has_notice_connection() {
                return Ok(current_notice_snapshot(state));
            }
            Err(AppError::session_superseded())
        }
    }
}

fn current_notice_snapshot(state: &AppState) -> ChatConnectResult {
    ChatConnectResult::new(
        state.session_generation(),
        state.notice_generation().unwrap_or(0),
    )
}

fn abort_if_unusable(
    state: &AppState,
    expected_session: u64,
    generation: u64,
    connection: &mut NoticeConnection,
) -> Result<Option<ChatConnectResult>, AppError> {
    if state.session_generation() != expected_session {
        state.cancel_pending_notice(generation);
        connection.disconnect();
        return Err(AppError::session_superseded());
    }
    if state.notice_generation() != Some(generation) && state.has_notice_connection() {
        state.cancel_pending_notice(generation);
        connection.disconnect();
        return Ok(Some(current_notice_snapshot(state)));
    }
    Ok(None)
}

fn parse_notice_type(raw: &str) -> Result<NoticeType, AppError> {
    match raw.trim() {
        "point" => Ok(NoticeType::Point),
        "commented" => Ok(NoticeType::Commented),
        "reply" => Ok(NoticeType::Reply),
        "at" => Ok(NoticeType::At),
        "following" => Ok(NoticeType::Following),
        "sys-announce" | "system" => Ok(NoticeType::System),
        "broadcast" => Ok(NoticeType::Broadcast),
        "" => Err(AppError::business("通知类型不能为空")),
        _ => Err(AppError::business("不支持的通知类型")),
    }
}

#[allow(dead_code)]
fn _write_uncertain(err: &fishpi_sdk::utils::error::Error) -> bool {
    is_uncertain_write(err)
}
