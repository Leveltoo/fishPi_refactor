//! 从旧版 Electron 的 Local Storage 导入登录凭据和设置。
//!
//! Windows 上 userData 只认 `%APPDATA%\fishpi-app` 与 `%APPDATA%\fishpi`
//! （package name 与 productName）。不扫描其他应用目录。
//! LevelDB 先复制再打开，因为 rusty-leveldb 的 open 会写 LOCK。
//! 凭据只进 `credentials::save`，不进 Store、不进返回值、不写日志。

use std::path::{Path, PathBuf};

use rusty_leveldb::LdbIterator;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::credentials;
use crate::dto::{AlwaysOnTopRequest, OpacityRequest, SettingsPatch};
use crate::error::AppError;

const PREFS_FILE: &str = "desktop-prefs.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopPrefs {
    pub update_mirror: String,
    pub extension_root: String,
    pub theme: String,
    pub music_mode: u8,
}

impl Default for DesktopPrefs {
    fn default() -> Self {
        Self {
            update_mirror: String::new(),
            extension_root: default_extension_root().display().to_string(),
            theme: "Default".to_string(),
            music_mode: 0,
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
    pub message: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPrefsPatch {
    pub update_mirror: Option<String>,
    pub extension_root: Option<String>,
    pub theme: Option<String>,
    pub music_mode: Option<u8>,
}

/// 查找旧客户端并导入。找不到就明确失败，不写假的成功。
#[tauri::command(rename_all = "camelCase")]
pub async fn config_import(app: AppHandle) -> Result<ImportResult, AppError> {
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
                message,
            });
        }
        Lookup::Found(found) => found,
    };

    let mut notes = Vec::new();
    let credential_saved = match found.credential.as_deref() {
        Some(value) => match credentials::save(value) {
            Ok(()) => {
                notes.push("登录凭据已写入系统凭据库".to_string());
                true
            }
            Err(_) => {
                notes.push("登录凭据写入失败，没有改用明文文件".to_string());
                false
            }
        },
        None => {
            notes.push("旧数据里没有登录凭据".to_string());
            false
        }
    };
    drop(found.credential);

    let (patch, window) = patch_from_legacy(&found.setting);
    let settings_saved = if patch_touched(&patch) {
        match super::settings_set(app.clone(), patch) {
            Ok(()) => {
                if let Some(opacity) = window.opacity {
                    if super::window_set_opacity(app.clone(), OpacityRequest { opacity }).is_err()
                    {
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
                notes.push("能对应的普通设置已写入".to_string());
                true
            }
            Err(err) => {
                notes.push(format!("普通设置没有写入：{}", err.message()));
                false
            }
        }
    } else {
        notes.push("没有可对应的普通设置".to_string());
        false
    };

    let mut prefs = load_prefs(&app);
    apply_legacy_prefs(&mut prefs, &found.setting, &mut notes);
    let prefs_saved = match save_prefs(&app, &prefs) {
        Ok(()) => true,
        Err(_) => {
            notes.push("扩展与播放偏好没有写入".to_string());
            false
        }
    };
    if prefs_saved {
        notes.push(format!("已从 {} 读取", found.location));
    }

    Ok(ImportResult {
        found: true,
        credential_saved,
        settings_saved,
        prefs_saved,
        message: notes.join("；"),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn desktop_prefs_get(app: AppHandle) -> Result<DesktopPrefs, AppError> {
    Ok(load_prefs(&app))
}

#[tauri::command(rename_all = "camelCase")]
pub fn desktop_prefs_set(app: AppHandle, patch: DesktopPrefsPatch) -> Result<DesktopPrefs, AppError> {
    let mut prefs = load_prefs(&app);
    if let Some(mirror) = patch.update_mirror {
        let mirror = mirror.trim();
        if !mirror.is_empty() && !super::updater::valid_host(mirror) {
            return Err(AppError::business("更新镜像域名无效"));
        }
        prefs.update_mirror = mirror.to_string();
    }
    if let Some(root) = patch.extension_root {
        let root = root.trim();
        if root.is_empty() || root.contains('\0') {
            return Err(AppError::business("扩展目录无效"));
        }
        prefs.extension_root = root.to_string();
    }
    if let Some(theme) = patch.theme {
        let theme = theme.trim();
        if theme.is_empty() || theme.len() > 120 {
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
    save_prefs(&app, &prefs)?;
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
    let text = serde_json::to_string_pretty(&prefs)
        .map_err(|_| AppError::business("无法保存桌面偏好"))?;
    std::fs::write(path, text).map_err(|_| AppError::business("无法保存桌面偏好"))
}

fn prefs_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::business("无法打开应用数据目录"))?
        .join(PREFS_FILE))
}

fn sanitize_prefs(prefs: &mut DesktopPrefs) {
    prefs.update_mirror = prefs.update_mirror.trim().to_string();
    if !prefs.update_mirror.is_empty() && !super::updater::valid_host(&prefs.update_mirror) {
        prefs.update_mirror.clear();
    }
    prefs.extension_root = prefs.extension_root.trim().to_string();
    if prefs.extension_root.is_empty() {
        prefs.extension_root = default_extension_root().display().to_string();
    }
    prefs.theme = prefs.theme.trim().to_string();
    if prefs.theme.is_empty() {
        prefs.theme = "Default".to_string();
    }
    if prefs.music_mode > 2 {
        prefs.music_mode = 0;
    }
}

fn default_extension_root() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    PathBuf::from(home).join(".fishpi")
}

struct WindowPatch {
    opacity: Option<f64>,
    always_on_top: Option<bool>,
}

struct LegacyFound {
    location: String,
    credential: Option<String>,
    setting: Value,
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
                credential: item.0,
                setting: item.1,
            }),
            Ok(None) => {}
            Err(_) => {}
        }
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
        && parts[1].as_os_str().to_string_lossy().eq_ignore_ascii_case("Local Storage")
        && parts[2].as_os_str().to_string_lossy().eq_ignore_ascii_case("leveldb")
}

