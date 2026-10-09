//! 从旧版 Electron 的 Local Storage 导入登录凭据和设置。
//!
//! Windows 上 userData 只认 `%APPDATA%\fishpi-app` 与 `%APPDATA%\fishpi`
//! （package name 与 productName）。不扫描其他应用目录。
//! LevelDB 先复制再打开，因为 rusty-leveldb 的 open 会写 LOCK。
//! 凭据只通过 auth helper 在同代次且未登录时写 keyring，不进 Store、返回值或日志。

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use rusty_leveldb::LdbIterator;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::dto::{AlwaysOnTopRequest, OpacityRequest, SettingsPatch};
use crate::error::AppError;
use crate::state::AppState;

const PREFS_FILE: &str = "desktop-prefs.json";
const MAX_LEGACY_VALUE: usize = 1_000_000;
const MAX_LEVELDB_COPY: u64 = 128_000_000;
pub const PREFS_CHANGED_EVENT: &str = "desktop://prefs-changed";
pub const CONFIG_IMPORTED_EVENT: &str = "desktop://config-imported";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopPrefs {
    pub update_mirror: String,
    pub extension_root: String,
    pub theme: String,
    pub music_mode: u8,
    /// 记住的登录用户名。不存密码。
    #[serde(default)]
    pub login_username: String,
    #[serde(default = "default_window_width")]
    pub window_width: u32,
    #[serde(default = "default_window_height")]
    pub window_height: u32,
}

fn default_window_width() -> u32 {
    800
}

fn default_window_height() -> u32 {
    600
}

