//! 查本应用 GitHub 仓库的 latest。镜像只替换下载主机。
//!
//! 仓库尚未发布时明确失败，禁止回落到旧 Electron 仓库。
//! 不执行下载文件，不写更新脚本，不调用 cmd / shell。安装失败必须返回错误。

use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::error::AppError;

/// 本应用仓库。禁止再查 `imlinhanchao/fishpi-desktop`（那是旧 Electron 安装包）。
const REPO: &str = "leveltoo/fishpi-desktop";
const API_HOSTS: [&str; 2] = ["api.github.com", "gitapi.librejo.cn"];
const DEFAULT_MIRROR: &str = "dgm.librejo.cn";
const MAX_BYTES: usize = 200 * 1024 * 1024;
const UNPUBLISHED: &str = "本仓库尚未发布";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub tag: String,
    pub name: String,
    pub body: String,
    pub published_at: String,
    pub asset_name: String,
    pub up_to_date: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateApplyResult {
    pub downloaded: bool,
    pub installed: bool,
    pub message: String,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

/// 检查本应用仓库的 latest。尚未发布或 API 失败都返回错误，不假装已是最新。
#[tauri::command(rename_all = "camelCase")]
pub async fn update_check() -> Result<UpdateInfo, AppError> {
    let fetched = fetch_latest().await?;
    Ok(describe(&fetched.release))
}

/// 重新检查后下载安装包。不接收前端传来的任意地址，也不执行文件。
#[tauri::command(rename_all = "camelCase")]
pub async fn update_apply(app: AppHandle) -> Result<UpdateApplyResult, AppError> {
    let fetched = fetch_latest().await?;
    let info = describe(&fetched.release);
    if info.up_to_date {
        return Err(AppError::business("已是最新，没有下载"));
    }
    let asset = pick_asset(&fetched.release.assets)
        .ok_or_else(|| AppError::business("没有可用的更新包"))?;
    let mirror = super::config_import::load_prefs(&app).update_mirror;
    let url = rewrite_download(&asset.browser_download_url, &mirror)?;
    let path = download_asset(&url, &asset.name, &mirror).await?;
    Ok(UpdateApplyResult {
        downloaded: true,
        installed: false,
        message: format!(
            "安装包已下载到 {}。不会执行旧版更新脚本，也没有安装。",
            path.display()
        ),
    })
}

/// 只用发布页固定地址打开系统浏览器。标签只允许版本字符。
#[tauri::command(rename_all = "camelCase")]
pub fn update_open_release(app: AppHandle, tag: String) -> Result<(), AppError> {
    let tag = tag.trim();
    if !valid_tag(tag) {
        return Err(AppError::business("发布标签无效"));
    }
    let url = format!("https://github.com/{REPO}/releases/tag/{tag}");
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| AppError::business("无法打开发布页"))?;
    Ok(())
}

struct Fetched {
    release: Release,
}

async fn fetch_latest() -> Result<Fetched, AppError> {
    let client = http_client(ApiHosts)?;
    let mut last = AppError::business("检查更新失败");
    let mut unpublished = false;
    for host in API_HOSTS {
        let url = format!("https://{host}/repos/{REPO}/releases/latest");
        match client.get(url).send().await {
            Ok(response) if response.status().is_success() => {
                let value = response
                    .json::<serde_json::Value>()
                    .await
                    .map_err(|_| AppError::business("检查更新失败，发布信息无法解析"))?;
                if is_unpublished_payload(&value) {
                    unpublished = true;
                    last = unpublished_error();
                    continue;
                }
                let release = serde_json::from_value::<Release>(value)
                    .map_err(|_| AppError::business("检查更新失败，发布信息无法解析"))?;
                if release.tag_name.trim().is_empty() {
                    unpublished = true;
                    last = unpublished_error();
                    continue;
                }
                return Ok(Fetched { release });
            }
            Ok(response) if response.status().as_u16() == 404 => {
                unpublished = true;
                last = unpublished_error();
            }
            Ok(_) => last = AppError::business("检查更新失败"),
            Err(_) => last = AppError::business("检查更新失败"),
        }
    }
    if unpublished {
        return Err(unpublished_error());
    }
    Err(last)
}

fn unpublished_error() -> AppError {
    AppError::business(UNPUBLISHED)
}

fn is_unpublished_payload(value: &serde_json::Value) -> bool {
    let has_tag = value
        .get("tag_name")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .is_some_and(|tag| !tag.is_empty());
    if has_tag {
        return false;
    }
    value
        .get("message")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|message| message.eq_ignore_ascii_case("Not Found"))
}

