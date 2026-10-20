//! 设置页测试通知。
//!
//! 只在用户已开启系统通知时发送。权限被拒绝或插件发送失败必须是 business，
//! 不得 panic，也不得把系统错误原文（可能含路径）传给前端。

#[cfg(not(windows))]
use tauri_plugin_notification::NotificationExt;

use crate::error::AppError;
use crate::state::AppState;

/// 按设置页请求弹出一条系统通知。
#[tauri::command(rename_all = "camelCase")]
pub fn notify_show(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
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
    if title.len() > 512 || body.len() > 4096 {
        return Err(AppError::business("通知内容过长"));
    }
    let session = state.session_snapshot();
    if request.session_generation.is_some_and(|value| value != session.session_generation) {
        return Err(AppError::session_superseded());
    }
    if let Some(target) = &request.target {
        if !target.is_valid() {
            return Err(AppError::business("通知目标无效"));
        }
        if request.session_generation.is_none() || !session.has_client || session.user.is_none() {
            return Err(AppError::unauthorized());
        }
    }

    let settings = crate::commands::settings_get::load_app_settings(&app)?;
    if !settings.notify_enabled {
        return Err(AppError::business("系统通知已关闭"));
    }

    #[cfg(windows)]
    {
        show_windows_notification(
            &app, title, body, request.target.clone(), session.session_generation,
        )
    }
    #[cfg(not(windows))]
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|_| AppError::business("发送系统通知失败"))
}

#[cfg(windows)]
fn show_windows_notification(
    app: &tauri::AppHandle,
    title: &str,
    body: &str,
    target: Option<crate::dto::settings::NotificationTarget>,
    session_generation: u64,
) -> Result<(), AppError> {
    use tauri::{Emitter, Manager};
    use tauri_winrt_notification::Toast;

    let exe = tauri::utils::platform::current_exe()
        .map_err(|_| AppError::business("无法读取通知应用信息"))?;
    let parent = exe.parent().ok_or_else(|| AppError::business("无法读取通知应用信息"))?;
    let unpackaged = parent.ends_with(std::path::Path::new("target").join("debug"))
        || parent.ends_with(std::path::Path::new("target").join("release"));
    // Match the existing plugin's identity for uninstalled test executables.
    let app_id = if unpackaged { Toast::POWERSHELL_APP_ID } else { &app.config().identifier };
    let activated_app = app.clone();
    Toast::new(app_id)
        .title(title)
        .text1(body)
        .sound(None)
        .on_activated(move |_| {
            let app = activated_app.clone();
            let target = target.clone();
            let _ = activated_app.run_on_main_thread(move || {
                let current = app.state::<AppState>().session_snapshot();
                if !current.has_client || current.user.is_none()
                    || current.session_generation != session_generation {
                    return;
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    crate::tray::reset_flash(&app);
                    if let Some(target) = target {
                        let _ = app.emit_to("main", "desktop://notification-click",
                            serde_json::json!({
                                "sessionGeneration": session_generation,
                                "target": target,
                            }));
                    }
                }
            });
            Ok(())
        })
        .show()
        .map_err(|_| AppError::business("发送系统通知失败"))
}