impl Default for DesktopPrefs {
    fn default() -> Self {
        Self {
            update_mirror: String::new(),
            extension_root: default_extension_root().display().to_string(),
            theme: "Default".to_string(),
            music_mode: 0,
            login_username: String::new(),
            window_width: default_window_width(),
            window_height: default_window_height(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub found: bool,
    pub credential_saved: bool,
    pub settings_saved: bool,
    pub prefs_saved: bool,
    pub filters_saved: bool,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPrefsPatch {
    pub update_mirror: Option<String>,
    pub extension_root: Option<String>,
    pub theme: Option<String>,
    pub music_mode: Option<u8>,
    pub login_username: Option<String>,
}

/// 查找旧客户端并导入。找不到就明确失败，不写假的成功。
#[tauri::command(rename_all = "camelCase")]
pub async fn config_import(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ImportResult, AppError> {
    let expected_generation = state.session_generation();
    let lookup = tokio::task::spawn_blocking(read_legacy)
        .await
        .map_err(|_| AppError::business("读取旧配置失败"))?;
    let found = match lookup {
        Lookup::Missing { message } | Lookup::Rejected { message } => {
            return Ok(ImportResult {
                found: false,
                credential_saved: false,
                settings_saved: false,
                prefs_saved: false,
                filters_saved: false,
                message,
            });
        }
        Lookup::Found(found) => found,
    };

    let mut notes = Vec::new();
    let credential_saved = match found.credential.as_deref() {
        Some(value) => {
            match super::auth::save_imported_credential(&state, expected_generation, value) {
                Ok(()) => {
                    notes.push("登录凭据已写入系统凭据库".to_string());
                    true
                }
                Err(_) => {
                    notes.push("仅导入普通设置：已登录、会话已变化或凭据库不可写时不覆盖登录凭据，也不改用明文文件".to_string());
                    false
                }
            }
        }
        None => {
            notes.push("旧数据里没有登录凭据".to_string());
            false
        }
    };
    drop(found.credential);

    let (patch, window) = patch_from_legacy(&found.setting);
    let settings_saved = if patch_touched(&patch) {
        match super::settings_set(app.clone(), patch).await {
            Ok(()) => {
                if let Some(opacity) = window.opacity {
                    if super::window_set_opacity(app.clone(), OpacityRequest { opacity }).is_err() {
                        notes.push("透明度已保存，但窗口没有立刻生效".to_string());
                    }
                }
                if let Some(on) = window.always_on_top {
                    let request = AlwaysOnTopRequest {
                        always_on_top: Some(on),
                        on: Some(on),
                    };
                    if super::window_set_always_on_top(app.clone(), request).is_err() {
                        notes.push("置顶已保存，但窗口没有立刻生效".to_string());
                    }
                }
                notes.push("窗口、通知、红包提醒及老板键设置已写入".to_string());
                true
            }
            Err(_) => {
                // Do not return arbitrary backend details (or old data) to the renderer.
                notes.push("普通设置没有写入，请检查老板键冲突及存储权限".to_string());
                false
            }
        }
    } else {
        notes.push("没有可对应的普通设置".to_string());
        false
    };

    let filters_saved = import_legacy_filters(&app, &found.setting, &mut notes);
    report_legacy_limits(&found.setting, &mut notes);
    let mut prefs = load_prefs(&app);
    apply_legacy_prefs(&mut prefs, &found.setting, &mut notes);
    if let Some(username) = found.username {
        prefs.login_username = username;
        notes.push("已记住登录用户名，没有导入密码".to_string());
    }
    let prefs_saved = match save_prefs(&app, &prefs) {
        Ok(()) => true,
        Err(_) => {
            notes.push("扩展与播放偏好没有写入".to_string());
            false
        }
    };
    if prefs_saved {
        notes.push(format!("已从 {} 读取", found.location));
        let _ = app.emit(PREFS_CHANGED_EVENT, ());
    }

    let result = ImportResult {
        found: true,
        credential_saved,
        settings_saved,
        prefs_saved,
        filters_saved,
        message: notes.join("；"),
    };
    // Events contain only status flags, never legacy settings or credentials.
    let _ = app.emit(CONFIG_IMPORTED_EVENT, &result);
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
pub fn desktop_prefs_get(app: AppHandle) -> Result<DesktopPrefs, AppError> {
    Ok(load_prefs(&app))
}

#[tauri::command(rename_all = "camelCase")]
pub fn desktop_prefs_set(
    app: AppHandle,
    patch: DesktopPrefsPatch,
) -> Result<DesktopPrefs, AppError> {
    let mut prefs = load_prefs(&app);
    if let Some(mirror) = patch.update_mirror {
        prefs.update_mirror =
            super::updater::normalize_mirror_host(&mirror).map_err(AppError::business)?;
    }
    if let Some(root) = patch.extension_root {
        let root = root.trim();
        if !valid_extension_root(root) {
            return Err(AppError::business("扩展目录无效"));
        }
        prefs.extension_root = root.to_string();
    }
    if let Some(theme) = patch.theme {
        let theme = theme.trim();
        if !valid_theme(theme) {
            return Err(AppError::business("主题名无效"));
        }
        prefs.theme = theme.to_string();
    }
    if let Some(mode) = patch.music_mode {
        if mode > 2 {
            return Err(AppError::business("播放模式无效"));
        }
        prefs.music_mode = mode;
    }
    if let Some(username) = patch.login_username {
        prefs.login_username = clip_username(&username);
    }
    save_prefs(&app, &prefs)?;
    let _ = app.emit(PREFS_CHANGED_EVENT, ());
    Ok(prefs)
}

pub(crate) fn load_prefs(app: &AppHandle) -> DesktopPrefs {
    let Ok(path) = prefs_path(app) else {
        return DesktopPrefs::default();
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return DesktopPrefs::default();
    };
    let Ok(mut value) = serde_json::from_str::<Value>(&text) else {
        return DesktopPrefs::default();
    };
    let dirty = scrub(&mut value);
    let mut prefs = serde_json::from_value::<DesktopPrefs>(value).unwrap_or_default();
    sanitize_prefs(&mut prefs);
    if dirty {
        let _ = save_prefs(app, &prefs);
    }
    prefs
}

pub(crate) fn save_prefs(app: &AppHandle, prefs: &DesktopPrefs) -> Result<(), AppError> {
    let mut prefs = prefs.clone();
    sanitize_prefs(&mut prefs);
    let path = prefs_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| AppError::business("无法保存桌面偏好"))?;
    }
    let text =
        serde_json::to_string_pretty(&prefs).map_err(|_| AppError::business("无法保存桌面偏好"))?;
    let temp = path.with_file_name(format!("{PREFS_FILE}-{}.tmp", unique_stamp()));
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, &path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result.map_err(|_| AppError::business("无法保存桌面偏好"))
}

fn prefs_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::business("无法打开应用数据目录"))?
        .join(PREFS_FILE))
}

fn sanitize_prefs(prefs: &mut DesktopPrefs) {
    prefs.update_mirror = match super::updater::normalize_mirror_host(&prefs.update_mirror) {
        Ok(host) => host,
        Err(_) => String::new(),
    };
    if prefs.window_width < 350 {
        prefs.window_width = default_window_width();
    }
    if prefs.window_height < 200 {
        prefs.window_height = default_window_height();
    }
    prefs.extension_root = prefs.extension_root.trim().to_string();
    if !valid_extension_root(&prefs.extension_root) {
        prefs.extension_root = default_extension_root().display().to_string();
    }
    prefs.theme = prefs.theme.trim().to_string();
    if !valid_theme(&prefs.theme) {
        prefs.theme = "Default".to_string();
    }
    if prefs.music_mode > 2 {
        prefs.music_mode = 0;
    }
    prefs.login_username = clip_username(&prefs.login_username);
}

fn default_extension_root() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    PathBuf::from(home).join(".fishpi")
}

