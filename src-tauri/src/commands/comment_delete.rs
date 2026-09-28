//! 删除评论。写操作。
//!
//! SDK `comment().remove(id)` 成功回评论 ID。只有确定成功才让前端把这条从列表拿掉。
//! 超时或中途断连走 `outcomeUnknown`，前端不得假装已删除，也不得自动重试。

use tauri::State;

use crate::commands::common::{ensure_same_session, is_uncertain_write, require_client, require_nonempty};
use crate::dto::{ArticleIdRequest, SendResult};
use crate::error::AppError;
use crate::state::AppState;

/// 删除自己的评论。是否允许删由服务端裁决，前端只在确定成功后移除本地条目。
#[tauri::command(rename_all = "camelCase")]
pub async fn comment_delete(
    state: State<'_, AppState>,
    request: ArticleIdRequest,
) -> Result<SendResult, AppError> {
    let id = require_nonempty(&request.id, "评论 ID 不能为空")?;
    let (client, session_generation) = require_client(&state)?;
    let result = client.comment().remove(id).await;
    ensure_same_session(&state, session_generation)?;
    match result {
        Ok(_) => Ok(SendResult::accepted(session_generation)),
        Err(err) if is_uncertain_write(&err) => Ok(SendResult::outcome_unknown(session_generation)),
        Err(err) => Err(AppError::from(err)),
    }
}
