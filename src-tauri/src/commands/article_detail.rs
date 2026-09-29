//! 帖子详情。只读：按 ID 拉正文与指定评论页。
//!
//! 正文经 [`crate::dto::ArticleDetailDto::from_sdk`] 给出 markdown 或 HTML，
//! 由前端 DOMPurify 渲染。`page` 缺省时对齐旧客户端：拉评论最后一页。

use tauri::State;

use crate::commands::common::{ensure_same_session, require_client, require_nonempty};
use crate::dto::{pagination_count, ArticleDetailDto, ArticleDetailQuery, ArticleDetailResult};
use crate::error::AppError;
use crate::state::AppState;

const DEFAULT_COMMENT_PAGE: u32 = 1;

/// 帖子详情。`page` 为评论页码；缺省则取最后一页（旧版从最后一页往前翻）。
#[tauri::command(rename_all = "camelCase")]
pub async fn article_detail(
    state: State<'_, AppState>,
    request: ArticleDetailQuery,
) -> Result<ArticleDetailResult, AppError> {
    let id = require_nonempty(&request.id, "帖子 ID 不能为空")?;
    if request.page == Some(0) {
        return Err(AppError::business("page 必须从 1 开始"));
    }

    let (client, session_generation) = require_client(&state)?;
    let (detail, comment_page) = match request.page {
        Some(page) => {
            let detail = client.article().detail(id, page).await?;
            (detail, page)
        }
        None => {
            let first = client.article().detail(id.clone(), DEFAULT_COMMENT_PAGE).await?;
            let last = pagination_count(first.pagination.as_ref()).max(1);
            if last <= 1 {
                (first, 1)
            } else {
                let last_page = client.article().detail(id, last).await?;
                (last_page, last)
            }
        }
    };
    ensure_same_session(&state, session_generation)?;
    Ok(ArticleDetailResult {
        session_generation,
        article: ArticleDetailDto::from_sdk(detail).at_comment_page(comment_page),
    })
}
