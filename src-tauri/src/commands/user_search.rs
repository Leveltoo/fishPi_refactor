//! 用户名联想搜索。只读：按关键词查用户，不含 token。

use tauri::State;

use crate::commands::common::{ensure_same_session, require_client, require_nonempty};
use crate::dto::{UserSearchHit, UserSearchRequest, UserSearchResult};
use crate::error::AppError;
use crate::state::AppState;

/// 按关键词联想用户名，供私聊开聊与 overlay 搜人使用。
#[tauri::command(rename_all = "camelCase")]
pub async fn user_search(
    state: State<'_, AppState>,
    request: UserSearchRequest,
) -> Result<UserSearchResult, AppError> {
    let query = require_nonempty(&request.query, "搜索关键词不能为空")?;
    let (client, session_generation) = require_client(&state)?;
    let users = client.user().names(query).await?;
    ensure_same_session(&state, session_generation)?;
    Ok(UserSearchResult {
        session_generation,
        users: users.into_iter().map(UserSearchHit::from).collect(),
    })
}
