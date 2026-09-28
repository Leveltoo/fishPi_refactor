//! 老板键：全局快捷键切换主窗口显隐。
//!
//! 已注册的热键字符串只留在本模块内存里，便于换绑。
//! 不写入凭据存储，也不打日志（避免和 token 一类敏感字段混在一起）。

use std::str::FromStr;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

use crate::commands::settings_get::load_app_settings;
use crate::dto::DEFAULT_BOSS_HOTKEY;
use crate::error::AppError;

/// 主窗口 label。与冷启动、窗口外观命令一致。
const MAIN_WINDOW_LABEL: &str = "main";

/// 当前已成功注册的热键字符串。插件按快捷键本身分配 id，这里记住字符串即可替换。
static REGISTERED_HOTKEY: Mutex<Option<String>> = Mutex::new(None);

/// 冷启动注册。失败不 panic：返回 Err 字符串，调用方忽略，窗口仍要能开。
pub fn install(app: &tauri::App) -> Result<(), String> {
    let hotkey = load_app_settings(app.handle())
        .map(|settings| settings.boss_hotkey().to_string())
        .unwrap_or_else(|_| DEFAULT_BOSS_HOTKEY.to_string());
    rebind(app.handle(), &hotkey).map_err(|err| err.message().to_string())
}

/// 设置保存后重绑。失败用 [`AppError::business`]，文案给用户，不转发系统原文。
pub fn rebind(app: &tauri::AppHandle, hotkey: &str) -> Result<(), crate::error::AppError> {
    let hotkey = hotkey.trim();
    if hotkey.is_empty() {
        return Err(AppError::business("hotkey 不能为空"));
    }
    let parsed = Shortcut::from_str(hotkey).map_err(|_| AppError::business("老板键格式无效"))?;

    let mut registered = REGISTERED_HOTKEY
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    if registered
        .as_deref()
        .is_some_and(|current| same_shortcut(current, parsed))
    {
        *registered = Some(hotkey.to_string());
        return Ok(());
    }

    let shortcuts = app.global_shortcut();
    let previous = registered.clone();
    // 2.x 的 `on_shortcut` 允许新旧热键并存，所以先注册新的，成功后再卸旧的。
    // 不能先卸：卸完再注册失败就会没有老板键。若必须先卸，失败时把旧键注册回去。
    if let Err(err) = register_keeping_previous(shortcuts, hotkey, previous.as_deref()) {
        return Err(err);
    }

    if let Some(old) = registered.replace(hotkey.to_string()) {
        if shortcuts.unregister(old.as_str()).is_err() {
            let _ = shortcuts.unregister(old.as_str());
        }
    }
    Ok(())
}

/// 先注册 `next`。失败且旧键已不在系统里时，尝试把 `previous` 注册回去。
fn register_keeping_previous(
    shortcuts: &tauri_plugin_global_shortcut::GlobalShortcut<tauri::Wry>,
    next: &str,
    previous: Option<&str>,
) -> Result<(), AppError> {
    if shortcuts.on_shortcut(next, on_boss_key).is_ok() {
        return Ok(());
    }

    let previous_still_registered = previous.is_some_and(|old| shortcuts.is_registered(old));
    if !previous_still_registered {
        if let Some(old) = previous {
            let _ = shortcuts.on_shortcut(old, on_boss_key);
        }
    }
    Err(AppError::business("注册老板键失败"))
}

fn same_shortcut(registered: &str, next: Shortcut) -> bool {
    Shortcut::from_str(registered)
        .map(|current| current.id() == next.id())
        .unwrap_or(false)
}

/// 只处理按下。松开不切换窗口。
fn on_boss_key(app: &AppHandle, _shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    toggle_main(app);
}

/// 主窗口当前可见且未最小化则隐藏，否则显示、取消最小化并聚焦。
fn toggle_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(true);
    if visible && !minimized {
        let _ = window.hide();
        return;
    }
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}