pub(crate) fn valid_extension_root(root: &str) -> bool {
    let root = root.trim();
    !root.is_empty()
        && root.len() <= 4_096
        && Path::new(root).is_absolute()
        && !root.starts_with("\\\\")
        && !root.starts_with("//")
        && !root.chars().any(char::is_control)
}

fn valid_theme(theme: &str) -> bool {
    let theme = theme.trim();
    !theme.is_empty() && theme.len() <= 120 && !theme.chars().any(char::is_control)
}

fn unique_stamp() -> String {
    format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )
}

struct WindowPatch {
    opacity: Option<f64>,
    always_on_top: Option<bool>,
}

struct LegacyFound {
    location: String,
    credential: Option<String>,
    setting: Value,
    username: Option<String>,
}

enum Lookup {
    Missing { message: String },
    Rejected { message: String },
    Found(LegacyFound),
}

fn read_legacy() -> Lookup {
    let Some(roaming) = std::env::var_os("APPDATA") else {
        return Lookup::Missing {
            message: "找不到 APPDATA，无法定位旧客户端数据目录".to_string(),
        };
    };
    let roaming = PathBuf::from(roaming);
    let names = ["fishpi-app", "fishpi"];
    let mut checked = Vec::new();
    let mut found = Vec::new();
    let mut unreadable = false;
    for name in names {
        let user_data = roaming.join(name);
        let leveldb = user_data.join("Local Storage").join("leveldb");
        checked.push(leveldb.display().to_string());
        if !user_data.is_dir() {
            continue;
        }
        if !leveldb.is_dir() {
            continue;
        }
        if !leveldb_is_allowed(&roaming, &leveldb) {
            continue;
        }
        match read_leveldb(&leveldb) {
            Ok(Some(item)) => found.push(LegacyFound {
                location: user_data.display().to_string(),
                credential: item.credential,
                setting: item.setting,
                username: item.username,
            }),
            Ok(None) => {}
            Err(_) => unreadable = true,
        }
    }
    if unreadable {
        return Lookup::Rejected {
            message: "旧数据不可读、复制时仍在变化、超出读取上限或含多个来源配置；未导入。请先关闭旧客户端后重试".to_string(),
        };
    }
    match found.len() {
        0 => Lookup::Missing {
            message: format!(
                "找不到旧客户端配置。已查看：{}。这些目录里没有摸鱼派的本地存储。",
                checked.join("、")
            ),
        },
        1 => Lookup::Found(found.remove(0)),
        _ => Lookup::Rejected {
            message: "找到多个旧数据目录，无法确定该用哪一个，已拒绝导入".to_string(),
        },
    }
}

fn leveldb_is_allowed(roaming: &Path, leveldb: &Path) -> bool {
    let Ok(roaming) = roaming.canonicalize() else {
        return false;
    };
    let Ok(leveldb) = leveldb.canonicalize() else {
        return false;
    };
    let Ok(relative) = leveldb.strip_prefix(&roaming) else {
        return false;
    };
    let parts: Vec<_> = relative.components().collect();
    if parts.len() != 3 {
        return false;
    }
    let name = parts[0].as_os_str().to_string_lossy();
    (name == "fishpi" || name == "fishpi-app")
        && parts[1]
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case("Local Storage")
        && parts[2]
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case("leveldb")
}

struct LeveldbItem {
    credential: Option<String>,
    setting: Value,
    username: Option<String>,
}