fn read_leveldb(source: &Path) -> Result<Option<(Option<String>, Value)>, ()> {
    let temp = std::env::temp_dir().join(format!(
        "fishpi-legacy-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).map_err(|_| ())?;
    let _cleanup = TempDir(temp.clone());
    for entry in std::fs::read_dir(source).map_err(|_| ())? {
        let entry = entry.map_err(|_| ())?;
        if !entry.file_type().map(|kind| kind.is_file()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name();
        if name.to_string_lossy().eq_ignore_ascii_case("LOCK") {
            continue;
        }
        std::fs::copy(entry.path(), temp.join(name)).map_err(|_| ())?;
    }
    let mut database = open_copy(&temp)?;
    let mut iter = database.new_iter().map_err(|_| ())?;
    let mut setting = None;
    let mut credential = None;
    while let Some((key, value)) = LdbIterator::next(&mut iter) {
        let Some(name) = storage_name(&key) else {
            continue;
        };
        if name == "passwd" || name == "password" {
            continue;
        }
        if name == "setting" && setting.is_none() {
            setting = decode_texts(&value).into_iter().find_map(|text| {
                let text = text.trim_matches('\0').trim();
                let mut parsed: Value = serde_json::from_str(text).ok()?;
                scrub(&mut parsed);
                is_fishpi_setting(&parsed).then_some(parsed)
            });
        }
        if name == "token" && credential.is_none() {
            credential = decode_texts(&value)
                .into_iter()
                .map(|text| text.trim_matches('\0').trim().to_string())
                .find(|text| looks_like_credential(text));
        }
    }
    drop(iter);
    drop(database);
    let Some(setting) = setting else {
        return Ok(None);
    };
    Ok(Some((credential, setting)))
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

fn storage_name(key: &[u8]) -> Option<String> {
    let body = key.strip_prefix(b"_").unwrap_or(key);
    let sep = body.iter().rposition(|byte| *byte == 0 || *byte == 1)?;
    let raw = body.get(sep + 1..)?;
    let text = std::str::from_utf8(raw)
        .ok()
        .map(str::to_string)
        .or_else(|| utf16_le(raw))?;
    let text = text.trim_matches('\0').trim();
    if text.is_empty() || text.len() > 64 {
        return None;
    }
    if !text
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
    {
        return None;
    }
    Some(text.to_string())
}

fn decode_texts(value: &[u8]) -> Vec<String> {
    let mut texts = Vec::new();
    if let Some(rest) = value.strip_prefix(&[1]) {
        if let Some(text) = utf16_le(rest) {
            texts.push(text);
        }
    }
    if let Some(text) = utf16_le(value) {
        texts.push(text);
    }
    if let Ok(text) = std::str::from_utf8(value) {
        texts.push(text.to_string());
    }
    texts
}

fn utf16_le(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 2 || bytes.len() % 2 != 0 {
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
        && text.chars().all(|ch| !ch.is_whitespace() && !ch.is_control())
}

fn is_fishpi_setting(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.get("global").and_then(Value::as_object).is_some()
        || object.get("extensions").and_then(Value::as_object).is_some()
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
            if opacity.get("enable").and_then(Value::as_bool) == Some(true) {
                if let Some(value) = opacity.get("value").and_then(Value::as_f64) {
                    let scaled = (value / 100.0).clamp(0.3, 1.0);
                    patch.opacity = Some(scaled);
                    window.opacity = Some(scaled);
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

fn patch_touched(patch: &SettingsPatch) -> bool {
    patch.opacity.is_some()
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
}

fn apply_legacy_prefs(prefs: &mut DesktopPrefs, setting: &Value, notes: &mut Vec<String>) {
    if let Some(mirror) = setting
        .pointer("/global/updateMirror")
        .and_then(Value::as_str)
    {
        let mirror = mirror.trim();
        if mirror.is_empty() || super::updater::valid_host(mirror) {
            prefs.update_mirror = mirror.to_string();
        } else {
            notes.push("更新镜像域名无效，已跳过".to_string());
        }
    }
    if let Some(root) = setting
        .pointer("/extensions/root")
        .and_then(Value::as_str)
    {
        let root = root.trim();
        if !root.is_empty() {
            prefs.extension_root = root.to_string();
        }
    }
    if let Some(theme) = setting
        .pointer("/extensions/theme")
        .and_then(Value::as_str)
    {
        let theme = theme.trim();
        if !theme.is_empty() {
            prefs.theme = theme.to_string();
        }
    }
    if let Some(mode) = setting.pointer("/global/music").and_then(Value::as_u64) {
        prefs.music_mode = u8::try_from(mode).unwrap_or(0).min(2);
    }
}

fn clip(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
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
        key.to_ascii_lowercase().as_str(),
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

struct TempDir(PathBuf);

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
