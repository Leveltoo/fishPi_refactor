//! 网络恢复 / 休眠唤醒后各尝试一次现有 connect。
//!
//! SDK 1.1.0 的 `ChatRoomConnection::reconnect` 等需要 `&mut` 句柄。
//! `AppState` 只有 `take_*`（会作废代次并拆掉已挂上的监听）和幂等 `connect`
//! （句柄还在就直接返回）。这里不拆监听、不循环重试。句柄仍在时界面标明未自动重连。

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::dto::ChatConnectRequest;
use crate::state::AppState;

const EVENT: &str = "desktop://reconnect";

static BUSY: AtomicBool = AtomicBool::new(false);
static POWER_ARMED: AtomicBool = AtomicBool::new(false);
static NET_ARMED: AtomicBool = AtomicBool::new(false);
static LAST_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchReport {
    pub watching: bool,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconnectReport {
    pub attempted: bool,
    pub relinked: bool,
    pub message: String,
    pub chatroom: String,
    pub chat: String,
    pub notice: String,
}

/// 注册一次系统监听。重复调用不会再注册。
#[tauri::command(rename_all = "camelCase")]
pub fn reconnect_watch(app: AppHandle) -> WatchReport {
    let _ = WATCH_APP.set(app);
    arm_watchers()
}

/// 立刻尝试一次。已有句柄的通道跳过，避免空转 connect。
#[tauri::command(rename_all = "camelCase")]
pub async fn reconnect_now(app: AppHandle) -> Result<ReconnectReport, AppError> {
    Ok(attempt(&app).await)
}

use crate::error::AppError;

static WATCH_APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

async fn attempt(app: &AppHandle) -> ReconnectReport {
    if BUSY.swap(true, Ordering::AcqRel) {
        return ReconnectReport {
            attempted: false,
            relinked: false,
            message: "上一次重连尚未结束，未再次发起".to_string(),
            chatroom: "未尝试".to_string(),
            chat: "未尝试".to_string(),
            notice: "未尝试".to_string(),
        };
    }
    let report = attempt_inner(app).await;
    BUSY.store(false, Ordering::Release);
    report
}

async fn attempt_inner(app: &AppHandle) -> ReconnectReport {
    let state = app.state::<AppState>();
    if !state.has_session() {
        return ReconnectReport {
            attempted: false,
            relinked: false,
            message: "未登录，未重连".to_string(),
            chatroom: "未尝试".to_string(),
            chat: "未尝试".to_string(),
            notice: "未尝试".to_string(),
        };
    }

    let chatroom = one_channel(
        state.has_chatroom_connection(),
        super::chatroom_connect(app.clone(), state.clone()),
    )
    .await;
    let chat = one_channel(state.has_global_chat(), async {
        super::chat_connect(app.clone(), state.clone(), ChatConnectRequest::default()).await
    })
    .await;
    let notice = one_channel(state.has_notice_connection(), async {
        super::notice_connect(app.clone(), state.clone()).await
    })
    .await;

    let steps = [&chatroom, &chat, &notice];
    let relinked = steps.iter().any(|step| matches!(step, Step::Fresh));
    let blocked = steps.iter().any(|step| matches!(step, Step::Blocked));
    let failed = steps.iter().any(|step| matches!(step, Step::Failed(_)));
    let message = if blocked {
        "未自动重连。已有连接句柄时不能调用 SDK reconnect，否则会拆掉现有监听。".to_string()
    } else if relinked && !failed {
        "已重新连接".to_string()
    } else if relinked {
        "部分通道已重新连接，失败的通道没有重试".to_string()
    } else {
        "重连失败，没有重试".to_string()
    };

    ReconnectReport {
        attempted: true,
        relinked,
        message,
        chatroom: chatroom.text(),
        chat: chat.text(),
        notice: notice.text(),
    }
}

enum Step {
    Blocked,
    Fresh,
    Failed(String),
}

impl Step {
    fn text(&self) -> String {
        match self {
            Step::Blocked => "句柄仍在，未自动重连".to_string(),
            Step::Fresh => "已重新连接".to_string(),
            Step::Failed(message) => message.clone(),
        }
    }
}

async fn one_channel<F, T, E>(blocked: bool, connect: F) -> Step
where
    F: std::future::Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    if blocked {
        return Step::Blocked;
    }
    match connect.await {
        Ok(_) => Step::Fresh,
        Err(err) => Step::Failed(clip(&err.to_string())),
    }
}

