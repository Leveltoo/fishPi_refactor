//! 认证 IPC：`auth_login` / `auth_restore` / `auth_logout` / `auth_me`。
//!
//! 本文件是完整实现，不要再覆盖成 `not implemented` 骨架。
//! 密码只从 [`LoginRequest`] 进入 [`LoginData::new`] 一次，不做二次哈希、不写日志。
//! Token 只在本模块与系统凭据存储之间传递，不进入任何返回 DTO。

use fishpi_sdk::model::misc::LoginData;
use fishpi_sdk::utils::error::Error as SdkError;
use fishpi_sdk::FishPi;
use tauri::{AppHandle, State};

use crate::credentials;
use crate::dto::{
    AuthLogout, AuthMe, AuthSession, AuthStatus, LoginRequest, RestoreOutcome, UserSummary,
};
use crate::error::{AppError, ErrorCode};
use crate::state::{AppState, LiveConnections};

const CANNOT_KEEP_LOGIN: &str =
    "系统凭据存储不可用，不能保持登录。本次会话有效，关闭应用后需要重新登录。";
const LOGOUT_PERSIST_FAILED: &str =
    "内存会话已退出，但系统凭据删除失败，不能认定已持久退出。";

/// 用户名 / 密码 / MFA → 校验身份，发布会话并尝试写入系统凭据。
///
/// MFA 失败原样返回，让用户带着验证码重新提交；不把密码留在内存里自动重试。
#[tauri::command]
pub async fn auth_login(
    app: AppHandle,
    state: State<'_, AppState>,
    request: LoginRequest,
) -> Result<AuthSession, AppError> {
    let expected_generation = state.session_generation();
    let client_tag = client_tag(&app);
    let login_data = login_data_from_request(request);

    let logged_in = FishPi::builder()
        .max_retries(0)
        .client_tag(client_tag.clone())
        .login(&login_data)
        .await?;
    let api_key = require_api_key(&logged_in)?;
    let user = logged_in.user().info().await?;

    commit_session(
        &state,
        &api_key,
        user.into(),
        expected_generation,
        client_tag,
        PersistMode::SaveAfterCommit,
    )
}

