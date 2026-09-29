//! 记住并恢复主窗口尺寸。最小宽度 350，对齐旧版 `minWidth`。
//!
//! 尺寸写入 `desktop-prefs.json`，不含凭据。读失败用默认 800×600。

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::{LogicalSize, Manager};

use crate::commands::config_import::{load_prefs, save_prefs};

const MAIN_WINDOW_LABEL: &str = "main";
const MIN_WIDTH: f64 = 350.0;
const MIN_HEIGHT: f64 = 200.0;

static SAVE_GEN: AtomicU64 = AtomicU64::new(0);

/// 冷启动套上次尺寸，并在缩放后写回。找不到主窗口就返回。
pub fn install(app: &tauri::App) {
    apply_saved_size(app);
    listen_resize(app);
}

fn apply_saved_size(app: &tauri::App) {
    let prefs = load_prefs(app.handle());
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let _ = window.set_min_size(Some(LogicalSize::new(MIN_WIDTH, MIN_HEIGHT)));
    let width = f64::from(prefs.window_width.max(350));
    let height = f64::from(prefs.window_height.max(200));
    let _ = window.set_size(LogicalSize::new(width, height));
}

fn listen_resize(app: &tauri::App) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let app_handle = app.handle().clone();
    let tracked = window.clone();
    window.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::Resized(size) => {
                if size.width == 0 || size.height == 0 {
                    return;
                }
                let scale = tracked.scale_factor().unwrap_or(1.0);
                if scale <= 0.0 {
                    return;
                }
                let width = ((f64::from(size.width) / scale).round() as u32).max(350);
                let height = ((f64::from(size.height) / scale).round() as u32).max(200);
                persist_later(app_handle.clone(), width, height);
            }
            tauri::WindowEvent::Focused(true) => {
                crate::tray::reset_flash(&app_handle);
            }
            _ => {}
        }
    });
}

fn persist_later(app: tauri::AppHandle, width: u32, height: u32) {
    let generation = SAVE_GEN.fetch_add(1, Ordering::Relaxed) + 1;
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(280));
        if SAVE_GEN.load(Ordering::Relaxed) != generation {
            return;
        }
        let mut prefs = load_prefs(&app);
        if prefs.window_width == width && prefs.window_height == height {
            return;
        }
        prefs.window_width = width;
        prefs.window_height = height;
        let _ = save_prefs(&app, &prefs);
    });
}