fn describe(release: &Release) -> UpdateInfo {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let up_to_date = same_version(&release.tag_name, &current);
    let asset_name = pick_asset(&release.assets)
        .map(|asset| asset.name.clone())
        .unwrap_or_default();
    UpdateInfo {
        current,
        tag: release.tag_name.clone(),
        name: release.name.clone(),
        body: clip_text(&release.body, 4000),
        published_at: release.created_at.clone(),
        asset_name,
        up_to_date,
    }
}

fn same_version(tag: &str, current: &str) -> bool {
    let tag = tag.trim();
    let current = current.trim();
    tag == current || tag.trim_start_matches(['v', 'V']) == current.trim_start_matches(['v', 'V'])
}

fn pick_asset(assets: &[Asset]) -> Option<&Asset> {
    assets
        .iter()
        .find(|asset| is_tauri_windows_installer(&asset.name))
        .or_else(|| {
            assets.iter().find(|asset| {
                let name = asset.name.to_ascii_lowercase();
                name.ends_with(".exe") && !name.contains("win32-")
            })
        })
}

fn is_tauri_windows_installer(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.ends_with(".msi") || name.contains("nsis") || name.ends_with("-setup.exe")
}

fn rewrite_download(url: &str, mirror: &str) -> Result<String, AppError> {
    let origin = mirror_origin(mirror)?;
    let Some(rest) = url.strip_prefix("https://github.com") else {
        return Err(AppError::business("更新包地址不是 GitHub 发布文件"));
    };
    if !rest.starts_with('/') {
        return Err(AppError::business("更新包地址无效"));
    }
    Ok(format!("{origin}{rest}"))
}

fn mirror_origin(mirror: &str) -> Result<String, AppError> {
    let host = if mirror.trim().is_empty() {
        DEFAULT_MIRROR
    } else {
        mirror.trim()
    };
    if !valid_host(host) {
        return Err(AppError::business("更新镜像域名无效"));
    }
    Ok(format!("https://{host}"))
}

/// 把旧配置里的 `https://host` / `http://host/path` 剥成纯域名。空串表示用默认镜像。
pub(crate) fn normalize_mirror_host(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    let rest = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(trimmed)
        .trim();
    let hostport = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or(rest)
        .trim();
    let host = match hostport.rsplit_once(':') {
        Some((name, port)) if !port.is_empty() && port.chars().all(|ch| ch.is_ascii_digit()) => name,
        _ => hostport,
    };
    let host = host.trim().trim_matches('.');
    if valid_host(host) {
        Ok(host.to_string())
    } else {
        Err("更新镜像域名无效".to_string())
    }
}

pub(crate) fn valid_host(host: &str) -> bool {
    if host.is_empty() || host.len() > 253 || host.contains("..") {
        return false;
    }
    host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
    })
}

fn valid_tag(tag: &str) -> bool {
    !tag.is_empty()
        && tag.len() <= 64
        && tag
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
}

