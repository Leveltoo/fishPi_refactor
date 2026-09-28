//! 点赞 / 点踩。写操作。
//!
//! SDK `vote(id, like)` 在信封成功后返回 `type == -1`。
//! `active == true` 表示这次方向现在选中；`false` 表示取消。
//! 结果不明时 `active` 固定为 false，前端不得改赞踩状态。

use tauri::State;

use crate::commands::common::{ensure_same_session, is_uncertain_write, require_client, require_nonempty};
use crate::dto::{ArticleVoteRequest, ArticleVoteResult};
use crate::error::AppError;
use crate::state::AppState;

/// `direction` 为 `up`（赞）或 `down`（踩）。
#[tauri::command(rename_all = "camelCase")]
pub async fn article_vote(
    state: State<'_, AppState>,
    request: ArticleVoteRequest,
) -> Result<ArticleVoteResult, AppError> {
    let id = require_nonempty(&request.id, "帖子 ID 不能为空")?;
    let like = parse_direction(&request.direction)?;
    let (client, session_generation) = require_client(&state)?;
    let result = client.article().vote(id, like).await;
    ensure_same_session(&state, session_generation)?;
    match result {
        Ok(active) => Ok(ArticleVoteResult::accepted(session_generation, active)),
        Err(err) if is_uncertain_write(&err) => Ok(ArticleVoteResult::unconfirmed(session_generation)),
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
