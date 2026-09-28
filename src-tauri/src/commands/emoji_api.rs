//! 表情分组。走 SDK 1.1.0 的 `emoji()`，不把本地列表说成已同步。

use fishpi_sdk::domain::emoji::{EmojiGroup, EmojiItem};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::common::{ensure_same_session, map_write_unit, require_client, require_nonempty};
use crate::error::AppError;
use crate::state::AppState;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmojiGroupDto {
    pub id: String,
    pub name: String,
    pub sort: i64,
    pub is_default: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmojiItemDto {
    pub id: String,
    pub emoji_id: String,
    pub group_id: String,
    pub name: String,
    pub url: String,
    pub sort: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmojiGroupRequest {
    pub group_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmojiAddUrlRequest {
    pub url: String,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmojiRemoveRequest {
    pub group_id: String,
    pub emoji_id: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn emoji_groups(state: State<'_, AppState>) -> Result<Vec<EmojiGroupDto>, AppError> {
    let (client, session_generation) = require_client(&state)?;
    let groups = client.emoji().groups().await?;
    ensure_same_session(&state, session_generation)?;
    Ok(groups.into_iter().map(EmojiGroupDto::from).collect())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn emoji_group_items(
    state: State<'_, AppState>,
    request: EmojiGroupRequest,
) -> Result<Vec<EmojiItemDto>, AppError> {
    let group_id = require_nonempty(&request.group_id, "表情分组不能为空")?;
    let (client, session_generation) = require_client(&state)?;
    let items = client.emoji().group_items(group_id).await?;
    ensure_same_session(&state, session_generation)?;
    Ok(items.into_iter().map(EmojiItemDto::from).collect())
}

/// 有分组就 `add_url`，否则 `upload_url` 进默认「全部」分组。成功才表示服务器已收下。
#[tauri::command(rename_all = "camelCase")]
pub async fn emoji_add_url(
    state: State<'_, AppState>,
    request: EmojiAddUrlRequest,
) -> Result<(), AppError> {
    let url = require_public_http(&request.url)?;
    let name = request
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let group_id = request
        .group_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let (client, session_generation) = require_client(&state)?;
    let result = match group_id {
        Some(group_id) => client.emoji().add_url(group_id, url, 0, name).await,
        None => client.emoji().upload_url(url).await,
    };
    ensure_same_session(&state, session_generation)?;
    map_write_unit(result)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn emoji_remove(
    state: State<'_, AppState>,
    request: EmojiRemoveRequest,
) -> Result<(), AppError> {
    let group_id = require_nonempty(&request.group_id, "表情分组不能为空")?;
    let emoji_id = require_nonempty(&request.emoji_id, "表情不能为空")?;
    let (client, session_generation) = require_client(&state)?;
    let result = client.emoji().remove(group_id, emoji_id).await;
    ensure_same_session(&state, session_generation)?;
    map_write_unit(result)
}

impl From<EmojiGroup> for EmojiGroupDto {
    fn from(group: EmojiGroup) -> Self {
        Self {
            id: group.id,
            name: group.name,
            sort: group.sort,
            is_default: group.is_default,
        }
    }
}

impl From<EmojiItem> for EmojiItemDto {
    fn from(item: EmojiItem) -> Self {
        Self {
            id: item.id,
            emoji_id: item.emoji_id,
            group_id: item.group_id,
            name: item.name,
            url: item.url,
            sort: item.sort,
        }
    }
}

fn require_public_http(value: &str) -> Result<String, AppError> {
    let trimmed = value.trim();
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err(AppError::business("表情地址必须是 http 或 https"));
    }
    if trimmed
        .chars()
        .any(|ch| ch.is_whitespace() || matches!(ch, '<' | '>' | '"' | '\''))
    {
        return Err(AppError::business("表情地址无效"));
    }
    let rest = trimmed
        .split_once("://")
        .map(|(_, host)| host)
        .unwrap_or("");
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if host.is_empty() || host.contains('@') {
        return Err(AppError::business("表情地址无效"));
    }
    Ok(trimmed.to_string())
}
