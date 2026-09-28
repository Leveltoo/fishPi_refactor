//! 帖子列表。只读：按类型分页拉取摘要。
//!
//! 预览剥离已在 [`crate::dto::ArticleListResult::from_sdk`] 完成，这里不处理 HTML。
//! 不支持无标签的 `perfect`：SDK 会失败，前端也没有该 tab。

use fishpi_sdk::domain::article::ArticleListType;
use tauri::State;

use crate::commands::common::{ensure_same_session, require_client};
use crate::dto::{ArticleListQuery, ArticleListResult};
use crate::error::AppError;
use crate::state::AppState;

const DEFAULT_PAGE: u32 = 1;
const DEFAULT_SIZE: u32 = 20;

/// 帖子列表。`type` 为 recent / hot / good / reply / long，缺省 recent。
#[tauri::command(rename_all = "camelCase")]
pub async fn article_list(
    state: State<'_, AppState>,
    request: ArticleListQuery,
) -> Result<ArticleListResult, AppError> {
    let list_type = parse_list_type(request.list_type.as_deref())?;
    let page = request.page.unwrap_or(DEFAULT_PAGE);
    if page == 0 {
        return Err(AppError::business("page 必须从 1 开始"));
    }
    let size = request.size.unwrap_or(DEFAULT_SIZE);
    if size == 0 {
        return Err(AppError::business("size 必须大于 0"));
    }

    let (client, session_generation) = require_client(&state)?;
    let list = client.article().list(list_type, page, size, None).await?;
    ensure_same_session(&state, session_generation)?;
    Ok(ArticleListResult::from_sdk(session_generation, page, list))
}

fn parse_list_type(raw: Option<&str>) -> Result<ArticleListType, AppError> {
    match raw.map(str::trim).unwrap_or("") {
        "" | "recent" => Ok(ArticleListType::Recent),
        "hot" => Ok(ArticleListType::Hot),
        "good" => Ok(ArticleListType::Good),
        "reply" => Ok(ArticleListType::Reply),
        "long" => Ok(ArticleListType::Long),
        "perfect" => Err(AppError::business("优选帖子列表需要指定标签")),
        _ => Err(AppError::business("不支持的帖子列表类型")),
    }
}
