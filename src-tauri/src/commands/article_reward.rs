//! 打赏帖子。写操作。
//!
//! SDK `reward()` 成功是 `()`，不带回隐藏正文。
//! 只有打赏确定成功，且随后的详情 `rewarded == true`，才返回可见正文。
//! 失败、超时、详情未确认打赏时都不带正文。

use tauri::State;

use crate::commands::common::{ensure_same_session, is_uncertain_write, require_client, require_nonempty};
use crate::dto::{ArticleDetailDto, ArticleIdRequest, ArticleRewardResult};
use crate::error::AppError;
use crate::state::AppState;

const REWARD_DETAIL_PAGE: u32 = 1;

/// 打赏。未确认前 `rewarded` 为 false，且没有 `rewardContent`。
#[tauri::command(rename_all = "camelCase")]
pub async fn article_reward(
    state: State<'_, AppState>,
    request: ArticleIdRequest,
) -> Result<ArticleRewardResult, AppError> {
    let id = require_nonempty(&request.id, "帖子 ID 不能为空")?;
    let (client, session_generation) = require_client(&state)?;
    let result = client.article().reward(id.clone()).await;
    ensure_same_session(&state, session_generation)?;
    match result {
        Ok(()) => {}
        Err(err) if is_uncertain_write(&err) => {
            return Ok(ArticleRewardResult::unconfirmed(session_generation));
        }
        Err(err) => return Err(AppError::from(err)),
    }

    let detail = match client.article().detail(id, REWARD_DETAIL_PAGE).await {
        Ok(detail) => detail,
        Err(_) => return Ok(ArticleRewardResult::unconfirmed(session_generation)),
    };
    ensure_same_session(&state, session_generation)?;
    let dto = ArticleDetailDto::from_sdk(detail);
    if !dto.rewarded {
        return Ok(ArticleRewardResult::unconfirmed(session_generation));
    }
    Ok(ArticleRewardResult::opened(
        session_generation,
        dto.reward_content,
        dto.rewarded_count,
    ))
}
