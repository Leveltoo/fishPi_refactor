//! 网络恢复 / 休眠唤醒后重连原句柄，保留 SDK handler 与业务监听。
//! 网络等待在状态锁外；换号或断开后拒绝放回旧连接。

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::dto::{ChatConnectRequest, ConnectionStatus};
use crate::realtime::{emit_cached_chatroom_presence, emit_connection_status};
use crate::state::AppState;
use std::time::Duration;

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
    pub session_generation: u64,
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

/// 立刻重连一次，结果同时通知聊天页面补拉历史。
#[tauri::command(rename_all = "camelCase")]
pub async fn reconnect_now(app: AppHandle) -> Result<ReconnectReport, AppError> {
    let report = attempt(&app).await;
    let _ = app.emit(EVENT, &report);
    Ok(report)
}

use crate::error::AppError;

static WATCH_APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

async fn attempt(app: &AppHandle) -> ReconnectReport {
    if BUSY.swap(true, Ordering::AcqRel) {
        return ReconnectReport {
            session_generation: app.state::<AppState>().session_generation(),
            attempted: false,
            relinked: false,
            message: "上一次重连尚未结束，未再次发起".to_string(),
            chatroom: "未尝试".to_string(),
            chat: "未尝试".to_string(),
            notice: "未尝试".to_string(),
        };
    }
    struct BusyGuard;
    impl Drop for BusyGuard {
        fn drop(&mut self) {
            BUSY.store(false, Ordering::Release);
        }
    }
    let _busy = BusyGuard;
    let report = attempt_inner(app).await;
    report
}

async fn attempt_inner(app: &AppHandle) -> ReconnectReport {
    let state = app.state::<AppState>();
    if !state.has_session() {
        return ReconnectReport {
            session_generation: state.session_generation(),
            attempted: false,
            relinked: false,
            message: "未登录，未重连".to_string(),
            chatroom: "未尝试".to_string(),
            chat: "未尝试".to_string(),
            notice: "未尝试".to_string(),
        };
    }

    let connections = state.take_for_reconnect();
    let session = connections.session_generation;
    let chatroom = match connections.chatroom {
        Some(mut connection) => {
            emit_connection_status(
                app,
                session,
                connections.connection_generation,
                ConnectionStatus::Reconnecting,
            );
            let result = if state.session_generation() == session
                && state.connection_generation() == connections.connection_generation
            {
                reconnect_step(connection.reconnect()).await
            } else {
                Step::Failed("会话或连接已切换".into())
            };
            match state.restore_reconnected_chatroom(
                session,
                connections.connection_generation,
                connection,
            ) {
                Ok(()) => {
                    let status = if matches!(result, Step::Fresh) {
                        ConnectionStatus::Connected
                    } else {
                        ConnectionStatus::Unknown
                    };
                    emit_connection_status(app, session, connections.connection_generation, status);
                    if matches!(result, Step::Fresh) {
                        emit_cached_chatroom_presence(app);
                    }
                    result
                }
                Err(mut rejected) => {
                    rejected.disconnect();
                    Step::Failed("会话或连接已切换，未恢复旧连接".into())
                }
            }
        }
        None if state.session_generation() == session => {
            reconnect_step(super::chatroom_connect(app.clone(), state.clone())).await
        }
        None => Step::Failed("会话已切换".into()),
    };
    let global = match connections.global_chat {
        Some((generation, mut connection)) => {
            let result = if state.session_generation() == session
                && state.global_chat_generation() == Some(generation)
            {
                reconnect_step(connection.reconnect()).await
            } else {
                Step::Failed("会话或私聊已切换".into())
            };
            match state.install_global_chat(session, generation, connection) {
                Ok(_) => result,
                Err(mut rejected) => {
                    rejected.disconnect();
                    Step::Failed("会话已切换，未恢复旧私聊连接".into())
                }
            }
        }
        None if state.has_global_chat() => Step::Failed("私聊连接仍在建立，未重复连接".into()),
        None if state.session_generation() == session => {
            reconnect_step(super::chat_connect(
                app.clone(),
                state.clone(),
                ChatConnectRequest::default(),
            ))
            .await
        }
        None => Step::Failed("会话已切换".into()),
    };
    let mut chats = vec![global];
    for (user, generation, mut connection) in connections.chats {
        let result = if state.session_generation() == session
            && state.user_chat_generation(&user) == Some(generation)
        {
            reconnect_step(connection.reconnect()).await
        } else {
            Step::Failed("会话或私聊已切换".into())
        };
        match state.install_user_chat(&user, session, generation, connection) {
            Ok(_) => chats.push(result),
            Err(mut rejected) => {
                rejected.disconnect();
                chats.push(Step::Failed("会话或私聊已切换".into()));
            }
        }
    }
    let chat = aggregate(&chats);
    let notice = match connections.notice {
        Some((generation, mut connection)) => {
            let result = if state.session_generation() == session
                && state.notice_generation() == Some(generation)
            {
                reconnect_step(connection.reconnect()).await
            } else {
                Step::Failed("会话已切换".into())
            };
            match state.install_notice_connection(session, generation, connection) {
                Ok(_) => result,
                Err(mut rejected) => {
                    rejected.disconnect();
                    Step::Failed("会话已切换，未恢复旧通知连接".into())
                }
            }
        }
        None if state.has_notice_connection() => {
            Step::Failed("通知连接仍在建立，未重复连接".into())
        }
        None if state.session_generation() == session => {
            reconnect_step(super::notice_connect(app.clone(), state.clone())).await
        }
        None => Step::Failed("会话已切换".into()),
    };

    let steps = [&chatroom, &chat, &notice];
    let relinked = steps
        .iter()
        .any(|step| matches!(step, Step::Fresh | Step::Partial(_)));
    let failed = steps
        .iter()
        .any(|step| matches!(step, Step::Failed(_) | Step::Partial(_)));
    let message = if relinked && !failed {
        "已重新连接".to_string()
    } else if relinked {
        "部分通道已重新连接，失败的通道没有重试".to_string()
    } else {
        "重连失败，没有重试".to_string()
    };

    ReconnectReport {
        session_generation: session,
        attempted: true,
        relinked,
        message,
        chatroom: chatroom.text(),
        chat: chat.text(),
        notice: notice.text(),
    }
}

