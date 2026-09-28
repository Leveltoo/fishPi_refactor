//! 立刻设置主窗口是否置顶。
//!
//! 只改当前窗口状态，不写 Store。持久化由 `settings_set` 负责。

use tauri::{AppHandle, Manager};

use crate::dto::AlwaysOnTopRequest;
use crate::error::AppError;

/// 对 label 为 `main` 的主窗口调用 `set_always_on_top`。
#[tauri::command(rename_all = "camelCase")]
pub fn window_set_always_on_top(
    app: AppHandle,
    request: AlwaysOnTopRequest,
) -> Result<(), AppError> {
    let on = request.value().map_err(AppError::business)?;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::business("找不到主窗口"))?;
    window
        .set_always_on_top(on)
        .map_err(|_| AppError::business("设置窗口置顶失败"))?;
    Ok(())
}
