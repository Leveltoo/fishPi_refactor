//! 系统托盘：左键 / 双击显示主窗口，菜单可重新显示或真正退出。
//!
//! 新消息且窗口未聚焦时闪任务栏 / 托盘。聚焦后停。
//! 托盘不读 token，不发社区请求。不在这里注册 `CloseRequested`。

use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::Duration;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::error::AppError;

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "main";
const SHOW_MENU_ID: &str = "show";
const QUIT_MENU_ID: &str = "quit";

struct FlashState {
    generation: u64,
}

static FLASH: Mutex<FlashState> = Mutex::new(FlashState { generation: 0 });
static FLASH_GEN: AtomicU64 = AtomicU64::new(0);

/// 安装系统托盘。没有默认窗口图标时返回错误，不 panic。
pub fn install(app: &tauri::App) -> Result<(), String> {
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "缺少默认窗口图标，无法创建托盘".to_string())?;

    let show = MenuItem::with_id(app, SHOW_MENU_ID, "显示", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let quit = MenuItem::with_id(app, QUIT_MENU_ID, "退出", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let menu = Menu::with_items(app, &[&show, &quit]).map_err(|error| error.to_string())?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("摸鱼派")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            SHOW_MENU_ID => show_main(app),
            QUIT_MENU_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => {
                show_main(tray.app_handle());
            }
            _ => {}
        })
        .build(app)
        .map_err(|error| error.to_string())?;

    Ok(())
}

/// 新消息到来且窗口未聚焦时闪任务栏 / 托盘。聚焦后停。
#[tauri::command(rename_all = "camelCase")]
pub fn tray_flash(app: AppHandle) -> Result<(), AppError> {
    flash(&app);
    Ok(())
}

pub fn reset_flash(app: &AppHandle) {
    FLASH_GEN.fetch_add(1, Ordering::Relaxed);
    if let Ok(mut state) = FLASH.lock() {
        state.generation = FLASH_GEN.load(Ordering::Relaxed);
    }
    restore_icon(app);
    stop_window_flash(app);
}

fn flash(app: &AppHandle) {
    if window_is_active(app) {
        return;
    }
    flash_window(app);
    blink_tray(app);
}

fn show_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    reset_flash(app);
}

fn window_is_active(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return false;
    };
    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(true);
    let focused = window.is_focused().unwrap_or(false);
    visible && !minimized && focused
}

fn blink_tray(app: &AppHandle) {
    let generation = FLASH_GEN.fetch_add(1, Ordering::Relaxed) + 1;
    if let Ok(mut state) = FLASH.lock() {
        state.generation = generation;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        for tick in 0..12 {
            if FLASH_GEN.load(Ordering::Relaxed) != generation {
                restore_icon(&handle);
                return;
            }
            if tick % 2 == 0 {
                restore_icon(&handle);
            } else if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                let empty = Image::new(&[0, 0, 0, 0], 1, 1);
                let _ = tray.set_icon(Some(empty));
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        restore_icon(&handle);
    });
}

fn restore_icon(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    if let Some(icon) = app.default_window_icon() {
        let _ = tray.set_icon(Some(icon.clone()));
    }
}

#[cfg(windows)]
fn flash_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let Ok(handle) = window.hwnd() else {
        return;
    };
    let hwnd: *mut std::ffi::c_void = unsafe { std::mem::transmute_copy(&handle) };
    unsafe {
        flash_hwnd(hwnd, true);
    }
}

#[cfg(windows)]
fn stop_window_flash(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let Ok(handle) = window.hwnd() else {
        return;
    };
    let hwnd: *mut std::ffi::c_void = unsafe { std::mem::transmute_copy(&handle) };
    unsafe {
        flash_hwnd(hwnd, false);
    }
}

#[cfg(not(windows))]
fn flash_window(_app: &AppHandle) {}

#[cfg(not(windows))]
fn stop_window_flash(_app: &AppHandle) {}

#[cfg(windows)]
unsafe fn flash_hwnd(hwnd: *mut std::ffi::c_void, start: bool) {
    const FLASHW_STOP: u32 = 0;
    const FLASHW_ALL: u32 = 3;
    const FLASHW_TIMERNOFG: u32 = 12;

    #[repr(C)]
    struct FlashInfo {
        cb_size: u32,
        hwnd: *mut std::ffi::c_void,
        flags: u32,
        count: u32,
        timeout: u32,
    }

    extern "system" {
        fn FlashWindowEx(info: *const FlashInfo) -> i32;
    }

    let info = FlashInfo {
        cb_size: std::mem::size_of::<FlashInfo>() as u32,
        hwnd,
        flags: if start {
            FLASHW_ALL | FLASHW_TIMERNOFG
        } else {
            FLASHW_STOP
        },
        count: 0,
        timeout: 0,
    };
    let _ = FlashWindowEx(&info);
}
