//! 设置页测试通知。
//!
//! 只在用户已开启系统通知时发送。权限被拒绝或插件发送失败必须是 business，
//! 不得 panic，也不得把系统错误原文（可能含路径）传给前端。

use tauri_plugin_notification::NotificationExt;

use crate::error::AppError;

/// 按设置页请求弹出一条系统通知。
#[tauri::command(rename_all = "camelCase")]
pub fn notify_show(
    app: tauri::AppHandle,
    request: crate::dto::NotifyShowRequest,
) -> Result<(), crate::error::AppError> {
    let title = request.title.trim();
    let body = request.body.trim();
    if title.is_empty() {
        return Err(AppError::business("通知标题不能为空"));
    }
    if body.is_empty() {
        return Err(AppError::business("通知内容不能为空"));
    }

    let settings = crate::commands::settings_get::load_app_settings(&app)?;
    if !settings.notify_enabled {
        return Err(AppError::business("系统通知已关闭"));
    }

    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|_| AppError::business("发送系统通知失败"))
}
