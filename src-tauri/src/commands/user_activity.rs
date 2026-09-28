//! 活跃度 / 签到。
//!
//! 活跃度建议至少间隔 10 分钟查询，由前端节流；这里不 sleep、不缓存。
//! 领取昨日奖励是写操作，在 `user_reward`。
//! 签到写操作见 `user_checkin`：SDK 1.1.0 无写 API，命令返回结构化业务错误。

use tauri::State;

use crate::commands::common::{ensure_same_session, require_client};
use crate::dto::{UserCheckinResult, UserCollectedLivenessResult, UserLivenessResult};
use crate::error::AppError;
use crate::state::AppState;

/// 当前活跃度。
#[tauri::command(rename_all = "camelCase")]
pub async fn user_liveness(state: State<'_, AppState>) -> Result<UserLivenessResult, AppError> {
    let (client, session_generation) = require_client(&state)?;
    let liveness = client.user().liveness().await?;
    ensure_same_session(&state, session_generation)?;
    Ok(UserLivenessResult {
        session_generation,
        liveness,
    })
}

/// 今日是否已签到。
#[tauri::command(rename_all = "camelCase")]
pub async fn user_is_checkin(state: State<'_, AppState>) -> Result<UserCheckinResult, AppError> {
    let (client, session_generation) = require_client(&state)?;
    let checked_in = client.user().is_checkin().await?;
    ensure_same_session(&state, session_generation)?;
    Ok(UserCheckinResult {
        session_generation,
        checked_in,
    })
}

/// 昨日活跃奖励是否已领取。
#[tauri::command(rename_all = "camelCase")]
pub async fn user_is_collected_liveness(
    state: State<'_, AppState>,
) -> Result<UserCollectedLivenessResult, AppError> {
    let (client, session_generation) = require_client(&state)?;
    let collected = client.user().is_collected_liveness().await?;
    ensure_same_session(&state, session_generation)?;
    Ok(UserCollectedLivenessResult {
        session_generation,
        collected,
    })
}

/// 签到写操作。
///
/// fishpi-sdk 1.1.0 `UserApi` 仅有 `is_checkin()`（GET `user/checkedIn`），
/// 没有签到写方法；`post_raw` / `get_raw` / `with_key` 均为 `pub(crate)`，
/// 外部无法借道 raw POST。旧版 fishpi-desktop 与官方 fishpi.js 同样只有查询。
/// 不伪造成功，返回结构化业务错误，由前端如实展示。
#[tauri::command(rename_all = "camelCase")]
pub async fn user_checkin(
    state: State<'_, AppState>,
) -> Result<UserCheckinResult, AppError> {
    let (_client, _session_generation) = require_client(&state)?;
    Err(AppError::business(CHECKIN_WRITE_UNSUPPORTED))
}

/// 与前端 `CHECKIN_UNSUPPORTED` 一致的说明文案。
pub const CHECKIN_WRITE_UNSUPPORTED: &str = "签到写操作暂不可用：fishpi-sdk 1.1.0 仅提供 is_checkin() 查询，没有签到写 API。本次没有真正签到。";
