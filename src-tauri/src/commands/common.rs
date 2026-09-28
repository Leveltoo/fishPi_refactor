//! command 共用：会话校验、写操作不确定结果。
//!
//! 持 `AppState` 锁时禁止 `.await`。这些函数都不持锁等待网络。

use fishpi_sdk::utils::error::Error as SdkError;
use fishpi_sdk::FishPi;

use crate::dto::SendResult;
use crate::error::AppError;
use crate::state::AppState;

pub fn require_client(state: &AppState) -> Result<(FishPi, u64), AppError> {
    let handle = state.clone_fishpi().ok_or_else(AppError::unauthorized)?;
    Ok((handle.client, handle.session_generation))
}

pub fn ensure_same_session(state: &AppState, expected: u64) -> Result<(), AppError> {
    if state.session_generation() != expected {
        return Err(AppError::session_superseded());
    }
    Ok(())
}

/// 超时或中途传输出错：请求可能已经到达服务端，不能当成确定失败去自动重发。
///
/// 连不上（`is_connect`）说明请求没发出去，交给普通 network 错误。
pub fn is_uncertain_write(err: &SdkError) -> bool {
    match err {
        SdkError::Transport(inner) => inner.is_timeout() || inner.is_body() || !inner.is_connect(),
        SdkError::Request(_) => true,
        _ => false,
    }
}

pub fn map_send_result(
    session_generation: u64,
    result: Result<(), SdkError>,
) -> Result<SendResult, AppError> {
    match result {
        Ok(()) => Ok(SendResult::accepted(session_generation)),
        Err(err) if is_uncertain_write(&err) => Ok(SendResult::outcome_unknown(session_generation)),
        Err(err) => Err(AppError::from(err)),
    }
}

pub fn map_write_unit(result: Result<(), SdkError>) -> Result<(), AppError> {
    match result {
        Ok(()) => Ok(()),
        Err(err) if is_uncertain_write(&err) => Err(AppError::outcome_unknown()),
        Err(err) => Err(AppError::from(err)),
    }
}

pub fn require_nonempty(value: &str, message: &str) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(AppError::business(message))
    } else {
        Ok(trimmed.to_string())
    }
}
