//! Legacy fishpi 0.0.59 cloud favorites, not SDK emoji groups.
//! Only fixed cloud/get and cloud/sync with gameId=emojis. Keys stay in Rust.

use std::time::Duration;

use fishpi_sdk::utils::{current_http_proxy_config, HttpProxyMode};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
use tokio::sync::Mutex;

use super::common::{ensure_same_session, require_client};
use crate::error::AppError;
use crate::state::AppState;

const CLOUD_GET: &str = "https://fishpi.cn/api/cloud/get";
const CLOUD_SYNC: &str = "https://fishpi.cn/api/cloud/sync";
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_DATA_BYTES: usize = 512 * 1024;
const MAX_URLS: usize = 4096;
const MAX_URL_BYTES: usize = 8192;

// Serialize read-modify-write within this process; the legacy API has no CAS.
static CLOUD_LOCK: Mutex<()> = Mutex::const_new(());

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudEmojiSnapshot {
    pub session_generation: u64,
    pub urls: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloudEmojiAppendRequest {
    pub session_generation: u64,
    pub urls: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloudEmojiRemoveRequest {
    pub session_generation: u64,
    pub url: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn emoji_cloud_get(state: State<'_, AppState>) -> Result<CloudEmojiSnapshot, AppError> {
    let (client, generation) = require_client(&state)?;
    let _guard = CLOUD_LOCK.lock().await;
    ensure_same_session(&state, generation)?;
    let http = http_client()?;
    let reply = post_cloud(&state, generation, &http, client.api_key().as_str(), None).await?;
    Ok(CloudEmojiSnapshot {
        session_generation: generation,
        urls: parse_cloud_read(reply)?,
    })
}

/// Read fresh, append only new URLs, then sync exactly once.
#[tauri::command(rename_all = "camelCase")]
pub async fn emoji_cloud_append(
    state: State<'_, AppState>,
    request: CloudEmojiAppendRequest,
) -> Result<CloudEmojiSnapshot, AppError> {
    let incoming = validate_incoming(request.urls)?;
    change_cloud(&state, request.session_generation, |current| {
        append_urls(current, incoming)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn emoji_cloud_remove(
    state: State<'_, AppState>,
    request: CloudEmojiRemoveRequest,
) -> Result<CloudEmojiSnapshot, AppError> {
    // Keep the original stored spelling, so deleting does not normalize other entries.
    if request.url.len() > MAX_URL_BYTES {
        return Err(AppError::business("表情地址过长"));
    }
    change_cloud(&state, request.session_generation, |mut current| {
        if let Some(index) = current.iter().position(|url| url == &request.url) {
            current.remove(index);
        }
        current
    })
    .await
}

async fn change_cloud(
    state: &AppState,
    expected_generation: u64,
    change: impl FnOnce(Vec<String>) -> Vec<String>,
) -> Result<CloudEmojiSnapshot, AppError> {
    let (client, generation) = require_client(state)?;
    if generation != expected_generation {
        return Err(AppError::session_superseded());
    }
    let _guard = CLOUD_LOCK.lock().await;
    ensure_same_session(state, generation)?;
    let http = http_client()?;
    let reply = post_cloud(state, generation, &http, client.api_key().as_str(), None).await?;
    let current = parse_cloud_read(reply)?;
    let next = change(current.clone());
    if next != current {
        let data = encode_urls(&next)?;
        let reply = post_cloud(
            state,
            generation,
            &http,
            client.api_key().as_str(),
            Some(data),
        )
        .await?;
        confirm_cloud_sync(reply)?;
    }
    ensure_same_session(state, generation)?;
    Ok(CloudEmojiSnapshot {
        session_generation: generation,
        urls: next,
    })
}

fn http_client() -> Result<Client, AppError> {
    let builder = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(15))
        .user_agent("fishpi-desktop");
    let config = current_http_proxy_config();
    let builder = match config.mode {
        HttpProxyMode::NoProxy => builder.no_proxy(),
        HttpProxyMode::System => builder,
        HttpProxyMode::Custom => builder.no_proxy().proxy(
            reqwest::Proxy::all(config.proxy_url.as_deref().unwrap_or(""))
                .map_err(|_| AppError::network())?,
        ),
    };
    builder.build().map_err(|_| AppError::network())
}

async fn post_cloud(
    state: &AppState,
    generation: u64,
    http: &Client,
    api_key: &str,
    data: Option<String>,
) -> Result<Value, AppError> {
    if api_key.is_empty() {
        return Err(AppError::unauthorized());
    }
    let writing = data.is_some();
    let body = cloud_body(api_key, data);
    ensure_same_session(state, generation)?;
    // No retry loop; no redirects, query credentials, or error URL logging.
    let result = request_cloud(http, writing, body).await;
    ensure_same_session(state, generation)?;
    result
}

fn cloud_body(api_key: &str, data: Option<String>) -> Value {
    let mut body = json!({ "gameId": "emojis", "apiKey": api_key });
    if let Some(data) = data {
        body["data"] = Value::String(data);
    }
    body
}

async fn request_cloud(http: &Client, writing: bool, body: Value) -> Result<Value, AppError> {
    let mut response = http
        .post(if writing { CLOUD_SYNC } else { CLOUD_GET })
        .header(reqwest::header::REFERER, "https://fishpi.cn/")
        .json(&body)
        .send()
        .await
        .map_err(|err| {
            if writing && !err.is_connect() {
                AppError::outcome_unknown()
            } else {
                AppError::network()
            }
        })?;
    match response.status() {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => return Err(AppError::unauthorized()),
        StatusCode::TOO_MANY_REQUESTS => return Err(AppError::rate_limited(None)),
        status if !status.is_success() => {
            return Err(
                if writing && (status.is_server_error() || status.is_redirection()) {
                    AppError::outcome_unknown()
                } else {
                    AppError::business("云收藏请求未被接受")
                },
            );
        }
        _ => {}
    }
    let uncertain = || {
        if writing {
            AppError::outcome_unknown()
        } else {
            AppError::business("云收藏响应无效或过大")
        }
    };
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
    {
        return Err(uncertain());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| uncertain())? {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(uncertain());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| uncertain())
}

fn check_business_code(reply: &Value) -> Result<(), AppError> {
    if let Some(code) = reply.get("code") {
        match code.as_i64() {
            Some(0) => {}
            Some(401 | 403) => return Err(AppError::unauthorized()),
            _ => return Err(AppError::business("云收藏请求未被接受")),
        }
    }
    Ok(())
}

fn parse_cloud_read(reply: Value) -> Result<Vec<String>, AppError> {
    check_business_code(&reply)?;
    let data = reply
        .get("data")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::business("云收藏响应缺少地址列表"))?;
    if data.len() > MAX_DATA_BYTES {
        return Err(AppError::business("云收藏数据过大"));
    }
    // CloudService.getFromCloud returns "" when no record exists.
    if data.is_empty() && reply.get("code").and_then(Value::as_i64) == Some(0) {
        return Ok(Vec::new());
    }
    let urls: Vec<String> =
        serde_json::from_str(data).map_err(|_| AppError::business("云收藏地址列表无法解析"))?;
    encode_urls(&urls)?;
    // Preserve all legacy strings on writes, even those the safe UI cannot render.
    Ok(urls)
}

fn confirm_cloud_sync(reply: Value) -> Result<(), AppError> {
    check_business_code(&reply)?;
    if reply == Value::Bool(false) || reply.get("data") == Some(&Value::Bool(false)) {
        return Err(AppError::business("服务器未保存云收藏"));
    }
    // CloudProcessor.sync -> renderJSON(SUCC).renderMsg(...), no data required.
    if reply.get("code").and_then(Value::as_i64) == Some(0) {
        Ok(())
    } else {
        Err(AppError::outcome_unknown())
    }
}

fn encode_urls(urls: &[String]) -> Result<String, AppError> {
    if urls.len() > MAX_URLS || urls.iter().any(|url| url.len() > MAX_URL_BYTES) {
        return Err(AppError::business("云收藏地址数量或长度超出限制"));
    }
    let data = serde_json::to_string(urls).map_err(|_| AppError::business("云收藏无法编码"))?;
    if data.len() > MAX_DATA_BYTES {
        return Err(AppError::business("云收藏数据过大"));
    }
    Ok(data)
}

fn validate_incoming(urls: Vec<String>) -> Result<Vec<String>, AppError> {
    if urls.is_empty() {
        return Err(AppError::business("没有可收藏的表情"));
    }
    encode_urls(&urls)?;
    urls.into_iter()
        .map(|raw| {
            let trimmed = raw.trim();
            let url =
                reqwest::Url::parse(trimmed).map_err(|_| AppError::business("表情地址无效"))?;
            if !matches!(url.scheme(), "http" | "https")
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || trimmed
                    .chars()
                    .any(|ch| ch.is_whitespace() || matches!(ch, '<' | '>' | '"' | '\''))
            {
                return Err(AppError::business(
                    "表情地址必须是安全的 http 或 https 地址",
                ));
            }
            Ok(trimmed.to_string())
        })
        .collect()
}

fn append_urls(mut current: Vec<String>, incoming: Vec<String>) -> Vec<String> {
    for url in incoming {
        if !current.contains(&url) {
            current.push(url);
        }
    }
    current
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    #[test]
    fn legacy_wire_uses_fixed_game_and_double_encoded_url_list() {
        let urls = vec!["https://example.com/a.png".to_string()];
        let data = encode_urls(&urls).unwrap();
        assert_eq!(
            cloud_body("synthetic", None),
            json!({ "gameId": "emojis", "apiKey": "synthetic" })
        );
        assert_eq!(cloud_body("synthetic", Some(data.clone()))["data"], data);
        assert_eq!(parse_cloud_read(json!({ "data": data })).unwrap(), urls);
        assert_eq!(CLOUD_GET, "https://fishpi.cn/api/cloud/get");
        assert_eq!(CLOUD_SYNC, "https://fishpi.cn/api/cloud/sync");
    }

    #[test]
    fn sync_requires_confirmed_code_and_never_claims_false_as_success() {
        assert!(confirm_cloud_sync(json!({ "code": 0, "msg": "saved" })).is_ok());
        assert!(confirm_cloud_sync(json!({ "code": 0, "data": true })).is_ok());
        for reply in [
            json!(false),
            json!({ "code": 0, "data": false }),
            json!({ "code": 1 }),
        ] {
            assert_eq!(
                confirm_cloud_sync(reply).unwrap_err().code(),
                ErrorCode::Business
            );
        }
        for reply in [json!(true), json!({}), json!("true"), Value::Null] {
            assert_eq!(
                confirm_cloud_sync(reply).unwrap_err().code(),
                ErrorCode::OutcomeUnknown
            );
        }
    }

    #[test]
    fn invalid_read_cannot_become_an_empty_list_that_overwrites_cloud() {
        for reply in [
            json!(false),
            json!({}),
            json!({ "data": "" }),
            json!({ "data": "null" }),
            json!({ "data": "[1]" }),
            json!({ "code": 1, "data": "[]" }),
        ] {
            assert!(parse_cloud_read(reply).is_err());
        }
        assert!(parse_cloud_read(json!({ "data": "[]" }))
            .unwrap()
            .is_empty());
        assert!(parse_cloud_read(json!({ "code": 0, "data": "" }))
            .unwrap()
            .is_empty());
        assert!(parse_cloud_read(json!({ "code": -1, "data": "" })).is_err());
    }

    #[test]
    fn new_urls_are_safe_but_existing_legacy_entries_are_preserved() {
        for url in [
            "javascript:alert(1)",
            "file:///a",
            "//example.com/a",
            "https://u:p@example.com/a",
            "https://example.com/a b",
            "https://example.com/a>",
        ] {
            assert!(validate_incoming(vec![url.into()]).is_err(), "{url}");
        }
        let current = vec!["legacy-unrenderable".into(), "https://example.com/a".into()];
        let next = append_urls(
            current.clone(),
            vec![current[1].clone(), "https://example.com/b".into()],
        );
        assert_eq!(
            next,
            vec![
                current[0].clone(),
                current[1].clone(),
                "https://example.com/b".into()
            ]
        );
        assert_eq!(
            append_urls(current.clone(), vec![current[1].clone()]),
            current
        );
        assert!(encode_urls(&vec!["x".repeat(MAX_URL_BYTES + 1)]).is_err());
        assert!(encode_urls(&vec!["x".into(); MAX_URLS + 1]).is_err());
    }
}
