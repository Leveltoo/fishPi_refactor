//! 立刻设置主窗口透明度。
//!
//! 本仓库 Tauri 2.11.6 的 Window **没有** `set_opacity`。
//! `set_effects` 只做亚克力/模糊，不是整窗透明度，且内部吞掉失败仍返回 `Ok`。
//! Windows 对主窗口 HWND 调用 `SetLayeredWindowAttributes`。不写 Store。

use tauri::{AppHandle, Manager};

use crate::dto::{OpacityRequest, OPACITY_MAX, OPACITY_MIN};
use crate::error::AppError;

/// 对 label 为 `main` 的主窗口立刻设置透明度。越界不静默夹紧。
#[tauri::command(rename_all = "camelCase")]
pub fn window_set_opacity(app: AppHandle, request: OpacityRequest) -> Result<(), AppError> {
    if !(OPACITY_MIN..=OPACITY_MAX).contains(&request.opacity) {
        return Err(AppError::business("透明度必须在 0.1 到 1 之间"));
    }

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::business("找不到主窗口"))?;

    apply_window_opacity(&window, request.opacity)
}

#[cfg(windows)]
fn apply_window_opacity(window: &tauri::WebviewWindow, opacity: f64) -> Result<(), AppError> {
    let handle = window
        .hwnd()
        .map_err(|_| AppError::business("设置窗口透明度失败"))?;
    let hwnd: *mut std::ffi::c_void = unsafe { std::mem::transmute_copy(&handle) };
    let alpha = (opacity * 255.0).round() as u8;
    if unsafe { set_layered_alpha(hwnd, alpha) } {
        Ok(())
    } else {
        Err(AppError::business("设置窗口透明度失败"))
    }
}

#[cfg(not(windows))]
fn apply_window_opacity(_window: &tauri::WebviewWindow, _opacity: f64) -> Result<(), AppError> {
    Err(AppError::business("设置窗口透明度失败"))
}

/// 给窗口加上 `WS_EX_LAYERED` 再写 alpha。失败返回 false，由调用方报 business。
#[cfg(windows)]
unsafe fn set_layered_alpha(hwnd: *mut std::ffi::c_void, alpha: u8) -> bool {
    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_LAYERED: isize = 0x0008_0000;
    const LWA_ALPHA: u32 = 0x0000_0002;

    extern "system" {
        fn GetWindowLongPtrW(hwnd: *mut std::ffi::c_void, index: i32) -> isize;
        fn SetWindowLongPtrW(hwnd: *mut std::ffi::c_void, index: i32, new_long: isize) -> isize;
        fn SetLayeredWindowAttributes(
            hwnd: *mut std::ffi::c_void,
            key: u32,
            alpha: u8,
            flags: u32,
        ) -> i32;
    }

    let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    if style & WS_EX_LAYERED == 0 {
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | WS_EX_LAYERED);
    }
    SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA) != 0
}
