//! 图片 / 文件上传。走 SDK `FishPi::upload`（multipart `upload` + `file[]` + apiKey）。
//!
//! 入参只收 base64 + 文件名：WebView 粘贴 / 选文件拿不到稳定本地路径，
//! 也不授权任意 fs。写入系统临时目录后立刻删，不把路径交给前端。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use super::common::{ensure_same_session, require_client};
use crate::error::AppError;
use crate::state::AppState;

/// 与 fishpi-sdk `MAX_UPLOAD_FILE_BYTES` 对齐（20MB），避免写完临时文件才被 SDK 拒。
const MAX_UPLOAD_BYTES: usize = 20 * 1024 * 1024;

/// 单次最多文件数，防一次贴太多把 IPC 拖死。
const MAX_UPLOAD_ITEMS: usize = 9;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileUploadItem {
    pub name: String,
    /// 标准 base64（无 data: 前缀；带前缀也会剥掉）。
    pub data_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileUploadRequest {
    pub items: Vec<FileUploadItem>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadedFileDto {
    pub filename: String,
    pub url: String,
    /// 聊天可直接插入的 markdown：图片 `![…](…)`，视频 `[视频](…)`，其余 `[filename](url)`。
    pub markdown: String,
    /// `image` | `video` | `file`
    pub kind: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileUploadResult {
    pub success: Vec<UploadedFileDto>,
    pub errs: Vec<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn file_upload(
    state: State<'_, AppState>,
    request: FileUploadRequest,
) -> Result<FileUploadResult, AppError> {
    if request.items.is_empty() {
        return Err(AppError::business("没有可上传的文件"));
    }
    if request.items.len() > MAX_UPLOAD_ITEMS {
        return Err(AppError::business("一次最多上传 9 个文件"));
    }

    let (client, session_generation) = require_client(&state)?;

    let mut cleanups: Vec<PathBuf> = Vec::with_capacity(request.items.len());
    let mut paths: Vec<String> = Vec::with_capacity(request.items.len());

    for item in &request.items {
        let path = write_temp_upload(&item.name, &item.data_base64)?;
        cleanups.push(path.clone());
        paths.push(path.to_string_lossy().into_owned());
    }

    let upload = client.upload(paths).await;
    ensure_same_session(&state, session_generation)?;

    for path in &cleanups {
        let _ = std::fs::remove_file(path);
    }

    let upload = upload?;

    let mut result = FileUploadResult {
        errs: upload.errs.clone(),
        success: Vec::with_capacity(upload.success.len()),
    };
    for file in &upload.success {
        result.success.push(UploadedFileDto {
            filename: file.filename.clone(),
            url: file.url.clone(),
            markdown: markdown_for(&file.filename, &file.url),
            kind: file_kind(&file.filename, &file.url),
        });
    }

    if result.success.is_empty() {
        if result.errs.is_empty() {
            return Err(AppError::business("上传失败：未返回可用链接"));
        }
        return Err(AppError::business(format!(
            "上传失败：{}",
            result.errs.join("、")
        )));
    }

    Ok(result)
}

fn write_temp_upload(name: &str, data_base64: &str) -> Result<PathBuf, AppError> {
    let file_name = sanitize_upload_name(name)?;
    let bytes = decode_base64(data_base64)?;
    if bytes.is_empty() {
        return Err(AppError::business("文件内容为空"));
    }
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Err(AppError::business("文件超过 20MB 上限"));
    }

    let dir = std::env::temp_dir().join("fishpi-upload");
    std::fs::create_dir_all(&dir)
        .map_err(|_| AppError::business("无法创建临时上传目录"))?;

    let unique = format!(
        "{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
        file_name
    );
    let path = dir.join(unique);
    std::fs::write(&path, bytes)
        .map_err(|_| AppError::business("无法写入临时上传文件"))?;
    Ok(path)
}

/// 只保留文件名段，去掉路径穿越与控制字符。
fn sanitize_upload_name(name: &str) -> Result<String, AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::business("文件名不能为空"));
    }
    let base = trimmed
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(trimmed)
        .trim_matches(|c: char| c == '.' || c.is_control() || c == ' ')
        .to_string();
    if base.is_empty() || base.len() > 180 {
        return Err(AppError::business("文件名无效"));
    }
    if base.chars().any(|c| c == '\0' || c == '/' || c == '\\') {
        return Err(AppError::business("文件名无效"));
    }
    Ok(base)
}

fn decode_base64(input: &str) -> Result<Vec<u8>, AppError> {
    let cleaned: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    let cleaned = cleaned
        .strip_prefix("data:")
        .and_then(|rest| rest.split_once(','))
        .map(|(_, payload)| payload.to_string())
        .unwrap_or(cleaned);
    base64_decode(&cleaned).ok_or_else(|| AppError::business("文件数据无效"))
}

/// 无额外依赖的 base64 解码（标准字母表 + padding）。
fn base64_decode(input: &str) -> Option<Vec<u8>> {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut lookup = [0xffu8; 256];
    for (i, ch) in ALPHABET.iter().enumerate() {
        lookup[*ch as usize] = i as u8;
    }

    let bytes = input.as_bytes();
    if bytes.is_empty() {
        return Some(Vec::new());
    }
    if bytes.len() % 4 != 0 {
        return None;
    }

    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    let mut i = 0;
    while i < bytes.len() {
        let mut acc = 0u32;
        let mut pad = 0;
        for j in 0..4 {
            let b = bytes[i + j];
            if b == b'=' {
                if i + j >= bytes.len() - 2 {
                    pad += 1;
                    acc <<= 6;
                    continue;
                }
                return None;
            }
            let v = lookup[b as usize];
            if v == 0xff {
                return None;
            }
            acc = (acc << 6) | u32::from(v);
        }
        out.push((acc >> 16) as u8);
        if pad < 2 {
            out.push((acc >> 8) as u8);
        }
        if pad < 1 {
            out.push(acc as u8);
        }
        i += 4;
    }
    Some(out)
}

fn file_kind(filename: &str, url: &str) -> String {
    let lower = format!(
        "{} {}",
        filename.to_ascii_lowercase(),
        url.to_ascii_lowercase()
    );
    if is_video_name(&lower) {
        "video".into()
    } else if lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".webp")
        || lower.ends_with(".svg")
        || lower.ends_with(".avif")
    {
        "image".into()
    } else {
        "file".into()
    }
}

fn is_video_name(lower: &str) -> bool {
    lower.ends_with(".mp4")
        || lower.ends_with(".webm")
        || lower.ends_with(".mov")
        || lower.ends_with(".m4v")
        || lower.ends_with(".m3u8")
}

fn markdown_for(filename: &str, url: &str) -> String {
    match file_kind(filename, url).as_str() {
        "video" => format!("[视频]({})", url.trim()),
        "image" => format!("![{}]({})", filename, url.trim()),
        _ => format!("[{}]({})", filename, url.trim()),
    }
}
