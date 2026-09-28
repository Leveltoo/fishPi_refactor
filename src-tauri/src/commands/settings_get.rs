//! 读取普通设置。不改窗口、不返回凭据。
//!
//! Store 文件是 `settings.json`（`BaseDirectory::AppData`）。没有文件或为空时返回
//! [`AppSettings::default`]。读到的值经过 [`AppSettings::sanitize`]。
//! token / apiKey / password / mfa 即使出现在 Store 里也会丢掉，不进入返回值。

use serde_json::{Map, Value};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::{Store, StoreExt};

use crate::dto::AppSettings;
use crate::error::AppError;

/// 与 `settings_set`、冷启动共用的 Store 相对路径。
pub const SETTINGS_STORE_FILE: &str = "settings.json";

/// 从 `settings.json` 读出已消毒的 [`AppSettings`]。供 command 与冷启动共用。
pub fn load_app_settings(app: &AppHandle) -> Result<AppSettings, AppError> {
    let store = app
        .store(SETTINGS_STORE_FILE)
        .map_err(|_| AppError::business("读取设置失败"))?;

    drop_forbidden_keys(store.as_ref());

    if store.is_empty() {
        return Ok(AppSettings::default());
    }

    let mut raw = Map::new();
    for (key, value) in store.entries() {
        if is_forbidden_key(&key) {
            continue;
        }
        raw.insert(key, value);
    }

    if raw.is_empty() {
        return Ok(AppSettings::default());
    }

    Ok(settings_from_store(Value::Object(raw)))
}

/// 无业务入参。返回 camelCase 的 [`AppSettings`]。
#[tauri::command(rename_all = "camelCase")]
pub fn settings_get(app: AppHandle) -> Result<AppSettings, AppError> {
    load_app_settings(&app)
}

fn drop_forbidden_keys<R: Runtime>(store: &Store<R>) {
    let mut dirty = false;
    for key in store.keys() {
        if is_forbidden_key(&key) {
            dirty |= store.delete(&key);
            continue;
        }
        if !is_wrapper_key(&key) {
            continue;
        }
        let Some(Value::Object(mut obj)) = store.get(&key) else {
            continue;
        };
        let before = obj.len();
        obj.retain(|nested, _| !is_forbidden_key(nested));
        if obj.len() != before {
            store.set(key, Value::Object(obj));
            dirty = true;
        }
    }
    if dirty {
        let _ = store.save();
    }
}

fn settings_from_store(raw: Value) -> AppSettings {
    let overlay = unwrap_settings_object(raw);
    let mut merged = match serde_json::to_value(AppSettings::default()) {
        Ok(value) => value,
        Err(_) => return AppSettings::default(),
    };
    if let (Value::Object(base), Value::Object(overlay)) = (&mut merged, overlay) {
        for (key, value) in overlay {
            if is_forbidden_key(&key) || value.is_null() {
                continue;
            }
            base.insert(key, value);
        }
    }
    serde_json::from_value::<AppSettings>(merged)
        .unwrap_or_default()
        .sanitize()
}

fn unwrap_settings_object(value: Value) -> Value {
    let Value::Object(mut map) = value else {
        return Value::Object(Map::new());
    };
    for wrapper in ["settings", "value"] {
        if let Some(nested) = map.remove(wrapper) {
            if nested.is_object() {
                return nested;
            }
        }
    }
    Value::Object(map)
}

fn is_wrapper_key(key: &str) -> bool {
    key == "settings" || key == "value"
}

fn is_forbidden_key(key: &str) -> bool {
    let mut normalized = String::with_capacity(key.len());
    for ch in key.chars() {
        if ch == '_' || ch == '-' {
            continue;
        }
        normalized.extend(ch.to_lowercase());
    }
    matches!(
        normalized.as_str(),
        "token" | "apikey" | "password" | "passwd" | "pwd" | "mfa" | "mfacode"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_fields_use_default_then_sanitize() {
        let settings = settings_from_store(json!({ "themeId": "  ", "opacity": 0.1 }));
        assert_eq!(settings.theme_id, "default");
        assert_eq!(settings.opacity, 0.3);
        assert_eq!(settings.close_to_tray, true);
        assert_eq!(settings.hotkey, settings.boss_key);
    }

    #[test]
    fn strips_credentials_from_payload() {
        let settings = settings_from_store(json!({
            "themeId": "daybreak",
            "token": "secret-token",
            "apiKey": "secret-key",
            "password": "hunter2",
            "mfa": "123456",
        }));
        let value = serde_json::to_value(&settings).expect("serialize");
        assert_eq!(value["themeId"], "daybreak");
        assert!(value.get("token").is_none());
        assert!(value.get("apiKey").is_none());
        assert!(value.get("password").is_none());
        assert!(value.get("mfa").is_none());
    }

    #[test]
    fn forbidden_key_aliases() {
        assert!(is_forbidden_key("api_key"));
        assert!(is_forbidden_key("api-key"));
        assert!(is_forbidden_key("mfaCode"));
        assert!(!is_forbidden_key("themeId"));
        assert!(!is_forbidden_key("hotkey"));
    }

    #[test]
    fn nested_settings_object() {
        let settings = settings_from_store(json!({
            "settings": { "alwaysOnTop": true, "token": "nope" }
        }));
        assert!(settings.always_on_top);
        let value = serde_json::to_value(&settings).expect("serialize");
        assert!(value.get("token").is_none());
    }
}