fn read_leveldb(source: &Path) -> Result<Option<LeveldbItem>, ()> {
    let temp = std::env::temp_dir().join(format!("fishpi-legacy-{}", unique_stamp()));
    std::fs::create_dir(&temp).map_err(|_| ())?;
    let _cleanup = TempDir(temp.clone());
    let mut copied = 0u64;
    for entry in std::fs::read_dir(source).map_err(|_| ())? {
        let entry = entry.map_err(|_| ())?;
        if !entry
            .file_type()
            .map(|kind| kind.is_file())
            .unwrap_or(false)
        {
            continue;
        }
        let name = entry.file_name();
        if name.to_string_lossy().eq_ignore_ascii_case("LOCK") {
            continue;
        }
        let mut input = std::fs::File::open(entry.path()).map_err(|_| ())?;
        let size = input.metadata().map_err(|_| ())?.len();
        copied = copied
            .checked_add(size)
            .filter(|total| *total <= MAX_LEVELDB_COPY)
            .ok_or(())?;
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(temp.join(name))
            .map_err(|_| ())?;
        let actual = std::io::copy(&mut Read::by_ref(&mut input).take(size + 1), &mut output)
            .map_err(|_| ())?;
        if actual != size {
            return Err(());
        }
    }
    let mut database = open_copy(&temp)?;
    let mut iter = database.new_iter().map_err(|_| ())?;
    let mut origins: BTreeMap<String, LeveldbItem> = BTreeMap::new();
    while let Some((key, value)) = LdbIterator::next(&mut iter) {
        if value.len() > MAX_LEGACY_VALUE {
            continue;
        }
        let Some((origin, name)) = storage_record(&key) else {
            continue;
        };
        if name == "passwd" || name == "password" {
            continue;
        }
        if !matches!(name.as_str(), "setting" | "token" | "username") {
            continue;
        }
        let item = origins.entry(origin).or_insert_with(|| LeveldbItem {
            credential: None,
            setting: Value::Null,
            username: None,
        });
        if name == "setting" && item.setting.is_null() {
            item.setting = decode_texts(&value)
                .into_iter()
                .find_map(|text| {
                    let text = text.trim_matches('\0').trim();
                    let mut parsed: Value = serde_json::from_str(text).ok()?;
                    scrub(&mut parsed);
                    is_fishpi_setting(&parsed).then_some(parsed)
                })
                .unwrap_or(Value::Null);
        }
        if name == "token" && item.credential.is_none() {
            item.credential = decode_texts(&value)
                .into_iter()
                .map(|text| text.trim_matches('\0').trim().to_string())
                .find(|text| looks_like_credential(text));
        }
        if name == "username" && item.username.is_none() {
            item.username = decode_texts(&value)
                .into_iter()
                .map(|text| clip_username(&text.trim_matches('\0')))
                .find(|text| !text.is_empty());
        }
    }
    drop(iter);
    drop(database);
    select_legacy_origin(origins)
}

fn select_legacy_origin(origins: BTreeMap<String, LeveldbItem>) -> Result<Option<LeveldbItem>, ()> {
    let mut found = origins.into_values().filter(|item| !item.setting.is_null());
    let item = found.next();
    if found.next().is_some() {
        return Err(());
    }
    Ok(item)
}

fn open_copy(path: &Path) -> Result<rusty_leveldb::DB, ()> {
    for compressor in [1u8, 0u8] {
        let mut options = rusty_leveldb::Options::default();
        options.create_if_missing = false;
        options.compressor = compressor;
        if let Ok(database) = rusty_leveldb::DB::open(path, options) {
            return Ok(database);
        }
    }
    Err(())
}

fn storage_record(key: &[u8]) -> Option<(String, String)> {
    let body = key.strip_prefix(b"_")?;
    // Chromium: "_" + origin + NUL + encoded DOMString. UTF-16 has embedded NULs.
    let sep = body.iter().position(|byte| *byte == 0)?;
    let origin = std::str::from_utf8(body.get(..sep)?).ok()?;
    if !matches!(
        origin,
        "file://" | "http://localhost:9080" | "http://127.0.0.1:9080"
    ) {
        return None;
    }
    let text = decode_dom_string(body.get(sep + 1..)?)?;
    let text = text.trim_matches('\0').trim();
    if text.is_empty()
        || text.len() > 64
        || !text
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
    {
        return None;
    }
    Some((origin.to_string(), text.to_string()))
}

#[cfg(test)]
fn storage_name(key: &[u8]) -> Option<String> {
    storage_record(key).map(|(_, name)| name)
}

fn decode_texts(value: &[u8]) -> Vec<String> {
    decode_dom_string(value).into_iter().collect()
}

fn decode_dom_string(value: &[u8]) -> Option<String> {
    match value.split_first()? {
        (0, bytes) => utf16_le(bytes),
        (1, bytes) => Some(bytes.iter().map(|byte| char::from(*byte)).collect()),
        _ => None,
    }
}

fn utf16_le(bytes: &[u8]) -> Option<String> {
    if bytes.len() % 2 != 0 {
        return None;
    }
    let units = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect::<Vec<_>>();
    String::from_utf16(&units).ok()
}

fn looks_like_credential(text: &str) -> bool {
    let text = text.trim();
    (8..=256).contains(&text.len())
        && !text.starts_with('{')
        && text
            .chars()
            .all(|ch| !ch.is_whitespace() && !ch.is_control())
}

fn is_fishpi_setting(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.get("global").and_then(Value::as_object).is_some()
        || object
            .get("extensions")
            .and_then(Value::as_object)
            .is_some()
        || object.get("chatroom").and_then(Value::as_object).is_some()
        || object.get("message").and_then(Value::as_object).is_some()
        || object.get("hotkey").and_then(Value::as_object).is_some()
}

