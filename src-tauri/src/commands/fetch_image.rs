//! 拉取已展示图片的字节，供前端写入剪贴板。
//!
//! WebView `connect-src` 不含图床，且跨域 canvas 会污染，前端 fetch 经常只能拿到 URL。
//! 只放行与 CSP `img-src` 同类的 http(s) 主机，限制大小与跳转，不跟到未允许的域名。

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

const MAX_BYTES: usize = 8 * 1024 * 1024;
const TIMEOUT_SECS: u64 = 15;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchImageRequest {
    pub url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchImageResult {
    pub mime: String,
    pub data_base64: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn fetch_image(request: FetchImageRequest) -> Result<FetchImageResult, AppError> {
    let url = parse_http_url(&request.url)?;
    if !host_allowed(url.host_str().unwrap_or("")) {
        return Err(AppError::business("不支持复制这个地址的图片"));
    }

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 3 {
                return attempt.error(Denied);
            }
            match attempt.url().host_str() {
                Some(host) if host_allowed(host) => attempt.follow(),
                _ => attempt.error(Denied),
            }
        }))
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .user_agent("fishpi-desktop")
        .build()
        .map_err(|_| AppError::network())?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| AppError::network())?;
    if !response.status().is_success() {
        return Err(AppError::business("图片下载失败"));
    }

    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(normalize_mime)
        .filter(|value| value.starts_with("image/"))
        .unwrap_or_else(|| "image/png".to_string());
    if mime == "image/svg+xml" {
        return Err(AppError::business("不支持复制 SVG"));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|_| AppError::network())?;
    if bytes.is_empty() {
        return Err(AppError::business("图片内容为空"));
    }
    if bytes.len() > MAX_BYTES {
        return Err(AppError::business("图片过大，无法复制"));
    }

    Ok(FetchImageResult {
        mime,
        data_base64: base64_encode(&bytes),
    })
}

fn parse_http_url(raw: &str) -> Result<reqwest::Url, AppError> {
    let trimmed = raw.trim();
    let url = reqwest::Url::parse(trimmed).map_err(|_| AppError::business("图片地址无效"))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(AppError::business("图片地址无效"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::business("图片地址无效"));
    }
    Ok(url)
}

fn normalize_mime(raw: &str) -> String {
    raw.split(';')
        .next()
        .unwrap_or(raw)
        .trim()
        .to_ascii_lowercase()
}

fn host_allowed(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() {
        return false;
    }
    const SUFFIXES: &[&str] = &[
        "fishpi.cn",
        "b3logfile.com",
        "b3log.org",
        "clouddn.com",
        "qiniucdn.com",
        "qnssl.com",
        "qbox.me",
        "jsdelivr.net",
        "gravatar.com",
        "cravatar.cn",
        "githubusercontent.com",
        "music.163.com",
        "music.126.net",
        "126.net",
        "stackoverflow.wiki",
    ];
    SUFFIXES
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

#[derive(Debug)]
struct Denied;

impl std::fmt::Display for Denied {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("redirect denied")
    }
}

impl std::error::Error for Denied {}

fn base64_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    let mut index = 0;
    while index < data.len() {
        let remain = data.len() - index;
        let b0 = data[index];
        let b1 = if remain > 1 { data[index + 1] } else { 0 };
        let b2 = if remain > 2 { data[index + 2] } else { 0 };
        let triple = (u32::from(b0) << 16) | (u32::from(b1) << 8) | u32::from(b2);
        out.push(ALPHABET[((triple >> 18) & 63) as usize] as char);
        out.push(ALPHABET[((triple >> 12) & 63) as usize] as char);
        if remain > 1 {
            out.push(ALPHABET[((triple >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if remain > 2 {
            out.push(ALPHABET[(triple & 63) as usize] as char);
        } else {
            out.push('=');
        }
        index += 3;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_image_cdn_hosts() {
        assert!(host_allowed("img.fishpi.cn"));
        assert!(host_allowed("b3logfile.com"));
        assert!(host_allowed("cdn.jsdelivr.net"));
        assert!(!host_allowed("evil.example"));
        assert!(!host_allowed(""));
    }

    #[test]
    fn encodes_base64() {
        assert_eq!(base64_encode(b"hi"), "aGk=");
        assert_eq!(base64_encode(b"abc"), "YWJj");
    }
}
