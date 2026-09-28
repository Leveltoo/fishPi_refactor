//! 结构化错误：映射 SDK、脱敏后交给前端。
//!
//! 序列化字段为 camelCase：`{ code, message, retryAfterMs?, credentialSaved? }`。
//! `code` 取值使用计划约定的 snake_case 字符串，避免前端误把调试细节当协议。

use std::time::Duration;

use serde::Serialize;
use thiserror::Error;

use fishpi_sdk::utils::error::Error as SdkError;

/// 前端可识别的错误码。序列化为 snake_case，与重构计划第 7.1 节一致。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    Unauthorized,
    VerificationRequired,
    RateLimited,
    Network,
    Business,
    OutcomeUnknown,
    CredentialStorage,
}

/// 发给前端的错误载荷。`Into` 此类型后再序列化，保证字段稳定。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppErrorPayload {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential_saved: Option<bool>,
}

/// Bridge 错误。`message` 在构造时已脱敏，不得包含 token / 密码 / MFA / SDK 路径。
#[derive(Debug, Clone, Error)]
#[error("{message}")]
pub struct AppError {
    code: ErrorCode,
    message: String,
    retry_after_ms: Option<u64>,
    credential_saved: Option<bool>,
}

impl AppError {
    /// 登录态失效或未登录。对应 SDK `Unauthorized`，前端应回到登录页。
    pub fn unauthorized() -> Self {
        Self::new(
            ErrorCode::Unauthorized,
            "登录已失效，请重新登录",
        )
    }

    /// 访客验证页。SDK 只识别验证页并返回错误，P0 映射为本码并停止自动重试。
    pub fn verification_required() -> Self {
        Self::new(
            ErrorCode::VerificationRequired,
            "当前网络需要完成访客验证后再重试",
        )
    }

    /// 限流。`retry_after_ms` 来自服务端建议等待，供前端展示倒计时。
    pub fn rate_limited(retry_after_ms: Option<u64>) -> Self {
        Self {
            code: ErrorCode::RateLimited,
            message: "请求过于频繁，请稍后再试".to_string(),
            retry_after_ms,
            credential_saved: None,
        }
    }

    /// 传输失败。不转发 reqwest/WS 原文，避免 URL 与 apiKey 泄漏。
    pub fn network() -> Self {
        Self::new(ErrorCode::Network, "网络不可用，请稍后重试")
    }

    /// 业务失败。调用方文案仍会脱敏；骨架 command 使用 `"not implemented"`。
    pub fn business(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Business, sanitize_message(&message.into()))
    }

    /// 写操作已发出但无法确认服务端结果。command 层用于发送/撤回超时，禁止自动补发。
    pub fn outcome_unknown() -> Self {
        Self::new(
            ErrorCode::OutcomeUnknown,
            "操作结果待确认，请稍后刷新查看，勿重复提交",
        )
    }

    /// 系统凭据存储不可用或读写失败。由 command 决定仅本次会话，禁止明文文件降级。
    pub fn credential_storage(message: impl Into<String>) -> Self {
        Self::new(
            ErrorCode::CredentialStorage,
            sanitize_message(&message.into()),
        )
    }

    /// 会话或连接代次已变化。旧异步结果必须丢弃，否则会把新账户覆盖回去。
    pub fn session_superseded() -> Self {
        Self::new(ErrorCode::Business, "会话已更新，本次操作已取消")
    }

    /// 附带「当前内存是否仍认为凭据已落盘」。用于退出时删除失败，避免宣称已完成持久退出。
    pub fn with_credential_saved(mut self, saved: bool) -> Self {
        self.credential_saved = Some(saved);
        self
    }

    pub fn code(&self) -> ErrorCode {
        self.code
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    pub fn retry_after_ms(&self) -> Option<u64> {
        self.retry_after_ms
    }

    pub fn credential_saved(&self) -> Option<bool> {
        self.credential_saved
    }

    fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            retry_after_ms: None,
            credential_saved: None,
        }
    }
}

impl From<AppError> for AppErrorPayload {
    fn from(err: AppError) -> Self {
        Self {
            code: err.code,
            message: err.message,
            retry_after_ms: err.retry_after_ms,
            credential_saved: err.credential_saved,
        }
    }
}

