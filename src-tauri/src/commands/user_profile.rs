//! 用户名片：按用户名拉公开资料。只读，不含邮箱、token、勋章明细。

use tauri::State;

use crate::commands::common::{ensure_same_session, require_client, require_nonempty};
use crate::dto::{UserProfileDto, UserProfileRequest, UserProfileResult};
use crate::error::AppError;
use crate::state::AppState;

/// 按用户名查询公开资料，供 overlay 名片使用。
#[tauri::command(rename_all = "camelCase")]
pub async fn user_profile(
    state: State<'_, AppState>,
    request: UserProfileRequest,
) -> Result<UserProfileResult, AppError> {
    let user_name = require_nonempty(&request.user_name, "用户名不能为空")?;
    let (client, session_generation) = require_client(&state)?;
    let user = client.user().profile(user_name).await?;
    ensure_same_session(&state, session_generation)?;
    Ok(UserProfileResult::new(
        session_generation,
        UserProfileDto::from(user),
    ))
}