fn import_legacy_filters(app: &AppHandle, setting: &Value, notes: &mut Vec<String>) -> bool {
    let Some(chatroom) = setting.get("chatroom").and_then(Value::as_object) else {
        return false;
    };
    if !chatroom.contains_key("shield") && !chatroom.contains_key("careUsers") {
        return false;
    }
    let Ok(current) = super::chatroom_filters_get(app.clone()) else {
        notes.push("无法读取现有屏蔽/特别关心，未覆盖原记录".to_string());
        return false;
    };
    let Some(request) = filters_from_legacy(setting, current, notes) else {
        return false;
    };
    match super::chatroom_filters_set(app.clone(), request.clone()) {
        Ok(saved) => {
            if saved != request {
                notes.push(
                    "屏蔽/特别关心已按现有上限规范化（40条规则、100个用户、规则200字、用户名64字）"
                        .to_string(),
                );
            }
            notes.push(format!(
                "屏蔽规则已导入{}条，特别关心已导入{}个",
                saved.shield.len(),
                saved.care_users.len()
            ));
            true
        }
        Err(_) => {
            notes.push("屏蔽/特别关心保存失败".to_string());
            false
        }
    }
}

fn filters_from_legacy(
    setting: &Value,
    mut current: super::chatroom_filters::ChatroomFilters,
    notes: &mut Vec<String>,
) -> Option<super::chatroom_filters::ChatroomFilters> {
    use super::chatroom_filters::{ShieldRule, ShieldType};
    let chatroom = setting.get("chatroom")?.as_object()?;
    let mut touched = false;
    if let Some(raw) = chatroom.get("shield") {
        if let Some(items) = raw.as_array() {
            let mut rules = Vec::new();
            let mut invalid = 0;
            for item in items {
                let kind = match item.get("type").and_then(Value::as_str) {
                    Some("username") => ShieldType::Username,
                    Some("content") => ShieldType::Content,
                    Some("redpacket") => ShieldType::Redpacket,
                    _ => {
                        invalid += 1;
                        continue;
                    }
                };
                let value = match item.get("value") {
                    Some(Value::String(value)) => value.clone(),
                    None if matches!(kind, ShieldType::Redpacket) => String::new(),
                    _ => {
                        invalid += 1;
                        continue;
                    }
                };
                rules.push(ShieldRule { kind, value });
            }
            if invalid > 0 {
                notes.push(format!("跳过{invalid}条格式不合法的旧屏蔽规则"));
            }
            // A malformed nonempty field must not erase valid current data.
            if items.is_empty() || !rules.is_empty() {
                current.shield = rules;
                touched = true;
            }
        } else {
            notes.push("旧shield不是数组，保留现有屏蔽规则".to_string());
        }
    }
    if let Some(raw) = chatroom.get("careUsers") {
        if let Some(items) = raw.as_array() {
            let users: Vec<_> = items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect();
            if users.len() != items.len() {
                notes.push("已跳过非字符串的特别关心记录".to_string());
            }
            if items.is_empty() || !users.is_empty() {
                current.care_users = users;
                touched = true;
            }
        } else {
            notes.push("旧careUsers不是数组，保留现有特别关心".to_string());
        }
    }
    touched.then_some(current)
}

fn report_legacy_limits(setting: &Value, notes: &mut Vec<String>) {
    if let Some(pattern) = setting
        .pointer("/message/notice/talkmsg")
        .and_then(Value::as_str)
    {
        if pattern.len() > 200 {
            notes.push("通知关键词超过现有200字节上限，已截短".to_string());
        }
    }
    let known: &[(&str, &[&str])] = &[
        (
            "global",
            &[
                "opacity",
                "topWindow",
                "autoReward",
                "music",
                "updateMirror",
            ],
        ),
        ("chatroom", &["shield", "careUsers", "redpackNotice"]),
        ("message", &["notice", "way"]),
        ("hotkey", &["boss"]),
        ("extensions", &["root", "theme"]),
    ];
    for (area, keys) in known {
        if let Some(object) = setting.get(*area).and_then(Value::as_object) {
            let count = object
                .keys()
                .filter(|key| !keys.contains(&key.as_str()))
                .count();
            if count > 0 {
                notes.push(format!(
                    "旧{area}含{count}个非内置字段，未将插件自定义数据写入普通偏好"
                ));
            }
        }
    }
}

