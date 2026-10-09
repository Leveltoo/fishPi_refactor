//! 用户名片：一次有界 GET，保留 SDK wire 映射及旧端公开的 mbti。

use std::time::Duration;

use fishpi_sdk::domain::user::UserInfo;
use fishpi_sdk::utils::{current_http_proxy_config, HttpProxyMode};
use fishpi_sdk::wire::user::WireUserInfo;
use reqwest::{Client, StatusCode, Url};
use serde::Deserialize;
use tauri::State;

use crate::commands::common::{ensure_same_session, require_client};
use crate::dto::{UserProfileDto, UserProfileRequest, UserProfileResult};
use crate::error::AppError;
use crate::state::AppState;

const MAX_PROFILE_BYTES: usize = 256 * 1024;
const MAX_USERNAME_CHARS: usize = 64;

#[derive(Deserialize)]
struct ProfilePayload {
    #[serde(default)]
    code: Option<i64>,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    mbti: Option<String>,
    #[serde(flatten)]
    user: WireUserInfo,
}

/// 按用户名查询公开资料，供 overlay 名片使用。
#[tauri::command(rename_all = "camelCase")]
pub async fn user_profile(
    state: State<'_, AppState>,
    request: UserProfileRequest,
) -> Result<UserProfileResult, AppError> {
    let mut url = profile_url(&request.user_name)?;
    let user_name = request.user_name.trim();
    let (client, session_generation) = require_client(&state)?;
    url.query_pairs_mut()
        .append_pair("apiKey", client.api_key().as_str());
    let result = read_profile(url, user_name).await;
    // Stale errors (including unauthorized) must not affect a newly logged-in account.
    ensure_same_session(&state, session_generation)?;
    Ok(UserProfileResult::new(session_generation, result?))
}

fn profile_url(user_name: &str) -> Result<Url, AppError> {
    let name = user_name.trim();
    if name.is_empty()
        || name.chars().count() > MAX_USERNAME_CHARS
        || matches!(name, "." | "..")
        || name
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace() || matches!(ch, '/' | '\\'))
    {
        return Err(AppError::business("用户名无效"));
    }
    let mut url = Url::parse("https://fishpi.cn/").map_err(|_| AppError::network())?;
    url.path_segments_mut()
        .map_err(|_| AppError::network())?
        .clear()
        .push("user")
        .push(name);
    Ok(url)
}

async fn read_profile(url: Url, user_name: &str) -> Result<UserProfileDto, AppError> {
    let builder = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(15))
        .user_agent("fishpi-desktop");
    let config = current_http_proxy_config();
    let builder = match config.mode {
        HttpProxyMode::NoProxy => builder.no_proxy(),
        HttpProxyMode::System => builder,
        HttpProxyMode::Custom => {
            let proxy_url = config
                .proxy_url
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(AppError::network)?;
            builder
                .no_proxy()
                .proxy(reqwest::Proxy::all(proxy_url).map_err(|_| AppError::network())?)
        }
    };
    let http = builder.build().map_err(|_| AppError::network())?;
    let mut response = http
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::REFERER, "https://fishpi.cn/")
        .send()
        .await
        .map_err(|_| AppError::network())?;
    check_status(response.status(), response.headers())?;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_PROFILE_BYTES as u64)
    {
        return Err(AppError::business("用户资料响应过大"));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| AppError::network())? {
        append_profile_chunk(&mut body, &chunk)?;
    }
    parse_profile(&body, user_name)
}

fn check_status(status: StatusCode, headers: &reqwest::header::HeaderMap) -> Result<(), AppError> {
    match status {
        StatusCode::OK => Ok(()),
        StatusCode::UNAUTHORIZED => Err(AppError::unauthorized()),
        StatusCode::TOO_MANY_REQUESTS => {
            let retry_after_ms = headers
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.trim().parse::<u64>().ok())
                .and_then(|seconds| seconds.checked_mul(1_000));
            Err(AppError::rate_limited(retry_after_ms))
        }
        StatusCode::NOT_FOUND => Err(AppError::business("用户资料不存在")),
        status if status.is_redirection() => {
            Err(AppError::business("用户资料请求发生重定向，已拒绝"))
        }
        status if status.is_server_error() => Err(AppError::network()),
        _ => Err(AppError::business("用户资料读取失败")),
    }
}

fn append_profile_chunk(body: &mut Vec<u8>, chunk: &[u8]) -> Result<(), AppError> {
    if body.len().saturating_add(chunk.len()) > MAX_PROFILE_BYTES {
        return Err(AppError::business("用户资料响应过大"));
    }
    body.extend_from_slice(chunk);
    Ok(())
}

