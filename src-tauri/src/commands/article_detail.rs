//! 帖子详情。只读：按 ID 拉正文与指定评论页。
//!
//! 正文只经 [`crate::dto::ArticleDetailDto::from_sdk`] 给出 markdown 或剥过的纯文本，
//! 不转发原始 HTML。

use tauri::State;

use crate::commands::common::{ensure_same_session, require_client, require_nonempty};
use crate::dto::{ArticleDetailDto, ArticleDetailQuery, ArticleDetailResult};
use crate::error::AppError;
use crate::state::AppState;

const DEFAULT_COMMENT_PAGE: u32 = 1;

/// 帖子详情。`page` 为评论页码，缺省 1。
#[tauri::command(rename_all = "camelCase")]
pub async fn article_detail(
    state: State<'_, AppState>,
    request: ArticleDetailQuery,
) -> Result<ArticleDetailResult, AppError> {
    let id = require_nonempty(&request.id, "帖子 ID 不能为空")?;
    let page = request.page.unwrap_or(DEFAULT_COMMENT_PAGE);
    if page == 0 {
        return Err(AppError::business("page 必须从 1 开始"));
    }

    let (client, session_generation) = require_client(&state)?;
    let detail = client.article().detail(id, page).await?;
    ensure_same_session(&state, session_generation)?;
    Ok(ArticleDetailResult {
        session_generation,
        article: ArticleDetailDto::from_sdk(detail),
    })
}