fn patch_from_legacy(setting: &Value) -> (SettingsPatch, WindowPatch) {
    let mut patch = SettingsPatch::default();
    let mut window = WindowPatch {
        opacity: None,
        always_on_top: None,
    };
    let global = setting.get("global").and_then(Value::as_object);
    if let Some(global) = global {
        if let Some(opacity) = global.get("opacity").and_then(Value::as_object) {
            if let Some(value) = opacity.get("value").and_then(Value::as_f64) {
                let scaled = (value / 100.0).clamp(0.1, 1.0);
                patch.opacity = Some(scaled);
            }
            if let Some(enable) = opacity.get("enable").and_then(Value::as_bool) {
                patch.opacity_enabled = Some(enable);
                if enable {
                    window.opacity = patch.opacity;
                } else {
                    window.opacity = Some(1.0);
                }
            }
        }
        if let Some(on) = global.get("topWindow").and_then(Value::as_bool) {
            patch.always_on_top = Some(on);
            window.always_on_top = Some(on);
        }
        if let Some(on) = global.get("autoReward").and_then(Value::as_bool) {
            patch.auto_reward = Some(on);
        }
    }
    if let Some(redpack) = setting
        .pointer("/chatroom/redpackNotice")
        .and_then(Value::as_bool)
    {
        patch.redpack_notice = Some(redpack);
    }
    if let Some(boss) = legacy_hotkey(setting) {
        patch.hotkey = Some(boss.clone());
        patch.boss_key = Some(boss);
    }
    if let Some(message) = setting.get("message").and_then(Value::as_object) {
        if let Some(notice) = message.get("notice").and_then(Value::as_object) {
            patch.notify_chatroom = notice.get("chatroom").and_then(Value::as_bool);
            patch.notify_chat = notice.get("chat").and_then(Value::as_bool);
            patch.notify_at = notice.get("at").and_then(Value::as_bool);
            patch.notify_reply = notice.get("reply").and_then(Value::as_bool);
            patch.notify_sys = notice.get("sys").and_then(Value::as_bool);
            patch.notify_talk = notice.get("talk").and_then(Value::as_bool);
            patch.notify_talk_pattern = notice
                .get("talkmsg")
                .and_then(Value::as_str)
                .map(|text| clip(text, 200));
        }
        if let Some(way) = message.get("way").and_then(Value::as_object) {
            patch.notify_sound = way.get("audio").and_then(Value::as_bool);
            if let Some(system) = way.get("msg").and_then(Value::as_bool) {
                patch.notify_system = Some(system);
                patch.notify_enabled = Some(system);
            }
        }
    }
    (patch, window)
}

fn legacy_hotkey(setting: &Value) -> Option<String> {
    let boss = setting.pointer("/hotkey/boss")?;
    let text = boss
        .as_str()
        .or_else(|| boss.get("text").and_then(Value::as_str))?
        .trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

fn patch_touched(patch: &SettingsPatch) -> bool {
    patch.opacity.is_some()
        || patch.opacity_enabled.is_some()
        || patch.always_on_top.is_some()
        || patch.auto_reward.is_some()
        || patch.notify_chatroom.is_some()
        || patch.notify_chat.is_some()
        || patch.notify_at.is_some()
        || patch.notify_reply.is_some()
        || patch.notify_sys.is_some()
        || patch.notify_talk.is_some()
        || patch.notify_talk_pattern.is_some()
        || patch.notify_sound.is_some()
        || patch.notify_system.is_some()
        || patch.notify_enabled.is_some()
        || patch.hotkey.is_some()
        || patch.boss_key.is_some()
        || patch.redpack_notice.is_some()
}

fn apply_legacy_prefs(prefs: &mut DesktopPrefs, setting: &Value, notes: &mut Vec<String>) {
    if let Some(mirror) = setting
        .pointer("/global/updateMirror")
        .and_then(Value::as_str)
    {
        match super::updater::normalize_mirror_host(mirror) {
            Ok(host) => prefs.update_mirror = host,
            Err(_) => notes.push("更新镜像域名无效，已跳过".to_string()),
        }
    }
    if let Some(root) = setting.pointer("/extensions/root").and_then(Value::as_str) {
        let root = root.trim();
        if valid_extension_root(root) {
            prefs.extension_root = root.to_string();
        } else {
            notes.push("旧扩展目录不是有效的本地绝对路径，已保留现有目录".to_string());
        }
    }
    if let Some(theme) = setting.pointer("/extensions/theme").and_then(Value::as_str) {
        let theme = theme.trim();
        if valid_theme(theme) {
            prefs.theme = theme.to_string();
        } else {
            notes.push("旧主题标识无效，已保留现有主题".to_string());
        }
    }
    if let Some(mode) = setting.pointer("/global/music").and_then(Value::as_u64) {
        if mode <= 2 {
            prefs.music_mode = mode as u8;
        } else {
            notes.push("旧音乐模式无效，已保留现有模式".to_string());
        }
    }
}

fn clip(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

const USERNAME_MAX: usize = 64;

fn clip_username(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.starts_with('{') {
        return String::new();
    }
    if trimmed
        .chars()
        .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return String::new();
    }
    clip(trimmed, USERNAME_MAX)
}

fn scrub(value: &mut Value) -> bool {
    match value {
        Value::Object(map) => {
            let before = map.len();
            map.retain(|key, _| !is_secret_key(key));
            let mut dirty = map.len() != before;
            for child in map.values_mut() {
                dirty |= scrub(child);
            }
            dirty
        }
        Value::Array(items) => {
            let mut dirty = false;
            for child in items {
                dirty |= scrub(child);
            }
            dirty
        }
        _ => false,
    }
}

fn is_secret_key(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().replace('-', "_").as_str(),
        "token"
            | "apikey"
            | "api_key"
            | "password"
            | "passwd"
            | "pwd"
            | "mfa"
            | "mfacode"
            | "captcha"
            | "secret"
    )
}