fn parse_profile(body: &[u8], user_name: &str) -> Result<UserProfileDto, AppError> {
    if body.is_empty() || body.len() > MAX_PROFILE_BYTES {
        return Err(AppError::business("用户资料响应为空或过大"));
    }
    // Keep SDK-confirmed visitor-verification markers, without forwarding the page.
    let text = std::str::from_utf8(body).map_err(|_| AppError::business("用户资料无法解析"))?;
    let lower = text.trim_start().to_ascii_lowercase();
    if (lower.starts_with("<!doctype html") || lower.starts_with("<html"))
        && (text.contains("访客验证")
            || text.contains("在继续浏览摸鱼派社区前请验证")
            || text.contains("/validateCaptcha")
            || lower.contains("initgeetest4"))
    {
        return Err(AppError::verification_required());
    }
    let payload: ProfilePayload =
        serde_json::from_slice(body).map_err(|_| AppError::business("用户资料无法解析"))?;
    if let Some(code) = payload.code.filter(|code| *code != 0) {
        let msg = payload.msg.as_deref().unwrap_or("");
        if code == -1 && (msg.contains("Auth") || msg.contains("登录") || msg.contains("认证"))
        {
            return Err(AppError::unauthorized());
        }
        return Err(AppError::business("用户资料读取失败"));
    }
    if payload.user.user_name.is_empty() || !payload.user.user_name.eq_ignore_ascii_case(user_name)
    {
        return Err(AppError::business("用户资料与请求用户不一致"));
    }
    let mut profile = UserProfileDto::from(UserInfo::from(payload.user));
    profile.mbti = valid_mbti(payload.mbti.as_deref());
    Ok(profile)
}

