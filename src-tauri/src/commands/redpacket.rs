//! 红包 IPC：开红包。发红包仍走 `chatroom_send` 的 `[redpacket]...[/redpacket]` 载荷。
//!
//! 开红包是写操作：禁止自动重试。超时且无法确认服务端是否领取时返回
//! `outcome_unknown`，由前端提示核对，不要在这里补领。

use fishpi_sdk::utils::error::Error as SdkError;
use fishpi_sdk::FishPi;
use tauri::State;

use crate::dto::{parse_gesture, OpenRedPacketRequest, RedPacketInfoDto};
use crate::error::AppError;
use crate::state::AppState;

/// 按消息 ID 领取红包。猜拳才传 `gesture`（0 石头 / 1 剪刀 / 2 布）。
#[tauri::command(rename_all = "camelCase")]
pub async fn redpacket_open(
    state: State<'_, AppState>,
    request: OpenRedPacketRequest,
) -> Result<RedPacketInfoDto, AppError> {
    let o_id = request.o_id.trim();
    if o_id.is_empty() {
        return Err(AppError::business("红包消息 ID 不能为空"));
    }
    let o_id = o_id.to_string();
    let gesture = parse_gesture(request.gesture).map_err(AppError::business)?;

    let (client, session_generation) = require_client(&state)?;
    let result = client.redpacket().open(o_id, gesture).await;
    ensure_same_session(&state, session_generation)?;
    map_open_result(session_generation, result)
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

fn map_open_result(
    session_generation: u64,
    result: Result<fishpi_sdk::domain::redpacket::RedPacketInfo, SdkError>,
) -> Result<RedPacketInfoDto, AppError> {
    match result {
        Ok(info) => Ok(RedPacketInfoDto::from_sdk(session_generation, info)),
        Err(err) if is_uncertain_write(&err) => Err(AppError::outcome_unknown()),
        Err(err) => Err(AppError::from(err)),
    }
}

fn is_uncertain_write(err: &SdkError) -> bool {
    match err {
        SdkError::Transport(inner) => inner.is_timeout() || inner.is_body() || !inner.is_connect(),
        SdkError::Request(_) => true,
        _ => false,
    }
}