#[cfg(test)]
mod tests {
    use super::super::chatroom_filters::{ChatroomFilters, ShieldRule, ShieldType};
    use super::*;
    use serde_json::json;

    fn encoded_utf16(text: &str) -> Vec<u8> {
        let mut bytes = vec![0];
        for unit in text.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        bytes
    }

    #[test]
    fn chromium_latin1_and_utf16_key_value_tags() {
        assert_eq!(
            storage_name(b"_file://\0\x01setting").as_deref(),
            Some("setting")
        );
        let mut key = b"_file://\0".to_vec();
        key.extend(encoded_utf16("setting"));
        assert_eq!(storage_name(&key).as_deref(), Some("setting"));
        assert_eq!(
            decode_texts(b"\x01{\"global\":{}}"),
            vec!["{\"global\":{}}"]
        );
        let text = "{\"chatroom\":{\"careUsers\":[\"\u{5173}\u{5fc3}\"]}}";
        assert_eq!(decode_texts(&encoded_utf16(text)), vec![text]);
        assert!(decode_texts(&[0, 1]).is_empty());
        assert!(storage_name(b"META:file://").is_none());
        assert!(storage_name(b"_file://\0\x01bad/name").is_none());
        assert!(storage_name(b"_https://unrelated.example\0\x01setting").is_none());
        assert_eq!(decode_dom_string(&[1, b'A', 0xe9]), Some("A\u{e9}".into()));
        assert!(decode_dom_string(b"untagged").is_none());
    }

    #[test]
    fn legacy_origins_never_mix_settings_and_credentials() {
        let mut origins = BTreeMap::new();
        origins.insert(
            "file://".into(),
            LeveldbItem {
                setting: json!({"chatroom":{"careUsers":["Ada"]}}),
                credential: None,
                username: Some("Ada".into()),
            },
        );
        origins.insert(
            "http://localhost:9080".into(),
            LeveldbItem {
                setting: Value::Null,
                credential: Some("different-origin-token".into()),
                username: Some("Other".into()),
            },
        );
        let selected = select_legacy_origin(origins).unwrap().unwrap();
        assert!(selected.credential.is_none());
        assert_eq!(selected.username.as_deref(), Some("Ada"));
        let mut origins = BTreeMap::new();
        for origin in ["file://", "http://localhost:9080"] {
            origins.insert(
                origin.into(),
                LeveldbItem {
                    setting: json!({"global":{}}),
                    credential: None,
                    username: None,
                },
            );
        }
        assert!(select_legacy_origin(origins).is_err());
    }

    #[test]
    fn maps_every_builtin_setting() {
        let setting = json!({
            "global": {"opacity":{"enable":true,"value":60},"topWindow":true,"autoReward":true,
                "music":2,"updateMirror":""},
            "chatroom":{"redpackNotice":true},
            "message":{"notice":{"chatroom":true,"chat":true,"at":true,"reply":true,"sys":true,
                "talk":true,"talkmsg":"a|b"},"way":{"audio":true,"msg":true}},
            "hotkey":{"boss":{"text":"Alt+F2"}},
            "extensions":{"root":default_extension_root().display().to_string(),"theme":"publisher.theme"}
        });
        let (patch, window) = patch_from_legacy(&setting);
        assert!(patch_touched(&patch));
        let saved = patch.apply(crate::dto::AppSettings::default()).unwrap();
        assert_eq!(saved.opacity, 0.6);
        assert!(
            saved.opacity_enabled
                && saved.always_on_top
                && saved.auto_reward
                && saved.redpack_notice
        );
        assert!(
            saved.notify_chatroom && saved.notify_chat && saved.notify_at && saved.notify_reply
        );
        assert!(
            saved.notify_sys
                && saved.notify_talk
                && saved.notify_sound
                && saved.notify_system
                && saved.notify_enabled
        );
        assert_eq!(saved.notify_talk_pattern, "a|b");
        assert_eq!(saved.hotkey, "Alt+F2");
        assert_eq!(saved.boss_key, "Alt+F2");
        assert_eq!(window.opacity, Some(0.6));
        assert_eq!(window.always_on_top, Some(true));
        assert!(!saved.close_to_tray);
        let mut prefs = DesktopPrefs::default();
        apply_legacy_prefs(&mut prefs, &setting, &mut Vec::new());
        assert_eq!(prefs.music_mode, 2);
        assert_eq!(prefs.theme, "publisher.theme");
        assert_eq!(
            prefs.extension_root,
            default_extension_root().display().to_string()
        );
    }

