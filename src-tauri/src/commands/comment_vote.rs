//! 评论点赞 / 点踩。写操作。
//!
//! SDK `comment().vote(id, like)` 在信封成功后返回 `like && previous_vote != 0`。
//! 该布尔对 down 恒为 false，不能当「当前方向是否选中」用。
//! 确定成功后由前端按点击前状态做切换（与旧客户端一致）；结果不明时不改赞踩。

use tauri::State;

use crate::commands::common::{ensure_same_session, is_uncertain_write, require_client, require_nonempty};
use crate::dto::{ArticleVoteRequest, SendResult};
use crate::error::AppError;
use crate::state::AppState;

/// `direction` 为 `up`（赞）或 `down`（踩）。返回只表示写操作是否确定落成。
#[tauri::command(rename_all = "camelCase")]
pub async fn comment_vote(
    state: State<'_, AppState>,
    request: ArticleVoteRequest,
) -> Result<SendResult, AppError> {
    let id = require_nonempty(&request.id, "评论 ID 不能为空")?;
    let like = parse_direction(&request.direction)?;
    let (client, session_generation) = require_client(&state)?;
    let result = client.comment().vote(id, like).await;
    ensure_same_session(&state, session_generation)?;
    match result {
        Ok(_) => Ok(SendResult::accepted(session_generation)),
        Err(err) if is_uncertain_write(&err) => Ok(SendResult::outcome_unknown(session_generation)),
        Err(err) => Err(AppError::from(err)),
    }
}

fn parse_direction(raw: &str) -> Result<bool, AppError> {
    match raw.trim() {
        "up" => Ok(true),
        "down" => Ok(false),
        _ => Err(AppError::business("投票方向只能是 up 或 down")),
    }
}
