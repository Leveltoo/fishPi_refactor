//! 感谢评论。写操作。
//!
//! SDK `comment().thank()` 成功是 `()`。只有确定成功才让前端把状态改成已感谢。
//! 超时或中途断连走 `outcomeUnknown`，前端不得标成已感谢，也不得自动重试。

use tauri::State;

use crate::commands::common::{ensure_same_session, map_send_result, require_client, require_nonempty};
use crate::dto::{ArticleIdRequest, SendResult};
use crate::error::AppError;
use crate::state::AppState;

/// 感谢评论作者。赠送积分由服务端决定（旧客户端提示为 15 积分）。
#[tauri::command(rename_all = "camelCase")]
pub async fn comment_thank(
    state: State<'_, AppState>,
    request: ArticleIdRequest,
) -> Result<SendResult, AppError> {
    let id = require_nonempty(&request.id, "评论 ID 不能为空")?;
    let (client, session_generation) = require_client(&state)?;
    let result = client.comment().thank(id).await;
    ensure_same_session(&state, session_generation)?;
    map_send_result(session_generation, result)
}
