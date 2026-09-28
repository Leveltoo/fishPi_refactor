//! 清风明月列表。只读：按页拉取全站或指定用户的清风明月。
//!
//! 正文剥离已在 [`crate::dto::BreezemoonDto::from`] 完成，这里不处理 HTML。

use tauri::State;

use crate::commands::common::{ensure_same_session, require_client};
use crate::dto::{BreezemoonDto, BreezemoonListQuery, BreezemoonListResult};
use crate::error::AppError;
use crate::state::AppState;

const DEFAULT_PAGE: u32 = 1;
const DEFAULT_SIZE: u32 = 20;

/// 清风明月列表。`userName` 空则拉全站，非空按用户查。
#[tauri::command(rename_all = "camelCase")]
pub async fn breezemoon_list(
    state: State<'_, AppState>,
    query: BreezemoonListQuery,
) -> Result<BreezemoonListResult, AppError> {
    let page = query.page.unwrap_or(DEFAULT_PAGE);
    if page == 0 {
        return Err(AppError::business("page 必须从 1 开始"));
    }
    let size = query.size.unwrap_or(DEFAULT_SIZE);
    if size == 0 {
        return Err(AppError::business("size 必须大于 0"));
    }
    let user = query
        .user_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty());

    let (client, session_generation) = require_client(&state)?;
    let list = client.breezemoon().list(page, size, user).await?;
    ensure_same_session(&state, session_generation)?;
    let exhausted = list.is_empty() || (list.len() as u32) < size;
    Ok(BreezemoonListResult {
        session_generation,
        items: list.into_iter().map(BreezemoonDto::from).collect(),
        exhausted,
    })
}
