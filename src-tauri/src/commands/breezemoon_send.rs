//! 发送清风明月。写操作，成功不带 ID。
//!
//! SDK `breezemoon().send()` 成功是 `()`。`accepted` 只表示 HTTP 被接受，不是列表里已有这条。
//! 超时或中途断连、无法判断服务端是否落库时 `outcomeUnknown`，禁止自动重试、禁止假成功。
//! token / api_key 不进 DTO，由已鉴权 `FishPi` 携带。

use tauri::State;

use crate::commands::common::{
    ensure_same_session, map_send_result, require_client, require_nonempty,
};
use crate::dto::{BreezemoonSendRequest, SendResult};
use crate::error::AppError;
use crate::state::AppState;

/// 发送清风明月。入参字段对齐前端 `invokeBreezemoonSend`：`content`。
#[tauri::command(rename_all = "camelCase")]
pub async fn breezemoon_send(
    state: State<'_, AppState>,
    request: BreezemoonSendRequest,
) -> Result<SendResult, AppError> {
    let content = require_nonempty(&request.content, "清风明月内容不能为空")?;

    let (client, session_generation) = require_client(&state)?;
    let result = client.breezemoon().send(content).await;
    ensure_same_session(&state, session_generation)?;
    map_send_result(session_generation, result)
}