    #[test]
    fn partial_settings_do_not_reset_and_disabled_opacity_is_opaque() {
        let (patch, window) =
            patch_from_legacy(&json!({"global":{"opacity":{"enable":false,"value":45}}}));
        assert_eq!(patch.opacity, Some(0.45));
        assert_eq!(patch.opacity_enabled, Some(false));
        assert_eq!(window.opacity, Some(1.0));
        assert_eq!(patch.auto_reward, None);
        assert_eq!(patch.hotkey, None);
        let (patch, _) = patch_from_legacy(&json!({"chatroom":{"redpackNotice":false}}));
        assert!(patch_touched(&patch));
        assert_eq!(patch.redpack_notice, Some(false));
    }

    #[test]
    fn filters_map_all_types_preserve_missing_and_honor_explicit_empty() {
        let current = ChatroomFilters {
            shield: vec![ShieldRule {
                kind: ShieldType::Username,
                value: "old".into(),
            }],
            care_users: vec!["old-care".into()],
        };
        let mut notes = Vec::new();
        let next = filters_from_legacy(
            &json!({"chatroom":{"shield":[
                {"type":"username","value":"Ada"},{"type":"content","value":"a.*b"},
                {"type":"redpacket"},{"type":"unknown","value":"bad"}
            ]}}),
            current.clone(),
            &mut notes,
        )
        .unwrap();
        assert_eq!(next.shield.len(), 3);
        assert_eq!(next.shield[1].kind, ShieldType::Content);
        assert_eq!(next.shield[1].value, "a.*b");
        assert_eq!(next.shield[2].kind, ShieldType::Redpacket);
        assert_eq!(next.care_users, current.care_users);
        assert!(!notes.is_empty());
        let cleared = filters_from_legacy(
            &json!({"chatroom":{"shield":[],"careUsers":[]}}),
            current.clone(),
            &mut notes,
        )
        .unwrap();
        assert!(cleared.shield.is_empty() && cleared.care_users.is_empty());
        assert!(filters_from_legacy(
            &json!({"chatroom":{"shield":[false],"careUsers":false}}),
            current.clone(),
            &mut notes
        )
        .is_none());
        let next = filters_from_legacy(
            &json!({"chatroom":{"careUsers":["Ada",123]}}),
            current.clone(),
            &mut notes,
        )
        .unwrap();
        assert_eq!(next.shield, current.shield);
        assert_eq!(next.care_users, ["Ada"]);
    }

    #[test]
    fn prefs_and_results_never_serialize_credentials() {
        let mut value = json!({"global":{"token":"secret","api-key":"secret","opacity":{"value":60}},
            "extensions":{"password":"secret","theme":"Default"},
            "chatroom":{"careUsers":["Ada"],"nested":[{"passwd":"secret","value":"safe"}]}});
        assert!(scrub(&mut value));
        assert!(!value.to_string().contains("secret"));
        assert_eq!(value["chatroom"]["careUsers"], json!(["Ada"]));
        let prefs = serde_json::to_value(DesktopPrefs::default()).unwrap();
        assert!(prefs.get("token").is_none());
        let result = serde_json::to_value(ImportResult {
            found: true,
            credential_saved: false,
            settings_saved: true,
            prefs_saved: true,
            filters_saved: true,
            message: "status only".into(),
        })
        .unwrap();
        assert!(result.get("token").is_none());
        assert_eq!(result["filtersSaved"], true);
    }

    #[test]
    fn invalid_prefs_keep_existing_and_report_limits() {
        let mut prefs = DesktopPrefs::default();
        let mut notes = Vec::new();
        apply_legacy_prefs(
            &mut prefs,
            &json!({
                "global":{"music":999},"extensions":{"root":"../escape","theme":"bad\0"}
            }),
            &mut notes,
        );
        assert_eq!(prefs.music_mode, 0);
        assert_eq!(prefs.theme, "Default");
        assert_eq!(notes.len(), 3);
        assert!(!valid_extension_root("\\\\server\\share"));
        assert!(!valid_extension_root("//server/share"));
        assert!(!valid_extension_root("relative"));
        assert!(is_fishpi_setting(&json!({"chatroom":{"careUsers":[]}})));
    }
}

struct TempDir(PathBuf);

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
