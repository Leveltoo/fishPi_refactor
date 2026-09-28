//! 认证相关 DTO。
//!
//! 登录成功后只回用户摘要与凭据是否写入系统存储，不回 token。
//! `user().info()` 的完整 [`fishpi_sdk::domain::user::UserInfo`] 含积分、勋章等，P0 登录壳用不到。

use fishpi_sdk::domain::user::UserInfo;
use serde::{Deserialize, Serialize};

/// 登录 command 入参。
///
/// 这是唯一允许出现 `password` / `mfaCode` 的类型：仅供 Rust command 反序列化后立刻交给
/// `LoginData::new`，不得写入 `AuthSession`、事件、设置或日志。
/// 不实现 `Serialize`，避免被误当作响应发回前端。
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub username: String,
    /// 明文密码，仅在本次 invoke 生命周期内存在；MD5 由 SDK `LoginData::new` 处理。
    pub password: String,
    /// 二次验证码。失败时由用户重新提交，不在 Bridge 里缓存密码做自动重试。
    #[serde(default)]
    pub mfa_code: Option<String>,
}

impl std::fmt::Debug for LoginRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LoginRequest")
            .field("username", &self.username)
            .field("password", &"***")
            .field("mfa_code", &self.mfa_code.as_ref().map(|_| "***"))
            .finish()
    }
}

/// 当前登录用户的展示摘要。不含 apiKey、邮箱、积分明细或勋章列表。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserSummary {
    pub user_name: String,
    pub user_nickname: String,
    pub user_avatar_url: String,
    pub user_no: String,
    pub role: String,
}

impl From<&UserInfo> for UserSummary {
    fn from(user: &UserInfo) -> Self {
        Self {
            user_name: user.username.as_str().to_string(),
            user_nickname: user.nickname.clone(),
            user_avatar_url: user.avatar.clone(),
            user_no: user.user_no.clone(),
            role: user.role.clone(),
        }
    }
}

impl From<UserInfo> for UserSummary {
    fn from(user: UserInfo) -> Self {
        Self::from(&user)
    }
}

/// 登录或恢复成功后的会话快照。`credentialSaved` 只表示系统凭据存储结果，不是 token 本身。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    pub session_generation: u64,
    pub user: UserSummary,
    pub credential_saved: bool,
    /// 凭据存储不可用或写入失败时的提示。出现时前端必须告知「仅本次会话有效」，禁止静默当成长登录。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persist_warning: Option<String>,
}

/// `auth_me` 看到的会话阶段。与 `RestoreOutcome` 不同：这是当前 UI 该停在哪一页。
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AuthStatus {
    LoggedOut,
    Restoring,
    /// 网络失败或访客验证：凭据仍在，允许用户主动重试，不能当成未登录去清 token。
    LimitedNetwork,
    LoggedIn,
}

/// 当前认证状态。不包含 token。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthMe {
    pub session_generation: u64,
    pub status: AuthStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<UserSummary>,
    pub credential_saved: bool,
}

/// `auth_restore` 的分类结果：无会话、已登录、鉴权失败、暂时不可用、需要人机验证。
///
/// 使用内部标签 `kind`，`authenticated` 变体会摊开 [`AuthSession`] 字段。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RestoreOutcome {
    NoSession,
    Authenticated(AuthSession),
    Unauthorized,
    TemporarilyUnavailable,
    VerificationRequired,
}

/// 与计划文案 `RestoreResult` 同义，避免 command 骨架与 DTO 命名分叉。
pub type RestoreResult = RestoreOutcome;

/// `auth_logout` 返回。内存会话必须先失效；`credentialCleared` 为 false 时不得宣称已持久退出。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthLogout {
    pub session_generation: u64,
    pub credential_cleared: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persist_warning: Option<String>,
}

/// 前端类型名 `LogoutResult` 的别名。
pub type LogoutResult = AuthLogout;
