//! 红包 IPC：开包、发送。发送由 SDK 编码为 `[redpacket]...[/redpacket]`。
//!
//! 开红包是写操作：禁止自动重试。超时且无法确认服务端是否领取时返回
//! `outcome_unknown`，由前端提示核对，不要在这里补领。

use fishpi_sdk::utils::error::Error as SdkError;
use tauri::State;

use super::common::{ensure_same_session, is_uncertain_write, require_client};
use crate::dto::{
    parse_gesture, OpenRedPacketRequest, RedPacketInfoDto, SendRedPacketRequest, SendResult,
};
use crate::error::AppError;
use crate::state::AppState;

/// 按消息 ID 领取红包。猜拳才传 `gesture`（0 石头 / 1 剪刀 / 2 布）。
#[tauri::command(rename_all = "camelCase")]
pub async fn redpacket_open(
    state: State<'_, AppState>,
    request: OpenRedPacketRequest,
) -> Result<RedPacketInfoDto, AppError> {
    let o_id = request.o_id.trim();
    if o_id.is_empty() || !o_id.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(AppError::business("红包消息 ID 必须为数字字符串"));
    }
    let o_id = o_id.to_string();
    let gesture = parse_gesture(request.gesture).map_err(AppError::business)?;

    let (client, session_generation) = require_client(&state)?;
    validate_expected_session(request.expected_session_generation, session_generation)?;
    let result = client.redpacket().open(o_id, gesture).await;
    ensure_same_session(&state, session_generation).map_err(|_| AppError::outcome_unknown())?;
    map_open_result(session_generation, result)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn redpacket_send(
    state: State<'_, AppState>,
    request: SendRedPacketRequest,
) -> Result<SendResult, AppError> {
    let expected = request.expected_session_generation;
    let packet = request.into_sdk().map_err(AppError::business)?;
    let (client, session_generation) = require_client(&state)?;
    validate_expected_session(expected, session_generation)?;
    let result = client.redpacket().send(packet).await;
    ensure_same_session(&state, session_generation).map_err(|_| AppError::outcome_unknown())?;
    match result {
        Ok(()) => Ok(SendResult::accepted(session_generation)),
        Err(error) if is_uncertain_redpacket_write(&error) => {
            Ok(SendResult::outcome_unknown(session_generation))
        }
        Err(error) => Err(AppError::from(error)),
    }
}

fn validate_expected_session(expected: Option<u64>, actual: u64) -> Result<(), AppError> {
    if expected.is_some_and(|expected| expected != actual) {
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
        Err(err) if is_uncertain_redpacket_write(&err) => Err(AppError::outcome_unknown()),
        Err(err) => Err(AppError::from(err)),
    }
}

fn is_uncertain_redpacket_write(err: &SdkError) -> bool {
    if is_uncertain_write(err) {
        return true;
    }
    match err {
        // 收到响应但无法解码也不能断言扣款/领取未发生；访客验证是确定的拒绝。
        SdkError::Decode(message) => {
            !message.contains("访客验证")
                && !message.contains("validateCaptcha")
                && !message.contains("initgeetest4")
        }
        SdkError::Parse(_) => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decoding_a_write_is_uncertain_but_business_rejection_is_not() {
        assert!(is_uncertain_redpacket_write(&SdkError::decode(
            "invalid JSON"
        )));
        assert!(!is_uncertain_redpacket_write(&SdkError::decode(
            "当前网络触发访客验证"
        )));
        assert!(!is_uncertain_redpacket_write(&SdkError::business(
            1,
            "红包已领完"
        )));
        assert!(!is_uncertain_redpacket_write(&SdkError::Unauthorized));
        assert!(validate_expected_session(Some(1), 2).is_err());
        assert!(validate_expected_session(Some(2), 2).is_ok());
    }
}
