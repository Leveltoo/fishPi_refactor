//! 把已加载的聊天室 / 私聊消息放在应用数据目录。
//!
//! 不写凭据。离线发送失败保持失败，合并在线记录时不会把失败改成成功。

use std::collections::BTreeMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

use crate::error::AppError;
use crate::state::AppState;

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
    #[serde(default)]
    revoked: Vec<String>,
}

impl Default for OfflineFile {
    fn default() -> Self {
        Self {
            version: 1,
            chatroom: Vec::new(),
            chats: BTreeMap::new(),
            failed: Vec::new(),
            revoked: Vec::new(),
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
    pub session_generation: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineFailRequest {
    pub scope: String,
    pub peer: Option<String>,
    pub client_id: String,
    pub preview: Option<String>,
    pub session_generation: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineRevokeRequest {
    pub message_id: String,
    pub session_generation: u64,
}

#[tauri::command(rename_all = "camelCase")]
pub fn offline_load(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<OfflineSnapshot, AppError> {
    let _guard = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let (account, generation) = current_account(&state, None)?;
    let file = read_file(&app, &account)?;
    super::common::ensure_same_session(&state, generation)?;
    Ok(snapshot(file))
}

/// 只合并带消息 ID 的在线记录。没有 ID 的条目不当成发送成功。
#[tauri::command(rename_all = "camelCase")]
pub fn offline_merge(
    app: AppHandle,
    state: State<'_, AppState>,
    request: OfflineMergeRequest,
) -> Result<OfflineSnapshot, AppError> {
    let _guard = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let (account, generation) = current_account(&state, request.session_generation)?;
    let peer = normalize_scope(&request.scope, request.peer.as_deref())?;
    let mut file = read_file(&app, &account)?;
    let revoked = file.revoked.clone();
    let list = bucket(&mut file, &request.scope, &peer);
    for mut message in request.messages.into_iter().take(100) {
        scrub(&mut message);
        let Some(id) = message_id(&message) else {
            continue;
        };
        if revoked.contains(&id) {
            revoke_message(&mut message);
        }
        if let Some(existing) = list
            .iter_mut()
            .find(|item| message_id(item).as_deref() == Some(id.as_str()))
        {
            if is_revoked(existing) {
                revoke_message(&mut message);
            }
            *existing = message;
        } else {
            list.push(message);
        }
    }
    trim(list);
    super::common::ensure_same_session(&state, generation)?;
    write_file(&app, &account, &file)?;
    super::common::ensure_same_session(&state, generation)?;
    Ok(snapshot(file))
}

#[tauri::command(rename_all = "camelCase")]
pub fn offline_revoke(
    app: AppHandle,
    state: State<'_, AppState>,
    request: OfflineRevokeRequest,
) -> Result<OfflineSnapshot, AppError> {
    let _guard = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let (account, generation) = current_account(&state, Some(request.session_generation))?;
    let id = request.message_id.trim();
    if id.is_empty() || id.len() > 32 || !id.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(AppError::business("撤回消息 ID 无效"));
    }
    let mut file = read_file(&app, &account)?;
    remember_revoke(&mut file, id);
    super::common::ensure_same_session(&state, generation)?;
    write_file(&app, &account, &file)?;
    super::common::ensure_same_session(&state, generation)?;
    Ok(snapshot(file))
}

fn remember_revoke(file: &mut OfflineFile, id: &str) {
    if !file.revoked.iter().any(|previous| previous == id) {
        file.revoked.push(id.to_string());
        if file.revoked.len() > MAX_ITEMS {
            file.revoked.remove(0);
        }
    }
    for message in file
        .chatroom
        .iter_mut()
        .chain(file.chats.values_mut().flatten())
    {
        if message_id(message).as_deref() == Some(id) {
            revoke_message(message);
        }
    }
}

fn is_revoked(message: &Value) -> bool {
    message.get("revoked").and_then(Value::as_bool) == Some(true)
        || message.get("message").is_some_and(is_revoked)
}

fn revoke_message(message: &mut Value) {
    if let Some(nested) = message.get_mut("message") {
        revoke_message(nested);
    }
    if let Some(object) = message.as_object_mut() {
        object.insert("revoked".into(), Value::Bool(true));
        for field in [
            "md",
            "text",
            "content",
            "preview",
            "rawHint",
            "music",
            "weather",
            "redpacket",
        ] {
            object.remove(field);
        }
    }
}

/// 离线发送失败就保持失败。这个命令不会把记录标成已发出。
#[tauri::command(rename_all = "camelCase")]
pub fn offline_fail_send(
    app: AppHandle,
    state: State<'_, AppState>,
    request: OfflineFailRequest,
) -> Result<OfflineSnapshot, AppError> {
    let _guard = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let (account, generation) = current_account(&state, request.session_generation)?;
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
    let mut file = read_file(&app, &account)?;
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
    super::common::ensure_same_session(&state, generation)?;
    write_file(&app, &account, &file)?;
    super::common::ensure_same_session(&state, generation)?;
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

fn read_file(app: &AppHandle, account: &str) -> Result<OfflineFile, AppError> {
    let path = store_path(app, account)?;
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(OfflineFile::default());
        }
        Err(_) => return Err(AppError::business("无法读取离线消息")),
    };
    let mut value = serde_json::from_str::<Value>(&text)
        .map_err(|_| AppError::business("离线消息文件损坏，未覆盖原文件"))?;
    scrub(&mut value);
    serde_json::from_value(value).map_err(|_| AppError::business("离线消息格式无效，未覆盖原文件"))
}

fn write_file(app: &AppHandle, account: &str, file: &OfflineFile) -> Result<(), AppError> {
    let path = store_path(app, account)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| AppError::business("无法保存离线消息"))?;
    }
    let mut value =
        serde_json::to_value(file).map_err(|_| AppError::business("无法保存离线消息"))?;
    scrub(&mut value);
    let text = serde_json::to_string(&value).map_err(|_| AppError::business("无法保存离线消息"))?;
    replace_file(&path, text.as_bytes()).map_err(|_| AppError::business("无法保存离线消息"))
}

fn replace_file(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp = path.with_extension(format!("{}-{stamp}.tmp", std::process::id()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result
}

fn current_account(state: &AppState, expected: Option<u64>) -> Result<(String, u64), AppError> {
    let snapshot = state.session_snapshot();
    if expected.is_some_and(|generation| generation != snapshot.session_generation) {
        return Err(AppError::session_superseded());
    }
    let user = snapshot.user.ok_or_else(AppError::unauthorized)?;
    if user.user_name.trim().is_empty() {
        return Err(AppError::unauthorized());
    }
    Ok((user.user_name, snapshot.session_generation))
}

fn account_directory(account: &str) -> String {
    account
        .trim()
        .to_lowercase()
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn store_path(app: &AppHandle, account: &str) -> Result<PathBuf, AppError> {
    // 旧公共文件没有所属账号，保留但不自动归到任意账号，避免私聊跨账号泄露。
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::business("无法打开应用数据目录"))?
        .join("accounts")
        .join(account_directory(account))
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
        key.to_ascii_lowercase().replace(['-', '_'], "").as_str(),
        "token"
            | "apikey"
            | "password"
            | "passwd"
            | "pwd"
            | "mfa"
            | "mfacode"
            | "secret"
            | "accesstoken"
            | "refreshtoken"
            | "authorization"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dto::UserSummary;
    use fishpi_sdk::FishPi;

    fn user(name: &str) -> UserSummary {
        UserSummary {
            user_name: name.into(),
            user_nickname: name.into(),
            user_avatar_url: String::new(),
            user_no: String::new(),
            role: String::new(),
        }
    }

    #[test]
    fn account_paths_are_separate_and_cannot_escape() {
        assert_ne!(account_directory("alice"), account_directory("bob"));
        assert_eq!(account_directory("Alice"), account_directory("alice"));
        let unsafe_name = account_directory("../你好\\..");
        assert!(unsafe_name
            .chars()
            .all(|character| character.is_ascii_hexdigit()));
        assert!(!unsafe_name.contains(['/', '\\', '.']));
    }

    #[test]
    fn offline_access_requires_current_account() {
        let state = AppState::new();
        assert!(current_account(&state, None).is_err());
        let client = FishPi::builder().build().unwrap();
        let first = state
            .replace_session_if(0, client.clone(), user("alice"), false)
            .unwrap();
        assert_eq!(
            current_account(&state, Some(first.session_generation))
                .unwrap()
                .0,
            "alice"
        );
        state
            .replace_session_if(first.session_generation, client, user("bob"), false)
            .unwrap();
        assert!(current_account(&state, Some(first.session_generation)).is_err());
        assert_eq!(current_account(&state, None).unwrap().0, "bob");
        state.invalidate_session();
        assert!(current_account(&state, None).is_err());
    }

    #[test]
    fn cache_replacement_preserves_complete_file_and_scrubs_secrets() {
        let path =
            std::env::temp_dir().join(format!("fishpi-cache-test-{}.json", std::process::id()));
        replace_file(&path, b"first").unwrap();
        replace_file(&path, b"second").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"second");
        std::fs::remove_file(path).unwrap();
        let mut value = json!({"token":"secret","access_token":"secret","message":{"id":"1","api-key":"secret","mfaCode":"secret","text":"hello"}});
        scrub(&mut value);
        assert_eq!(value, json!({"message":{"id":"1","text":"hello"}}));
        assert_eq!(message_id(&value).as_deref(), Some("1"));
    }

    #[test]
    fn revoke_redacts_all_cached_copies_and_keeps_a_bounded_tombstone() {
        let mut file = OfflineFile::default();
        file.chatroom
            .push(json!({"id":"1","md":"secret","redpacket":{"msg":"secret"}}));
        file.chats.insert(
            "alice".into(),
            vec![json!({"message":{"id":"1","text":"secret"}})],
        );
        remember_revoke(&mut file, "1");
        remember_revoke(&mut file, "1");
        assert_eq!(file.revoked, ["1"]);
        assert!(is_revoked(&file.chatroom[0]));
        assert!(is_revoked(&file.chats["alice"][0]));
        assert!(!serde_json::to_string(&file).unwrap().contains("secret"));
        for id in 2..=(MAX_ITEMS + 1) {
            remember_revoke(&mut file, &id.to_string());
        }
        assert_eq!(file.revoked.len(), MAX_ITEMS);
        assert!(is_revoked(&file.chatroom[0]));
    }
}