fn clip(text: &str) -> String {
    text.chars().take(80).collect()
}

fn schedule_once() {
    let Some(app) = WATCH_APP.get() else {
        return;
    };
    if !claim_slot() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let report = attempt(&app).await;
        let _ = app.emit(EVENT, report);
    });
}

fn claim_slot() -> bool {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    let mut previous = LAST_MS.load(Ordering::Relaxed);
    loop {
        if now.saturating_sub(previous) < 8_000 {
            return false;
        }
        match LAST_MS.compare_exchange(previous, now, Ordering::AcqRel, Ordering::Relaxed) {
            Ok(_) => return true,
            Err(value) => previous = value,
        }
    }
}

#[cfg(windows)]
fn arm_watchers() -> WatchReport {
    let power = arm_power();
    let net = arm_net();
    let watching = power || net;
    let message = match (power, net) {
        (true, true) => "已监听网络恢复和休眠唤醒。已有句柄时不会自动重连。",
        (true, false) => "已监听休眠唤醒，网络监听没有注册成功。",
        (false, true) => "已监听网络恢复，休眠唤醒没有注册成功。",
        (false, false) => "没能监听系统恢复。可以手动重连一次。",
    };
    WatchReport {
        watching,
        message: message.to_string(),
    }
}

#[cfg(not(windows))]
fn arm_watchers() -> WatchReport {
    WatchReport {
        watching: false,
        message: "只有 Windows 会监听恢复网络和休眠唤醒。可以手动重连一次。".to_string(),
    }
}

#[cfg(windows)]
fn arm_power() -> bool {
    if POWER_ARMED.swap(true, Ordering::AcqRel) {
        return true;
    }
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::Power::{
        PowerRegisterSuspendResumeNotification, DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::DEVICE_NOTIFY_CALLBACK;

    let params = Box::leak(Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
        Callback: Some(on_power),
        Context: std::ptr::null_mut(),
    }));
    let mut registration = std::ptr::null_mut();
    let status = unsafe {
        PowerRegisterSuspendResumeNotification(
            DEVICE_NOTIFY_CALLBACK,
            params as *mut DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS as HANDLE,
            &mut registration,
        )
    };
    if status == 0 {
        true
    } else {
        POWER_ARMED.store(false, Ordering::Release);
        false
    }
}

#[cfg(windows)]
fn arm_net() -> bool {
    if NET_ARMED.swap(true, Ordering::AcqRel) {
        return true;
    }
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::NetworkManagement::IpHelper::NotifyNetworkConnectivityHintChange;

    let mut registration: HANDLE = std::ptr::null_mut();
    let status = unsafe {
        NotifyNetworkConnectivityHintChange(Some(on_network), std::ptr::null(), 0, &mut registration)
    };
    if status == 0 {
        true
    } else {
        NET_ARMED.store(false, Ordering::Release);
        false
    }
}

#[cfg(windows)]
unsafe extern "system" fn on_power(
    _context: *const core::ffi::c_void,
    kind: u32,
    _setting: *const core::ffi::c_void,
) -> u32 {
    // PBT_APMRESUMESUSPEND / PBT_APMRESUMEAUTOMATIC
    if kind == 0x0007 || kind == 0x0012 {
        schedule_once();
    }
    0
}

#[cfg(windows)]
unsafe extern "system" fn on_network(
    _context: *const core::ffi::c_void,
    hint: windows_sys::Win32::Networking::WinSock::NL_NETWORK_CONNECTIVITY_HINT,
) {
    use windows_sys::Win32::Networking::WinSock::{
        NetworkConnectivityLevelHintConstrainedInternetAccess,
        NetworkConnectivityLevelHintInternetAccess,
    };
    if hint.ConnectivityLevel == NetworkConnectivityLevelHintInternetAccess
        || hint.ConnectivityLevel == NetworkConnectivityLevelHintConstrainedInternetAccess
    {
        schedule_once();
    }
}
