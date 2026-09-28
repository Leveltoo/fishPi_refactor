//! 发表评论。写操作，成功不带评论 ID。
//!
//! SDK `comment().post()` 成功是 `()`。`accepted` 只表示 HTTP 被接受，不是列表里已有这条。
//! 超时或中途断连、无法判断服务端是否落库时 `outcomeUnknown`，禁止自动重试、禁止假成功。
//! token / api_key 不进 DTO，由已鉴权 `FishPi` 携带。

use fishpi_sdk::domain::comment::CommentPost;
use tauri::State;

use crate::commands::common::{
    ensure_same_session, map_send_result, require_client, require_nonempty,
};
use crate::dto::{CommentPostRequest, SendResult};
use crate::error::AppError;
use crate::state::AppState;

/// 发表评论。入参字段对齐前端 `invokeCommentPost`：`articleId`、`commentContent`。
#[tauri::command(rename_all = "camelCase")]
pub async fn comment_post(
    state: State<'_, AppState>,
    request: CommentPostRequest,
) -> Result<SendResult, AppError> {
    let article_id = require_nonempty(&request.article_id, "文章 ID 不能为空")?;
    let content = require_nonempty(&request.comment_content, "评论内容不能为空")?;
    let data = to_sdk_post(article_id, content, &request);

    let (client, session_generation) = require_client(&state)?;
    let result = client.comment().post(data).await;
    ensure_same_session(&state, session_generation)?;
    map_send_result(session_generation, result)
}

/// Bridge DTO → SDK `CommentPost`。API 需要的字段都带上；`visible` 用 SDK 默认 `false`。
fn to_sdk_post(article_id: String, content: String, request: &CommentPostRequest) -> CommentPost {
    let reply_id = request
        .reply_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .unwrap_or("");
    CommentPost::new(article_id, content)
        .with_anonymous(request.anonymous.unwrap_or(false))
        .with_reply_id(reply_id)
}
