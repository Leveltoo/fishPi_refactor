//! 写入普通桌面设置。
//!
//! Store 文件：`settings.json`。先读现有值，再按 `SettingsPatch` 字段 merge。
//! 只持久化 `AppSettings`；禁止写入 token / apiKey / password。
//! 不改窗口、托盘或系统通知。保存后重绑老板键；不在这里改透明度/置顶。
//! 先合并，再重绑，最后写入，避免新热键注册失败但设置已落盘。

use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::dto::{AppSettings, SettingsPatch};
use crate::error::AppError;

const STORE_FILE: &str = "settings.json";
const SETTINGS_KEY: &str = "settings";
static SETTINGS_IO: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// 前端 `invokeSettingsSet`：形参必须叫 `request`。
#[tauri::command(rename_all = "camelCase")]
pub async fn settings_set(app: AppHandle, request: SettingsPatch) -> Result<(), AppError> {
    let _io = SETTINGS_IO.lock().await;
    let store = app
        .store(STORE_FILE)
        .map_err(|_| AppError::business("读取设置失败"))?;
    let current = load_current(&store);
    let previous_hotkey = current.boss_hotkey().to_string();
    let next = request.apply(current).map_err(AppError::business)?;
    crate::boss_key::rebind(&app, next.boss_hotkey())?;
    if let Err(error) = persist(&store, &next) {
        let _ = crate::boss_key::rebind(&app, &previous_hotkey);
        return Err(error);
    }
    Ok(())
}

fn load_current<R: tauri::Runtime>(store: &tauri_plugin_store::Store<R>) -> AppSettings {
    if let Some(value) = store.get(SETTINGS_KEY) {
        if let Some(settings) = parse_settings(value) {
            return settings;
        }
    }
    let mut map = serde_json::Map::new();
    for (key, value) in store.entries() {
        if is_secret_key(&key) || key == SETTINGS_KEY {
            continue;
        }
        map.insert(key, value);
    }
    parse_settings(serde_json::Value::Object(map)).unwrap_or_default()
}

fn persist<R: tauri::Runtime>(
    store: &tauri_plugin_store::Store<R>,
    settings: &AppSettings,
) -> Result<(), AppError> {
    let value = serde_json::to_value(settings).map_err(|_| AppError::business("设置无法序列化"))?;
    let previous = store.entries();
    // Keep a complete wrapper visible while replacing legacy top-level fields.
    store.set(SETTINGS_KEY, value);
    for key in store.keys() {
        if key != SETTINGS_KEY {
            store.delete(key);
        }
    }
    if store.save().is_err() {
        store.clear();
        for (key, value) in previous {
            if !is_secret_key(&key) {
                store.set(key, value);
            }
        }
        return Err(AppError::business("保存设置失败"));
    }
    Ok(())
}

fn parse_settings(value: serde_json::Value) -> Option<AppSettings> {
    serde_json::from_value::<AppSettings>(strip_secrets(value))
        .ok()
        .map(AppSettings::sanitize)
}

fn strip_secrets(value: serde_json::Value) -> serde_json::Value {
    let serde_json::Value::Object(mut map) = value else {
        return value;
    };
    map.retain(|key, _| !is_secret_key(key));
    serde_json::Value::Object(map)
}

fn is_secret_key(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().as_str(),
        "token" | "apikey" | "api_key" | "api-key" | "password" | "mfa" | "mfacode"
    )
}