/// 用系统凭据恢复会话。
///
/// 无记录返回 [`RestoreOutcome::NoSession`]，不是错误：前端应停在登录页。
/// 网络错误或访客验证不清 token：这两种情况只说明此刻无法完成校验，
/// 凭据本身未必失效。明确的未授权才删除凭据并失效内存会话。
#[tauri::command]
pub async fn auth_restore(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RestoreOutcome, AppError> {
    let expected_generation = state.session_generation();
    let api_key = match credentials::load() {
        Ok(Some(token)) if !token.is_empty() => token,
        Ok(_) => return Ok(RestoreOutcome::NoSession),
        // 读存储失败不等于没有会话：重试可能成功，清成登录页会逼用户再输密码。
        Err(_) => return Ok(RestoreOutcome::TemporarilyUnavailable),
    };

    let client_tag = client_tag(&app);
    let probe = FishPi::builder()
        .api_key(api_key.as_str())
        .max_retries(0)
        .client_tag(client_tag.clone())
        .build()?;
    let user = match probe.user().info().await {
        Ok(user) => user,
        Err(err) => {
            return handle_restore_probe_error(&state, expected_generation, err);
        }
    };
    let api_key = require_api_key(&probe)?;

    let session = commit_session(
        &state,
        &api_key,
        user.into(),
        expected_generation,
        client_tag,
        PersistMode::AlreadyStored,
    )?;
    Ok(RestoreOutcome::Authenticated(session))
}

/// 退出当前会话。
///
/// 先失效再删凭据：登录 / 恢复 / 聊天回调都按代次提交。若先删存储而代次仍有效，
/// 进行中的 `auth_restore` 可能把旧 token 再次写入内存。先抬升代次、断开聊天室 /
/// 全部私聊 / 通知连接并清内存，旧异步结果无法复活；随后再删持久凭据。删除失败
/// 只影响下次启动是否恢复，必须在返回值里说明，不能宣称已持久退出。
#[tauri::command]
pub async fn auth_logout(state: State<'_, AppState>) -> Result<AuthLogout, AppError> {
    let invalidation = state.invalidate_session();
    disconnect_live(invalidation.previous);

    let (credential_cleared, persist_warning) = match credentials::delete() {
        Ok(()) => (true, None),
        Err(_) => (false, Some(LOGOUT_PERSIST_FAILED.to_string())),
    };

    Ok(AuthLogout {
        session_generation: invalidation.session_generation,
        credential_cleared,
        persist_warning,
    })
}

/// 当前内存会话与用户摘要，不访问网络，不返回 token。
#[tauri::command]
pub async fn auth_me(state: State<'_, AppState>) -> Result<AuthMe, AppError> {
    let snapshot = state.session_snapshot();
    let status = if snapshot.user.is_some() {
        AuthStatus::LoggedIn
    } else {
        AuthStatus::LoggedOut
    };
    Ok(AuthMe {
        session_generation: snapshot.session_generation,
        status,
        user: snapshot.user,
        credential_saved: snapshot.credential_saved,
    })
}

enum PersistMode {
    SaveAfterCommit,
    AlreadyStored,
}

/// 用确认过的 api_key 构造**新**客户端再发布会话，避免继续持有登录探测实例。
///
/// 先 CAS `replace_session_if` 再视情况 `credentials::save`：被挤掉的登录不得覆盖
/// 新会话已经写入的凭据。保存失败不回滚内存登录，只把 `credentialSaved=false`
/// 和「不能保持登录」交给前端，禁止静默明文落盘。
fn commit_session(
    state: &AppState,
    api_key: &str,
    user: UserSummary,
    expected_generation: u64,
    client_tag: String,
    persist: PersistMode,
) -> Result<AuthSession, AppError> {
    let client = build_session_client(api_key, client_tag)?;

    match persist {
        PersistMode::SaveAfterCommit => {
            let replacement =
                state.replace_session_if(expected_generation, client, user.clone(), false)?;
            disconnect_live(replacement.previous);
            let (credential_saved, persist_warning) = persist_api_key(api_key);
            if credential_saved
                && state.session_generation() == replacement.session_generation
            {
                state.set_credential_saved(true);
            }
            Ok(AuthSession {
                session_generation: replacement.session_generation,
                user,
                credential_saved,
                persist_warning,
            })
        }
        PersistMode::AlreadyStored => {
            let replacement =
                state.replace_session_if(expected_generation, client, user.clone(), true)?;
            disconnect_live(replacement.previous);
            Ok(AuthSession {
                session_generation: replacement.session_generation,
                user,
                credential_saved: true,
                persist_warning: None,
            })
        }
    }
}

fn persist_api_key(api_key: &str) -> (bool, Option<String>) {
    match credentials::save(api_key) {
        Ok(()) => (true, None),
        Err(_) => (false, Some(CANNOT_KEEP_LOGIN.to_string())),
    }
}

fn handle_restore_probe_error(
    state: &AppState,
    expected_generation: u64,
    err: SdkError,
) -> Result<RestoreOutcome, AppError> {
    if state.session_generation() != expected_generation {
        return Err(AppError::session_superseded());
    }
    match classify_restore_probe(err) {
        RestoreProbe::Unauthorized => {
            let invalidation = state.invalidate_session();
            disconnect_live(invalidation.previous);
            let _ = credentials::delete();
            Ok(RestoreOutcome::Unauthorized)
        }
        RestoreProbe::VerificationRequired => Ok(RestoreOutcome::VerificationRequired),
        RestoreProbe::TemporarilyUnavailable => Ok(RestoreOutcome::TemporarilyUnavailable),
        RestoreProbe::Other(app_err) => Err(app_err),
    }
}

enum RestoreProbe {
    Unauthorized,
    VerificationRequired,
    TemporarilyUnavailable,
    Other(AppError),
}

fn classify_restore_probe(err: SdkError) -> RestoreProbe {
    if is_definite_auth_failure(&err) {
        return RestoreProbe::Unauthorized;
    }
    let app_err = AppError::from(err);
    match app_err.code() {
        ErrorCode::Unauthorized => RestoreProbe::Unauthorized,
        ErrorCode::VerificationRequired => RestoreProbe::VerificationRequired,
        ErrorCode::Network | ErrorCode::RateLimited | ErrorCode::OutcomeUnknown => {
            RestoreProbe::TemporarilyUnavailable
        }
        _ => RestoreProbe::Other(app_err),
    }
}

fn login_data_from_request(request: LoginRequest) -> LoginData {
    let mfa_code = request.mfa_code.filter(|code| !code.trim().is_empty());
    LoginData::new(request.username, &request.password, mfa_code)
}

fn require_api_key(client: &FishPi) -> Result<String, AppError> {
    if !client.is_authenticated() {
        return Err(AppError::business("登录未返回有效凭据"));
    }
    Ok(client.api_key().as_str().to_string())
}

fn build_session_client(api_key: &str, client_tag: String) -> Result<FishPi, AppError> {
    Ok(FishPi::builder()
        .api_key(api_key)
        .max_retries(0)
        .client_tag(client_tag)
        .build()?)
}

fn is_definite_auth_failure(err: &SdkError) -> bool {
    match err {
        SdkError::Unauthorized => true,
        SdkError::Business { msg, .. } => {
            msg.contains("Auth")
                || msg.contains("登录")
                || msg.contains("认证")
                || msg.contains("apiKey")
                || msg.contains("API Key")
        }
        _ => false,
    }
}

fn disconnect_live(connections: LiveConnections) {
    connections.disconnect_all();
}

fn client_tag(app: &AppHandle) -> String {
    let platform = if cfg!(target_os = "windows") {
        "Windows"
    } else if cfg!(target_os = "macos") {
        "MacOS"
    } else if cfg!(target_os = "linux") {
        "Linux"
    } else {
        "PC"
    };
    format!("{platform}/{}", app.package_info().version)
}
