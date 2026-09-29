//! 摸鱼派桌面端 Bridge。
//!
//! React 只通过 invoke / listen 访问本层；社区 HTTP / WS 仅由 Rust 调 `fishpi-sdk`。
//! `AppState` 只在读或切换共享状态时持锁，持锁时绝不 `.await` 网络。
//! token 不进入 DTO、事件或前端，也不进入 Store。

mod commands;
pub mod credentials;
pub mod dto;
pub mod error;
mod realtime;
pub mod state;
mod text;
mod tray;
mod window_close;
mod window_persist;
mod boss_key;

use commands::{
    article_detail, article_list, auth_login, auth_logout, auth_me, auth_restore, breezemoon_list,
    breezemoon_send, chat_connect, chat_disconnect, chat_history, chat_list, chat_mark_read,
    chat_revoke, chat_send, chat_unread, chatroom_connect, chatroom_disconnect, chatroom_history,
    chatroom_raw, chatroom_revoke, chatroom_send, comment_delete, comment_post, comment_thank,
    comment_vote,
    notice_connect, notice_count, notice_list,
    notice_make_read, notice_read_all, notify_show, redpacket_open, settings_get, settings_set,
    user_checkin, user_is_checkin, user_is_collected_liveness, user_liveness, user_profile,
    user_reward_liveness, user_search, window_set_always_on_top, window_set_opacity,
    article_thank, article_vote, article_reward, article_heat, article_heat_watch,
    article_heat_close,
    chatroom_barrager, chatroom_barrage_cost, chatroom_filters_get, chatroom_filters_set, chatroom_emoji_recent_get,
    chatroom_emoji_recent_remember, emoji_groups, emoji_group_items, emoji_add_url, emoji_remove,
    fetch_image, file_upload,
    update_check, update_apply, update_open_release,
    config_import, desktop_prefs_get, desktop_prefs_set,
    reconnect_watch, reconnect_now,
    extension_scan, extension_load_theme, extension_call,
    offline_load, offline_merge, offline_fail_send,
    music_resolve,
};
use dto::{AlwaysOnTopRequest, AppSettings, OpacityRequest};
use state::AppState;
use tauri_plugin_store::StoreExt;

/// 与 `settings_get` / `settings_set` 同一文件。只存普通设置，不含凭据。
const SETTINGS_STORE_FILE: &str = "settings.json";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            auth_login,
            auth_restore,
            auth_logout,
            auth_me,
            chatroom_connect,
            chatroom_disconnect,
            chatroom_send,
            chatroom_history,
            chatroom_raw,
            chatroom_revoke,
            file_upload,
            redpacket_open,
            chat_list,
            chat_unread,
            chat_history,
            chat_send,
            chat_mark_read,
            chat_connect,
            chat_disconnect,
            chat_revoke,
            notice_count,
            notice_list,
            notice_make_read,
            notice_read_all,
            notice_connect,
            user_search,
            user_profile,
            user_liveness,
            user_is_checkin,
            user_checkin,
            user_is_collected_liveness,
            user_reward_liveness,
            article_list,
            article_detail,
            comment_post,
            comment_delete,
            comment_thank,
            comment_vote,
            breezemoon_list,
            breezemoon_send,
            window_set_always_on_top,
            window_set_opacity,
            settings_get,
            settings_set,
            notify_show,
            article_thank,
            article_vote,
            article_reward,
            article_heat,
            article_heat_watch,
            article_heat_close,
            chatroom_barrager,
            chatroom_barrage_cost,
            chatroom_filters_get,
            chatroom_filters_set,
            chatroom_emoji_recent_get,
            chatroom_emoji_recent_remember,
            emoji_groups,
            emoji_group_items,
            emoji_add_url,
            emoji_remove,
            fetch_image,
            update_check,
            update_apply,
            update_open_release,
            config_import,
            desktop_prefs_get,
            desktop_prefs_set,
            reconnect_watch,
            reconnect_now,
            extension_scan,
            extension_load_theme,
            extension_call,
            offline_load,
            offline_merge,
            offline_fail_send,
            music_resolve,
            tray::tray_flash,
        ])
        .setup(|app| {
            apply_cold_start_window_appearance(app);
            // 冷启动会装托盘、关闭拦截、窗口尺寸和老板键。安装失败不阻止应用启动。
            let _ = tray::install(app);
            window_close::install(app);
            window_persist::install(app);
            let _ = boss_key::install(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 冷启动把上次的置顶 / 透明度套到 label `main`。读失败用默认值，不 panic。
/// 托盘、关闭拦截和老板键在 `run` 的 setup 里安装。
fn apply_cold_start_window_appearance(app: &tauri::App) {
    let settings = load_startup_settings(app);
    let handle = app.handle().clone();
    let _ = window_set_always_on_top(
        handle.clone(),
        AlwaysOnTopRequest {
            always_on_top: Some(settings.always_on_top),
            on: None,
        },
    );
    let opacity = if settings.opacity_enabled {
        settings.opacity
    } else {
        1.0
    };
    let _ = window_set_opacity(handle, OpacityRequest { opacity });
}

fn load_startup_settings(app: &tauri::App) -> AppSettings {
    let Ok(store) = app.store(SETTINGS_STORE_FILE) else {
        return AppSettings::default();
    };

    let nested = store.get("settings").or_else(|| store.get("value"));
    let raw = match nested {
        Some(value) if value.is_object() => value,
        _ => {
            let mut map = serde_json::Map::new();
            for (key, value) in store.entries() {
                if is_forbidden_store_key(&key) {
                    continue;
                }
                map.insert(key, value);
            }
            serde_json::Value::Object(map)
        }
    };

    parse_app_settings(raw)
}

fn parse_app_settings(mut raw: serde_json::Value) -> AppSettings {
    if let Some(obj) = raw.as_object_mut() {
        obj.retain(|key, _| !is_forbidden_store_key(key));
    }
    serde_json::from_value::<AppSettings>(raw)
        .map(AppSettings::sanitize)
        .unwrap_or_default()
}

fn is_forbidden_store_key(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().replace('-', "_").as_str(),
        "token" | "apikey" | "api_key" | "password" | "passwd" | "pwd" | "mfa" | "mfacode"
    )
}
