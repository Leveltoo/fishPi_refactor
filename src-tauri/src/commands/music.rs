//! 网易云公开歌曲信息。地址与旧版 `main.js` 的 `playMusic` 相同。
//!
//! 只查一首的标题和播放地址，不下载音频，不处理付费绕过。

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::error::AppError;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongInfo {
    pub id: String,
    pub name: String,
    pub artist: String,
    pub cover: String,
    pub url: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_resolve(id: String) -> Result<SongInfo, AppError> {
    let id = id.trim();
    if id.is_empty() || id.len() > 20 || !id.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(AppError::business("歌曲编号无效"));
    }
    let endpoint = format!(
        "http://music.163.com/api/song/detail/?id={id}&ids=%5B{id}%5D"
    );
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 2 {
                return attempt.error(Denied);
            }
            match attempt.url().host_str() {
                Some(host) if host.eq_ignore_ascii_case("music.163.com") => attempt.follow(),
                _ => attempt.error(Denied),
            }
        }))
        .timeout(Duration::from_secs(15))
        .user_agent("fishpi-desktop")
        .build()
        .map_err(|_| AppError::business("找不到这首歌"))?;
    let body = client
        .get(endpoint)
        .send()
        .await
        .map_err(|_| AppError::business("找不到这首歌"))?
        .json::<Value>()
        .await
        .map_err(|_| AppError::business("找不到这首歌"))?;
    if body.get("code").and_then(Value::as_i64) != Some(200) {
        return Err(AppError::business("找不到这首歌"));
    }
    let song = body
        .get("songs")
        .and_then(Value::as_array)
        .and_then(|songs| songs.first())
        .ok_or_else(|| AppError::business("找不到这首歌"))?;
    let name = song
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if name.is_empty() {
        return Err(AppError::business("找不到这首歌"));
    }
    let artist = song
        .get("artists")
        .and_then(Value::as_array)
        .map(|artists| {
            artists
                .iter()
                .filter_map(|artist| artist.get("name").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join(",")
        })
        .unwrap_or_default();
    let cover = song
        .pointer("/album/picUrl")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    Ok(SongInfo {
        id: id.to_string(),
        name: name.to_string(),
        artist,
        cover,
        url: format!("http://music.163.com/song/media/outer/url?id={id}"),
    })
}

#[derive(Debug)]
struct Denied;

impl std::fmt::Display for Denied {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("denied")
    }
}

impl std::error::Error for Denied {}
