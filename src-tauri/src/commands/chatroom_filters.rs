//! 聊天室屏蔽 / 特别关心 / 最近表情。
//!
//! 存在单独的 `chatroom-filters.json`，键名 `chatroomFilters`。
//! 不能写进 `settings.json`：`settings_set` 会清空整个文件。
//! 这里不读、不写 token / 密码。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::error::AppError;

const STORE_FILE: &str = "chatroom-filters.json";
const FILTERS_KEY: &str = "chatroomFilters";
const RECENT_KEY: &str = "emojiRecent";
const MAX_RULES: usize = 40;
const MAX_CARE: usize = 100;
const MAX_RECENT: usize = 24;
const MAX_RULE_CHARS: usize = 200;
const MAX_NAME_CHARS: usize = 64;

/// 与旧 `setting.vue` 的 `shieldType` 一致：用户、内容正则、红包。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ShieldType {
    Username,
    Content,
    Redpacket,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShieldRule {
    #[serde(rename = "type")]
    pub kind: ShieldType,
    #[serde(default)]
    pub value: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatroomFilters {
    #[serde(default)]
    pub shield: Vec<ShieldRule>,
    #[serde(default)]
    pub care_users: Vec<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RecentEmojiKind {
    Shortcode,
    Image,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentEmoji {
    pub kind: RecentEmojiKind,
    pub value: String,
}

#[tauri::command(rename_all = "camelCase")]
pub fn chatroom_filters_get(app: AppHandle) -> Result<ChatroomFilters, AppError> {
    let store = open_store(&app)?;
    Ok(read_filters(&store))
}

#[tauri::command(rename_all = "camelCase")]
pub fn chatroom_filters_set(
    app: AppHandle,
    request: ChatroomFilters,
) -> Result<ChatroomFilters, AppError> {
    let clean = sanitize_filters(request);
    let store = open_store(&app)?;
    let value = serde_json::to_value(&clean).map_err(|_| AppError::business("屏蔽规则无法保存"))?;
    store.set(FILTERS_KEY, value);
    store
        .save()
        .map_err(|_| AppError::business("屏蔽规则保存失败"))?;
    Ok(clean)
}

#[tauri::command(rename_all = "camelCase")]
pub fn chatroom_emoji_recent_get(app: AppHandle) -> Result<Vec<RecentEmoji>, AppError> {
    let store = open_store(&app)?;
    Ok(read_recent(&store))
}

#[tauri::command(rename_all = "camelCase")]
pub fn chatroom_emoji_recent_remember(
    app: AppHandle,
    request: RecentEmoji,
) -> Result<Vec<RecentEmoji>, AppError> {
    let Some(item) = sanitize_recent_item(request) else {
        return Err(AppError::business("表情无法记入最近使用"));
    };
    let store = open_store(&app)?;
    let mut recent = read_recent(&store);
    recent.retain(|existing| existing != &item);
    recent.insert(0, item);
    recent.truncate(MAX_RECENT);
    let value = serde_json::to_value(&recent).map_err(|_| AppError::business("最近表情无法保存"))?;
    store.set(RECENT_KEY, value);
    store
        .save()
        .map_err(|_| AppError::business("最近表情保存失败"))?;
    Ok(recent)
}

fn open_store(
    app: &AppHandle,
) -> Result<std::sync::Arc<tauri_plugin_store::Store<tauri::Wry>>, AppError> {
    app.store(STORE_FILE)
        .map_err(|_| AppError::business("读取聊天室本地记录失败"))
}

fn read_filters(store: &tauri_plugin_store::Store<tauri::Wry>) -> ChatroomFilters {
    store
        .get(FILTERS_KEY)
        .and_then(|value| serde_json::from_value::<ChatroomFilters>(strip_secrets(value)).ok())
        .map(sanitize_filters)
        .unwrap_or_default()
}

fn read_recent(store: &tauri_plugin_store::Store<tauri::Wry>) -> Vec<RecentEmoji> {
    store
        .get(RECENT_KEY)
        .and_then(|value| serde_json::from_value::<Vec<RecentEmoji>>(value).ok())
        .map(|items| {
            items
                .into_iter()
                .filter_map(sanitize_recent_item)
                .take(MAX_RECENT)
                .collect()
        })
        .unwrap_or_default()
}

fn sanitize_filters(raw: ChatroomFilters) -> ChatroomFilters {
    let mut shield = Vec::new();
    for rule in raw.shield {
        if shield.len() >= MAX_RULES {
            break;
        }
        let value = truncate_chars(rule.value.trim(), MAX_RULE_CHARS);
        if value.is_empty() && !matches!(rule.kind, ShieldType::Redpacket) {
            continue;
        }
        shield.push(ShieldRule {
            kind: rule.kind,
            value,
        });
    }

    let mut care_users = Vec::new();
    for name in raw.care_users {
        let name = truncate_chars(name.trim(), MAX_NAME_CHARS);
        if name.is_empty() || care_users.iter().any(|existing: &String| existing == &name) {
            continue;
        }
        if care_users.len() >= MAX_CARE {
            break;
        }
        care_users.push(name);
    }

    ChatroomFilters { shield, care_users }
}

fn sanitize_recent_item(item: RecentEmoji) -> Option<RecentEmoji> {
    let value = item.value.trim();
    if value.is_empty() || value.chars().count() > 500 {
        return None;
    }
    match item.kind {
        RecentEmojiKind::Shortcode => {
            if value
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '+' | '-'))
                && value.chars().count() <= 32
            {
                Some(RecentEmoji {
                    kind: RecentEmojiKind::Shortcode,
                    value: value.to_string(),
                })
            } else {
                None
            }
        }
        RecentEmojiKind::Image => {
            if is_public_http(value) {
                Some(RecentEmoji {
                    kind: RecentEmojiKind::Image,
                    value: value.to_string(),
                })
            } else {
                None
            }
        }
    }
}

fn is_public_http(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return false;
    }
    if value
        .chars()
        .any(|ch| ch.is_whitespace() || matches!(ch, '<' | '>' | '"' | '\''))
    {
        return false;
    }
    let Some((_, rest)) = value.split_once("://") else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    !host.is_empty() && !host.contains('@')
}

fn strip_secrets(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut next = serde_json::Map::new();
            for (key, child) in map {
                if is_secret_key(&key) {
                    continue;
                }
                next.insert(key, strip_secrets(child));
            }
            Value::Object(next)
        }
        Value::Array(items) => Value::Array(items.into_iter().map(strip_secrets).collect()),
        other => other,
    }
}

fn is_secret_key(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().replace('-', "_").as_str(),
        "token" | "apikey" | "api_key" | "password" | "passwd" | "pwd" | "mfa" | "mfacode"
    )
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}