fn valid_mbti(value: Option<&str>) -> Option<String> {
    let value = value?;
    let bytes = value.as_bytes();
    if !(bytes.len() == 4 || bytes.len() == 6)
        || !matches!(bytes[0], b'E' | b'I')
        || !matches!(bytes[1], b'N' | b'S')
        || !matches!(bytes[2], b'F' | b'T')
        || !matches!(bytes[3], b'J' | b'P')
        || (bytes.len() == 6 && (bytes[4] != b'-' || !matches!(bytes[5], b'A' | b'T')))
    {
        return None;
    }
    Some(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;
    use serde_json::json;

    #[test]
    fn builds_a_fixed_origin_and_single_encoded_username_segment() {
        for name in ["alice?apiKey=other#x", "a%2Fb", "a&b", "\u{7528}\u{6237}"] {
            let mut url = profile_url(name).unwrap();
            assert_eq!(url.scheme(), "https");
            assert_eq!(url.host_str(), Some("fishpi.cn"));
            assert_eq!(url.path_segments().unwrap().count(), 2);
            assert_eq!(url.query(), None);
            assert_eq!(url.fragment(), None);
            url.query_pairs_mut().append_pair("apiKey", "test-key&x=1");
            assert_eq!(
                url.query_pairs().collect::<Vec<_>>(),
                [("apiKey".into(), "test-key&x=1".into())]
            );
        }
        assert_eq!(profile_url("a%2Fb").unwrap().path(), "/user/a%252Fb");
        for name in ["", ".", "..", "../api/user", "a/b", "a\\b", "a b", "a\0b"] {
            assert!(profile_url(name).is_err(), "{name:?}");
        }
        assert!(profile_url(&"a".repeat(MAX_USERNAME_CHARS + 1)).is_err());
    }

    #[test]
    fn accepts_all_sixteen_types_and_only_the_documented_suffixes() {
        for kind in [
            "INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP", "ISTJ", "ISFJ", "ESTJ",
            "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP",
        ] {
            for suffix in ["", "-A", "-T"] {
                let value = format!("{kind}{suffix}");
                assert_eq!(valid_mbti(Some(&value)), Some(value));
            }
        }
        for value in [
            "",
            "enfp",
            " ENFP",
            "ENFP ",
            "XXXX",
            "ENFP-X",
            "ENFP-A-extra",
            "ENFP/<script>",
            "\u{6027}\u{683c}",
        ] {
            assert!(valid_mbti(Some(value)).is_none(), "{value:?}");
        }
        assert!(valid_mbti(None).is_none());
    }

    #[test]
    fn retains_sdk_mapping_and_exports_only_the_validated_public_mbti() {
        let body = json!({
            "userName":"alice","userNickname":"Ada","userNo":"42","userAvatarURL":"https://fishpi.cn/avatar",
            "userPoint":25,"followingUserCount":3,"followerCount":4,"userOnlineFlag":true,
            "userIntro":"hello","userCity":"city","userRole":"member","cardBg":"https://fishpi.cn/bg",
            "sysMetal":[{"attr":"backcolor=000","name":"badge","description":"public","enabled":true},
                {"name":"hidden","enabled":false}],
            "mbti":"INTJ-T","token":"SECRET","apiKey":"SECRET","userEmail":"SECRET"
        });
        let profile = parse_profile(body.to_string().as_bytes(), "ALICE").unwrap();
        assert_eq!(profile.user_nickname, "Ada");
        assert_eq!(profile.user_no, "42");
        assert_eq!(
            (profile.points, profile.following, profile.follower),
            (25, 3, 4)
        );
        assert!(profile.online);
        assert_eq!(profile.metals.len(), 1);
        assert!(profile.metals[0].icon.starts_with("https://fishpi.cn/gen?"));
        assert_eq!(profile.mbti.as_deref(), Some("INTJ-T"));
        let result = serde_json::to_value(UserProfileResult::new(7, profile)).unwrap();
        assert_eq!(result["profile"]["mbti"], "INTJ-T");
        assert_eq!(result["user"]["mbti"], "INTJ-T");
        assert_eq!(result["sessionGeneration"], 7);
        assert!(!result.to_string().contains("SECRET"));
    }

    #[test]
    fn absent_private_invalid_or_unconfirmed_mbti_is_never_invented() {
        for extra in [
            json!({}),
            json!({"mbti":null}),
            json!({"mbti":""}),
            json!({"mbti":"private"}),
            json!({"MBTI":"ENFP","userMbti":"INTJ"}),
        ] {
            let mut body = extra;
            body["userName"] = json!("alice");
            let profile = parse_profile(body.to_string().as_bytes(), "alice").unwrap();
            assert!(profile.mbti.is_none());
            assert!(serde_json::to_value(profile).unwrap().get("mbti").is_none());
        }
        assert!(parse_profile(br#"{"userName":"alice","mbti":123}"#, "alice").is_err());
    }

    #[test]
    fn rejects_bad_shapes_mismatched_accounts_and_unbounded_data_without_echoing() {
        for body in [
            br#"{}"#.as_slice(),
            br#"[]"#,
            br#"{"data":{"userName":"alice","mbti":"ENFP"}}"#,
            br#"{"userName":"other","mbti":"ENFP"}"#,
            br#"{"userName":"alice","userPoint":"25"}"#,
            br#"{"userName":"alice","mbti":"ENFP","mbti":"INTJ"}"#,
            br#"{"userName":"alice"} trailing"#,
            b"<html>SECRET</html>",
            &[0xff],
        ] {
            let error = parse_profile(body, "alice").unwrap_err();
            assert!(!error.message().contains("SECRET"));
        }
        let error = parse_profile(
            br#"{"code":1,"msg":"apiKey=SECRET","userName":"alice"}"#,
            "alice",
        )
        .unwrap_err();
        assert_eq!(error.message(), "用户资料读取失败");
        assert_eq!(
            parse_profile(br#"{"code":-1,"msg":"Auth failed"}"#, "alice")
                .unwrap_err()
                .code(),
            ErrorCode::Unauthorized
        );
        assert_eq!(
            parse_profile(b"<html>initgeetest4</html>", "alice")
                .unwrap_err()
                .code(),
            ErrorCode::VerificationRequired
        );
        let mut body = vec![0; MAX_PROFILE_BYTES - 1];
        append_profile_chunk(&mut body, &[0]).unwrap();
        assert!(append_profile_chunk(&mut body, &[0]).is_err());
        assert_eq!(body.len(), MAX_PROFILE_BYTES);
        assert!(parse_profile(&vec![0; MAX_PROFILE_BYTES + 1], "alice").is_err());
    }

    #[test]
    fn http_errors_and_redirects_are_explicit_and_do_not_leak_locations() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::LOCATION,
            "https://other.example/?apiKey=SECRET".parse().unwrap(),
        );
        assert!(check_status(StatusCode::FOUND, &headers).is_err());
        assert!(!check_status(StatusCode::FOUND, &headers)
            .unwrap_err()
            .message()
            .contains("SECRET"));
        headers.insert(reqwest::header::RETRY_AFTER, "2".parse().unwrap());
        assert_eq!(
            check_status(StatusCode::TOO_MANY_REQUESTS, &headers)
                .unwrap_err()
                .retry_after_ms(),
            Some(2_000)
        );
        assert_eq!(
            check_status(StatusCode::UNAUTHORIZED, &headers)
                .unwrap_err()
                .code(),
            ErrorCode::Unauthorized
        );
        assert!(check_status(StatusCode::NO_CONTENT, &headers).is_err());
        assert!(check_status(StatusCode::OK, &headers).is_ok());
    }
}