enum Step {
    Fresh,
    Partial(String),
    Failed(String),
}

impl Step {
    fn text(&self) -> String {
        match self {
            Step::Fresh => "已重新连接".to_string(),
            Step::Partial(_) => "部分私聊通道已重新连接".to_string(),
            Step::Failed(message) => message.clone(),
        }
    }
}

async fn reconnect_step<F, T, E>(connect: F) -> Step
where
    F: std::future::Future<Output = Result<T, E>>,
    E: Into<AppError>,
{
    match tokio::time::timeout(Duration::from_secs(20), connect).await {
        Ok(Ok(_)) => Step::Fresh,
        Ok(Err(error)) => Step::Failed(clip(error.into().message())),
        Err(_) => Step::Failed("重连超时".into()),
    }
}

fn aggregate(steps: &[Step]) -> Step {
    match steps.iter().find_map(|step| match step {
        Step::Failed(message) => Some(message.clone()),
        Step::Partial(message) => Some(message.clone()),
        Step::Fresh => None,
    }) {
        Some(message)
            if steps
                .iter()
                .any(|step| matches!(step, Step::Fresh | Step::Partial(_))) =>
        {
            Step::Partial(message)
        }
        Some(message) => Step::Failed(message),
        None => Step::Fresh,
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
        (true, true) => "已监听网络恢复和休眠唤醒，恢复后重连各通道并刷新消息。",
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
        NotifyNetworkConnectivityHintChange(
            Some(on_network),
            std::ptr::null(),
            0,
            &mut registration,
        )
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reconnect_reports_success_and_failure() {
        assert!(matches!(
            reconnect_step(async { Ok::<_, AppError>(()) }).await,
            Step::Fresh
        ));
        assert!(matches!(
            reconnect_step(async { Err::<(), _>(AppError::business("failed")) }).await,
            Step::Failed(_)
        ));
        assert!(matches!(
            aggregate(&[Step::Fresh, Step::Fresh]),
            Step::Fresh
        ));
        assert!(matches!(
            aggregate(&[Step::Fresh, Step::Failed("failed".into())]),
            Step::Partial(_)
        ));
        assert!(matches!(
            aggregate(&[Step::Failed("failed".into())]),
            Step::Failed(_)
        ));
    }
}
