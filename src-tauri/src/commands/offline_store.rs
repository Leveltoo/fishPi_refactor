//! 把已加载的聊天室 / 私聊消息放在应用数据目录。
//!
//! 不写凭据。离线发送失败保持失败，合并在线记录时不会把失败改成成功。

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::error::AppError;

const FILE_NAME: &str = "offline-messages.json";
const MAX_ITEMS: usize = 400;

static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfflineFile {
    version: u8,
    chatroom: Vec<Value>,
    chats: BTreeMap<String, Vec<Value>>,
    failed: Vec<FailedSend>,
}

impl Default for OfflineFile {
    fn default() -> Self {
        Self {
            version: 1,
            chatroom: Vec::new(),
            chats: BTreeMap::new(),
            failed: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FailedSend {
    scope: String,
    peer: String,
    client_id: String,
    preview: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineSnapshot {
    pub chatroom: Vec<Value>,
    pub chats: BTreeMap<String, Vec<Value>>,
    pub failed: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineMergeRequest {
    pub scope: String,
    pub peer: Option<String>,
    pub messages: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineFailRequest {
    pub scope: String,
    pub peer: Option<String>,
    pub client_id: String,
    pub preview: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn offline_load(app: AppHandle) -> Result<OfflineSnapshot, AppError> {
    let _guard = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let file = read_file(&app)?;
    Ok(snapshot(file))
}

/// 只合并带消息 ID 的在线记录。没有 ID 的条目不当成发送成功。
#[tauri::command(rename_all = "camelCase")]
pub fn offline_merge(app: AppHandle, request: OfflineMergeRequest) -> Result<OfflineSnapshot, AppError> {
    let _guard = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let peer = normalize_scope(&request.scope, request.peer.as_deref())?;
    let mut file = read_file(&app)?;
    let list = bucket(&mut file, &request.scope, &peer);
    for mut message in request.messages.into_iter().take(100) {
        scrub(&mut message);
        let Some(id) = message_id(&message) else {
            continue;
        };
        if let Some(existing) = list.iter_mut().find(|item| message_id(item).as_deref() == Some(id.as_str()))
        {
            *existing = message;
        } else {
            list.push(message);
        }
    }
    trim(list);
    write_file(&app, &file)?;
    Ok(snapshot(file))
}

/// 离线发送失败就保持失败。这个命令不会把记录标成已发出。
#[tauri::command(rename_all = "camelCase")]
pub fn offline_fail_send(
    app: AppHandle,
    request: OfflineFailRequest,
) -> Result<OfflineSnapshot, AppError> {
    let _guard = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let peer = normalize_scope(&request.scope, request.peer.as_deref())?;
    let scope = request.scope;
    let client_id = request.client_id.trim();
    if client_id.is_empty()
        || client_id.len() > 80
        || !client_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
    {
        return Err(AppError::business("失败记录的编号无效"));
    }
    let mut file = read_file(&app)?;
    let preview = request
        .preview
        .unwrap_or_default()
        .chars()
        .filter(|ch| !ch.is_control())
        .take(200)
        .collect::<String>();
    if let Some(existing) = file
        .failed
        .iter_mut()
        .find(|item| item.client_id == client_id && item.scope == scope && item.peer == peer)
    {
        existing.preview = preview;
    } else {
        file.failed.push(FailedSend {
            scope,
            peer,
            client_id: client_id.to_string(),
            preview,
        });
    }
    if file.failed.len() > MAX_ITEMS {
        let extra = file.failed.len() - MAX_ITEMS;
        file.failed.drain(0..extra);
    }
    write_file(&app, &file)?;
    Ok(snapshot(file))
}

fn snapshot(file: OfflineFile) -> OfflineSnapshot {
    OfflineSnapshot {
        chatroom: file.chatroom,
        chats: file.chats,
        failed: file
            .failed
            .into_iter()
            .map(|item| {
                json!({
                    "scope": item.scope,
                    "peer": item.peer,
                    "clientId": item.client_id,
                    "preview": item.preview,
                    "status": "failed",
                })
            })
            .collect(),
    }
}

fn bucket<'a>(file: &'a mut OfflineFile, scope: &str, peer: &str) -> &'a mut Vec<Value> {
    if scope == "chatroom" {
        &mut file.chatroom
    } else {
        file.chats.entry(peer.to_string()).or_default()
    }
}

fn normalize_scope(scope: &str, peer: Option<&str>) -> Result<String, AppError> {
    match scope {
        "chatroom" => Ok(String::new()),
        "chat" => {
            let peer = peer.unwrap_or("").trim();
            if peer.is_empty()
                || peer.len() > 64
                || peer.chars().any(|ch| matches!(ch, '/' | '\\' | '\0'))
            {
                return Err(AppError::business("私聊对象无效"));
            }
            Ok(peer.to_string())
        }
        _ => Err(AppError::business("离线记录范围无效")),
    }
}

fn message_id(value: &Value) -> Option<String> {
    field_id(value).or_else(|| value.get("message").and_then(field_id))
}

fn field_id(value: &Value) -> Option<String> {
    for key in ["oId", "oid", "id", "messageId"] {
        let Some(field) = value.get(key) else {
            continue;
        };
        let text = match field {
            Value::String(text) => text.trim().to_string(),
            Value::Number(number) => number.to_string(),
            _ => continue,
        };
        if !text.is_empty() {
            return Some(text);
        }
    }
    None
}

fn trim(list: &mut Vec<Value>) {
    if list.len() > MAX_ITEMS {
        let extra = list.len() - MAX_ITEMS;
        list.drain(0..extra);
    }
}

fn read_file(app: &AppHandle) -> Result<OfflineFile, AppError> {
    let path = store_path(app)?;
    let Ok(text) = std::fs::read_to_string(path) else {
        return Ok(OfflineFile::default());
    };
    let Ok(mut value) = serde_json::from_str::<Value>(&text) else {
        return Ok(OfflineFile::default());
    };
    scrub(&mut value);
    Ok(serde_json::from_value(value).unwrap_or_default())
}

fn write_file(app: &AppHandle, file: &OfflineFile) -> Result<(), AppError> {
    let path = store_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| AppError::business("无法保存离线消息"))?;
    }
    let mut value = serde_json::to_value(file).map_err(|_| AppError::business("无法保存离线消息"))?;
    scrub(&mut value);
    let text = serde_json::to_string(&value).map_err(|_| AppError::business("无法保存离线消息"))?;
    std::fs::write(path, text).map_err(|_| AppError::business("无法保存离线消息"))
}

fn store_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::business("无法打开应用数据目录"))?
        .join(FILE_NAME))
}

fn scrub(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.retain(|key, _| !is_secret_key(key));
            for child in map.values_mut() {
                scrub(child);
            }
        }
        Value::Array(items) => {
            for child in items {
                scrub(child);
            }
        }
        _ => {}
    }
}

fn is_secret_key(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().as_str(),
        "token" | "apikey" | "api_key" | "password" | "passwd" | "pwd" | "mfa" | "secret"
    )
}