async fn download_asset(url: &str, name: &str, mirror: &str) -> Result<PathBuf, AppError> {
    let mirror_host = mirror_origin(mirror)?;
    let mirror_host = mirror_host.trim_start_matches("https://").to_string();
    let client = http_client(DownloadHosts {
        mirror: mirror_host,
    })?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| AppError::business("下载失败"))?;
    if !response.status().is_success() {
        return Err(AppError::business("下载失败，没有安装"));
    }
    if response.content_length().unwrap_or(0) > MAX_BYTES as u64 {
        return Err(AppError::business("更新包过大，已中止"));
    }
    let mut response = response;
    let dest = download_path(name)?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|_| AppError::business("下载失败"))?;
    }
    let mut file = std::fs::File::create(&dest).map_err(|_| AppError::business("下载失败"))?;
    let mut got = 0usize;
    loop {
        let chunk = response
            .chunk()
            .await
            .map_err(|_| AppError::business("下载失败"))?;
        let Some(chunk) = chunk else {
            break;
        };
        got = got.saturating_add(chunk.len());
        if got > MAX_BYTES {
            drop(file);
            let _ = std::fs::remove_file(&dest);
            return Err(AppError::business("更新包过大，已中止"));
        }
        file.write_all(&chunk)
            .map_err(|_| AppError::business("下载失败"))?;
    }
    file.flush().map_err(|_| AppError::business("下载失败"))?;
    if got == 0 {
        let _ = std::fs::remove_file(&dest);
        return Err(AppError::business("下载失败，文件是空的"));
    }
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::{is_unpublished_payload, normalize_mirror_host, pick_asset, Asset};

    #[test]
    fn strips_https_prefix() {
        assert_eq!(
            normalize_mirror_host("https://dgm.librejo.cn").expect("host"),
            "dgm.librejo.cn"
        );
        assert_eq!(
            normalize_mirror_host("http://gitapi.librejo.cn/foo").expect("host"),
            "gitapi.librejo.cn"
        );
        assert_eq!(normalize_mirror_host("  ").expect("empty"), "");
    }

    #[test]
    fn rejects_junk() {
        assert!(normalize_mirror_host("not a host").is_err());
        assert!(normalize_mirror_host("https://").is_err());
    }

    #[test]
    fn unpublished_payload_without_tag() {
        let value = serde_json::json!({
            "message": "Not Found",
            "documentation_url": "https://docs.github.com"
        });
        assert!(is_unpublished_payload(&value));
        let tagged = serde_json::json!({ "tag_name": "v0.1.0", "message": "Not Found" });
        assert!(!is_unpublished_payload(&tagged));
    }

    #[test]
    fn pick_tauri_installer_not_electron_pack() {
        let assets = [
            Asset {
                name: "fishpi-desktop-win32-x64.exe".into(),
                browser_download_url: "https://github.com/old".into(),
            },
            Asset {
                name: "fishpi-desktop_0.1.0_x64_en-US.msi".into(),
                browser_download_url: "https://github.com/new".into(),
            },
        ];
        let picked = pick_asset(&assets).expect("asset");
        assert_eq!(picked.name, "fishpi-desktop_0.1.0_x64_en-US.msi");
    }

    #[test]
    fn never_picks_electron_win32_exe() {
        let assets = [Asset {
            name: "fishpi-desktop Setup 1.2.3.exe".into(),
            browser_download_url: "https://github.com/electron".into(),
        }];
        let picked = pick_asset(&assets).expect("setup exe");
        assert!(picked.name.to_ascii_lowercase().ends_with("-setup.exe") || picked.name.contains("Setup"));
        let electron = [Asset {
            name: "app-win32-x64.exe".into(),
            browser_download_url: "https://github.com/electron".into(),
        }];
        assert!(pick_asset(&electron).is_none());
    }
}

fn download_path(name: &str) -> Result<PathBuf, AppError> {
    let safe = name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    if safe.is_empty() || safe.contains("..") {
        return Err(AppError::business("更新包文件名无效"));
    }
    Ok(std::env::temp_dir()
        .join("fishpi-desktop-update")
        .join(safe))
}

fn clip_text(text: &str, max: usize) -> String {
    let mut out = String::new();
    for ch in text.chars() {
        if out.len() >= max {
            break;
        }
        if ch == '\n' || ch == '\r' || ch == '\t' || !ch.is_control() {
            out.push(ch);
        }
    }
    out
}

struct ApiHosts;
struct DownloadHosts {
    mirror: String,
}

fn http_client<A: AllowHost>(allow: A) -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error(Denied);
            }
            match attempt.url().host_str() {
                Some(host) if allow.allows(host) => attempt.follow(),
                _ => attempt.error(Denied),
            }
        }))
        .timeout(Duration::from_secs(60))
        .user_agent("fishpi-desktop")
        .build()
        .map_err(|_| AppError::business("检查更新失败"))
}

trait AllowHost: Send + Sync + 'static {
    fn allows(&self, host: &str) -> bool;
}

impl AllowHost for ApiHosts {
    fn allows(&self, host: &str) -> bool {
        API_HOSTS.iter().any(|item| host.eq_ignore_ascii_case(item))
    }
}

impl AllowHost for DownloadHosts {
    fn allows(&self, host: &str) -> bool {
        host.eq_ignore_ascii_case(&self.mirror)
            || host.eq_ignore_ascii_case("github.com")
            || host.eq_ignore_ascii_case("objects.githubusercontent.com")
            || host.eq_ignore_ascii_case("release-assets.githubusercontent.com")
            || host
                .to_ascii_lowercase()
                .ends_with(".githubusercontent.com")
    }
}

#[derive(Debug)]
struct Denied;

impl std::fmt::Display for Denied {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("denied")
    }
}

impl std::error::Error for Denied {}