impl From<&AppError> for AppErrorPayload {
    fn from(err: &AppError) -> Self {
        Self {
            code: err.code,
            message: err.message.clone(),
            retry_after_ms: err.retry_after_ms,
            credential_saved: err.credential_saved,
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        AppErrorPayload::from(self).serialize(serializer)
    }
}

impl From<SdkError> for AppError {
    fn from(err: SdkError) -> Self {
        match err {
            // HTTP 401 / 业务码 -1 且文案含登录/认证：必须重新登录，不能当网络抖动。
            SdkError::Unauthorized => Self::unauthorized(),
            // 429；只把 Duration 换成毫秒，不把响应头原文传给前端。
            SdkError::RateLimited { retry_after } => {
                Self::rate_limited(duration_to_ms(retry_after))
            }
            // SDK 在 404 时把请求 path 放进 resource；path 可能已带 apiKey 查询串，必须剥掉。
            SdkError::NotFound { resource } => {
                let resource = sanitize_resource(&resource);
                if resource.is_empty() {
                    Self::business("请求的资源不存在")
                } else {
                    Self::business(format!("请求的资源不存在: {resource}"))
                }
            }
            // 服务端非 0 code。访客验证偶发出现在业务文案里，优先提升为 verification_required。
            SdkError::Business { msg, .. } => map_textual_sdk_message(&msg),
            // reqwest Display 常含完整 URL；一律改写为 network，丢弃内部错误。
            SdkError::Transport(_) => Self::network(),
            // 访客验证在 1.1.0 走 Decode(固定文案)；其它解析失败可能夹带响应体，不原样转发。
            SdkError::Decode(msg) => map_textual_sdk_message(&msg),
            // WS 错误字符串可能含带 apiKey 的 wss URL。
            SdkError::WebSocket(_) => Self::network(),
            SdkError::Request(_) => Self::network(),
            // utils 路径下的访客验证走 Api(固定文案)。
            SdkError::Api(msg) => map_textual_sdk_message(&msg),
            SdkError::Parse(_) => Self::business("服务响应无法解析"),
            // Error 为 non_exhaustive，未知变体按业务失败处理且不 Display。
            _ => Self::business("请求失败"),
        }
    }
}

fn duration_to_ms(retry_after: Option<Duration>) -> Option<u64> {
    retry_after.map(|d| d.as_millis() as u64)
}

fn map_textual_sdk_message(msg: &str) -> AppError {
    if is_verification_message(msg) {
        AppError::verification_required()
    } else {
        let sanitized = sanitize_message(msg);
        if sanitized.is_empty() || sanitized == "请求失败" {
            AppError::business("请求失败")
        } else {
            AppError::business(sanitized)
        }
    }
}

fn is_verification_message(msg: &str) -> bool {
    msg.contains("访客验证")
        || msg.contains("在继续浏览摸鱼派社区前请验证")
        || msg.contains("/validateCaptcha")
        || contains_ignore_ascii_case(msg, "initgeetest4")
}

/// 剥掉 NotFound.resource 中的查询串（尤其是 apiKey）和 URL。
fn sanitize_resource(resource: &str) -> String {
    let without_query = match resource.find('?') {
        Some(index) if query_contains_secret(&resource[index..]) => &resource[..index],
        _ => resource,
    };
    if without_query.trim().is_empty() {
        String::new()
    } else {
        sanitize_message(without_query)
    }
}

fn query_contains_secret(query: &str) -> bool {
    SECRET_KEYS.iter().any(|key| contains_ignore_ascii_case(query, key))
}

const SECRET_KEYS: &[&str] = &[
    "apikey",
    "api_key",
    "api-key",
    "password",
    "passwd",
    "pwd",
    "token",
    "mfa",
    "mfacode",
    "captcha",
];

fn sanitize_message(raw: &str) -> String {
    let without_urls = redact_urls(raw);
    let without_secrets = redact_secret_assignments(&without_urls);
    let without_paths = redact_debug_paths(&without_secrets);
    let trimmed = without_paths.trim();
    if trimmed.is_empty() {
        "请求失败".to_string()
    } else {
        trimmed.to_string()
    }
}

fn redact_urls(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut rest = input;
    while !rest.is_empty() {
        match find_url_prefix(rest) {
            Some(index) => {
                output.push_str(&rest[..index]);
                output.push_str("[redacted-url]");
                rest = skip_url_body(&rest[index..]);
            }
            None => {
                output.push_str(rest);
                break;
            }
        }
    }
    output
}

fn find_url_prefix(input: &str) -> Option<usize> {
    const SCHEMES: [&str; 4] = ["https://", "http://", "wss://", "ws://"];
    let lower = input.to_ascii_lowercase();
    SCHEMES
        .iter()
        .filter_map(|scheme| lower.find(scheme))
        .min()
}

fn skip_url_body(input: &str) -> &str {
    let end = input
        .char_indices()
        .find(|(_, ch)| ch.is_whitespace() || matches!(ch, '<' | '>' | '"' | '\'' | ')' | ']'))
        .map(|(i, _)| i)
        .unwrap_or(input.len());
    &input[end..]
}

fn redact_secret_assignments(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut rest = input;
    while !rest.is_empty() {
        match find_secret_assignment(rest) {
            Some((start, value_start)) => {
                output.push_str(&rest[..start]);
                let key_and_sep_end = value_start - start;
                output.push_str(&rest[start..start + key_and_sep_end]);
                output.push_str("[redacted]");
                rest = skip_secret_value(&rest[value_start..]);
            }
            None => {
                output.push_str(rest);
                break;
            }
        }
    }
    output
}

fn find_secret_assignment(input: &str) -> Option<(usize, usize)> {
    let lower = input.to_ascii_lowercase();
    let mut best: Option<(usize, usize)> = None;
    for key in SECRET_KEYS {
        let mut search_from = 0;
        while let Some(rel) = lower[search_from..].find(key) {
            let key_start = search_from + rel;
            if let Some(value_start) = assignment_value_start(input, key_start, key.len()) {
                best = match best {
                    Some(existing) if existing.0 <= key_start => Some(existing),
                    _ => Some((key_start, value_start)),
                };
                break;
            }
            search_from = key_start + key.len();
        }
    }
    best
}

fn assignment_value_start(input: &str, key_start: usize, key_len: usize) -> Option<usize> {
    let after_key = input.get(key_start + key_len..)?;
    let mut offset = 0;
    let bytes = after_key.as_bytes();
    while offset < bytes.len() && matches!(bytes[offset], b' ' | b'\t' | b'"' | b'\'') {
        offset += 1;
    }
    let sep = *bytes.get(offset)?;
    if sep != b'=' && sep != b':' {
        return None;
    }
    offset += 1;
    while offset < bytes.len() && matches!(bytes[offset], b' ' | b'\t') {
        offset += 1;
    }
    Some(key_start + key_len + offset)
}

fn skip_secret_value(input: &str) -> &str {
    let mut chars = input.char_indices().peekable();
    if let Some((_, first)) = chars.peek().copied() {
        if first == '"' || first == '\'' {
            let quote = first;
            let _ = chars.next();
            while let Some((i, ch)) = chars.next() {
                if ch == quote {
                    return &input[i + ch.len_utf8()..];
                }
            }
            return "";
        }
    }
    let end = input
        .char_indices()
        .find(|(_, ch)| ch.is_whitespace() || matches!(ch, '&' | ',' | ';' | '}' | ']'))
        .map(|(i, _)| i)
        .unwrap_or(input.len());
    &input[end..]
}

fn redact_debug_paths(input: &str) -> String {
    let mut output = input.to_string();
    output = replace_ci(&output, "fishpi_sdk::", "[redacted-sdk]");
    output = redact_rust_file_paths(&output);
    output
}

fn redact_rust_file_paths(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(index) = find_rust_path_start(rest) {
        output.push_str(&rest[..index]);
        output.push_str("[redacted-path]");
        rest = skip_until_break(&rest[index..]);
    }
    output.push_str(rest);
    output
}

fn find_rust_path_start(input: &str) -> Option<usize> {
    let lower = input.to_ascii_lowercase();
    ["src/", "src\\", ".rs"]
        .iter()
        .filter_map(|needle| {
            let at = lower.find(needle)?;
            if *needle == ".rs" {
                Some(extend_path_left(input, at))
            } else {
                Some(at)
            }
        })
        .min()
}

fn extend_path_left(input: &str, rs_at: usize) -> usize {
    input[..rs_at]
        .rfind(|ch: char| ch.is_whitespace() || matches!(ch, ',' | ';' | '(' | '[' | '{'))
        .map(|i| i + 1)
        .unwrap_or(0)
}

fn skip_until_break(input: &str) -> &str {
    let end = input
        .char_indices()
        .find(|(_, ch)| ch.is_whitespace() || matches!(ch, ',' | ';' | ')' | ']' | '}'))
        .map(|(i, _)| i)
        .unwrap_or(input.len());
    &input[end..]
}

fn replace_ci(input: &str, needle: &str, replacement: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let needle_l = needle.to_ascii_lowercase();
    let mut output = String::with_capacity(input.len());
    let mut last = 0;
    let mut search = 0;
    while let Some(rel) = lower[search..].find(&needle_l) {
        let start = search + rel;
        output.push_str(&input[last..start]);
        output.push_str(replacement);
        last = start + needle.len();
        search = last;
    }
    output.push_str(&input[last..]);
    output
}

fn contains_ignore_ascii_case(haystack: &str, needle: &str) -> bool {
    haystack
        .to_ascii_lowercase()
        .contains(&needle.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_apikey_from_not_found_resource() {
        let err = AppError::from(SdkError::NotFound {
            resource: "chat-room/more?page=1&apiKey=super-secret-token".into(),
        });
        assert!(!err.message().contains("super-secret-token"));
        assert!(!err.message().contains("apiKey=super-secret-token"));
        assert_eq!(err.code(), ErrorCode::Business);
    }

    #[test]
    fn maps_visitor_verify_decode_to_verification_required() {
        let err = AppError::from(SdkError::decode(
            "当前网络触发摸鱼派访客验证，请完成验证后再重试",
        ));
        assert_eq!(err.code(), ErrorCode::VerificationRequired);
    }

    #[test]
    fn redacts_password_and_url_from_business_message() {
        let err = AppError::from(SdkError::business(
            1,
            "fail password=hunter2 see https://fishpi.cn/api?apiKey=abc",
        ));
        assert!(!err.message().contains("hunter2"));
        assert!(!err.message().contains("abc"));
        assert!(!err.message().contains("https://"));
    }

    #[test]
    fn payload_uses_camel_case_optional_fields() {
        let err = AppError::rate_limited(Some(1500)).with_credential_saved(false);
        let json = serde_json::to_value(&err).expect("serialize");
        assert_eq!(json["code"], "rate_limited");
        assert_eq!(json["retryAfterMs"], 1500);
        assert_eq!(json["credentialSaved"], false);
        assert!(json.get("message").is_some());
    }
}
