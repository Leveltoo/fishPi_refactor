//! 主窗口关闭请求：关到托盘，不是退出。
//!
//! 关闭到托盘 ≠ 退出。点窗口关闭只按 `close_to_tray` 决定藏起来还是真正关掉。
//! 退出只走托盘菜单「退出」。这里不创建托盘图标，不 `exit`，也不拆 WebSocket。

use tauri::Manager;

use crate::dto::AppSettings;

/// 监听 label `main` 的窗口事件。找不到主窗口就返回，不 panic。
pub fn install(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let app_handle = app.handle().clone();
    let window_to_hide = window.clone();
    window.on_window_event(move |event| {
        on_close_requested(&app_handle, &window_to_hide, event);
    });
}

fn on_close_requested(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    event: &tauri::WindowEvent,
) {
    let tauri::WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };

    // 关闭到托盘 ≠ 退出。用户还在线：不退出进程，不拆 WS。
    // 退出只走托盘菜单「退出」。
    if !close_to_tray(app) {
        return;
    }

    api.prevent_close();
    let _ = window.hide();
}

/// 读失败当成 [`AppSettings::default`]（`close_to_tray` 默认 true）。
fn close_to_tray(app: &tauri::AppHandle) -> bool {
    crate::commands::settings_get::load_app_settings(app)
        .map(|settings| settings.close_to_tray)
        .unwrap_or_else(|_| AppSettings::default().close_to_tray)
}
