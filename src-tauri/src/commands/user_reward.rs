//! 领取昨日活跃奖励。写操作，禁止自动重试。
//!
//! 超时或中途断连、无法确认服务端是否入账时 `outcome_unknown`，不填假积分。

use tauri::State;

use crate::commands::common::{ensure_same_session, is_uncertain_write, require_client};
use crate::dto::UserRewardLivenessResult;
use crate::error::AppError;
use crate::state::AppState;

/// 领取昨日活跃度奖励，成功返回积分。
#[tauri::command(rename_all = "camelCase")]
pub async fn user_reward_liveness(
    state: State<'_, AppState>,
) -> Result<UserRewardLivenessResult, AppError> {
    let (client, session_generation) = require_client(&state)?;
    let result = client.user().reward_liveness().await;
    ensure_same_session(&state, session_generation)?;
    match result {
        Ok(points) => Ok(UserRewardLivenessResult::new(session_generation, points)),
        Err(err) if is_uncertain_write(&err) => Err(AppError::outcome_unknown()),
        Err(err) => Err(AppError::from(err)),
    }
}
