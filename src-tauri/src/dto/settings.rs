//! 普通设置与窗口/通知 command 入参。禁止出现 token。

use serde::{Deserialize, Serialize};

/// 默认老板键。可在设置里改。对齐旧版 `hotkey.boss`。
pub const DEFAULT_BOSS_HOTKEY: &str = "Win+F2";

/// 透明度下限，与前端 `OPACITY_MIN` 对齐。Win32 分层窗口可到 10%。
pub const OPACITY_MIN: f64 = 0.1;
/// 透明度上限。
pub const OPACITY_MAX: f64 = 1.0;

/// 持久化的普通设置。不含凭据。
///
/// `hotkey` 与 `bossKey` 同步：计划字段是 hotkey，前端读 bossKey。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme_id: String,
    pub hotkey: String,
    pub boss_key: String,
    pub opacity: f64,
    /// 透明窗体开关。关则窗口不透明，开则用 `opacity`。
    #[serde(default)]
    pub opacity_enabled: bool,
    pub always_on_top: bool,
    /// 关闭到托盘。缺省关，对齐旧版关闭即退出。
    #[serde(default)]
    pub close_to_tray: bool,
    pub notify_enabled: bool,
    /// 聊天室新消息。缺省关，对齐旧版 `message.notice.chatroom`。
    #[serde(default)]
    pub notify_chatroom: bool,
    /// 私聊新消息。缺省关。
    #[serde(default)]
    pub notify_chat: bool,
    /// 提及了我。缺省关。
    #[serde(default)]
    pub notify_at: bool,
    /// 收到回复（含评论）。缺省关。
    #[serde(default)]
    pub notify_reply: bool,
    /// 系统公告。缺省关。
    #[serde(default)]
    pub notify_sys: bool,
    /// 聊天室关键词。缺省关。
    #[serde(default)]
    pub notify_talk: bool,
    /// 关键词正则，只当正则用，不当代码执行。空串对齐旧版 `new RegExp('')`，由前端匹配所有聊天室消息。
    #[serde(default)]
    pub notify_talk_pattern: String,
    /// 新消息声音。缺省关。
    #[serde(default)]
    pub notify_sound: bool,
    /// 系统消息这一提示方式。还要 `notify_enabled` 为真才会真正弹出。
    #[serde(default)]
    pub notify_system: bool,
    /// 登录后自动领取昨日活跃。缺省关。
    #[serde(default)]
    pub auto_reward: bool,
    /// 聊天室别人发红包时提醒。缺省关，对齐旧版 `chatroom.redpackNotice`。
    #[serde(default)]
    pub redpack_notice: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme_id: "default".to_string(),
            hotkey: DEFAULT_BOSS_HOTKEY.to_string(),
            boss_key: DEFAULT_BOSS_HOTKEY.to_string(),
            opacity: 1.0,
            opacity_enabled: false,
            always_on_top: false,
            close_to_tray: false,
            notify_enabled: false,
            notify_chatroom: false,
            notify_chat: false,
            notify_at: false,
            notify_reply: false,
            notify_sys: false,
            notify_talk: false,
            notify_talk_pattern: String::new(),
            notify_sound: false,
            notify_system: false,
            auto_reward: false,
            redpack_notice: false,
        }
    }
}

const TALK_PATTERN_MAX: usize = 200;

impl AppSettings {
    pub fn sanitize(mut self) -> Self {
        if self.theme_id.trim().is_empty() {
            self.theme_id = "default".to_string();
        }
        let hotkey = first_nonempty(&self.hotkey, &self.boss_key)
            .unwrap_or_else(|| DEFAULT_BOSS_HOTKEY.to_string());
        self.hotkey = hotkey.clone();
        self.boss_key = hotkey;
        self.opacity = self.opacity.clamp(OPACITY_MIN, OPACITY_MAX);
        self.notify_talk_pattern = clip_pattern(&self.notify_talk_pattern);
        self
    }

    pub fn boss_hotkey(&self) -> &str {
        if self.boss_key.trim().is_empty() {
            &self.hotkey
        } else {
            &self.boss_key
        }
    }
}

/// `settings_set` 入参。前端会提交完整设置；缺字段则保持原值。
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    #[serde(default)]
    pub theme_id: Option<String>,
    #[serde(default)]
    pub hotkey: Option<String>,
    #[serde(default)]
    pub boss_key: Option<String>,
    #[serde(default)]
    pub opacity: Option<f64>,
    #[serde(default)]
    pub opacity_enabled: Option<bool>,
    #[serde(default)]
    pub always_on_top: Option<bool>,
    #[serde(default)]
    pub close_to_tray: Option<bool>,
    #[serde(default)]
    pub notify_enabled: Option<bool>,
    #[serde(default)]
    pub notify_chatroom: Option<bool>,
    #[serde(default)]
    pub notify_chat: Option<bool>,
    #[serde(default)]
    pub notify_at: Option<bool>,
    #[serde(default)]
    pub notify_reply: Option<bool>,
    #[serde(default)]
    pub notify_sys: Option<bool>,
    #[serde(default)]
    pub notify_talk: Option<bool>,
    #[serde(default)]
    pub notify_talk_pattern: Option<String>,
    #[serde(default)]
    pub notify_sound: Option<bool>,
    #[serde(default)]
    pub notify_system: Option<bool>,
    #[serde(default)]
    pub auto_reward: Option<bool>,
    #[serde(default)]
    pub redpack_notice: Option<bool>,
}

impl SettingsPatch {
    pub fn apply(self, mut current: AppSettings) -> Result<AppSettings, String> {
        if let Some(theme_id) = self.theme_id {
            let theme_id = theme_id.trim();
            if theme_id.is_empty() {
                return Err("themeId 不能为空".to_string());
            }
            current.theme_id = theme_id.to_string();
        }
        let next_hotkey = self
            .hotkey
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| {
                self.boss_key
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            });
        if self.hotkey.as_deref().map(str::trim) == Some("")
            && self.boss_key.as_deref().map(str::trim) == Some("")
        {
            return Err("hotkey 不能为空".to_string());
        }
        if let Some(hotkey) = next_hotkey {
            current.hotkey = hotkey.clone();
            current.boss_key = hotkey;
        }
        if let Some(opacity) = self.opacity {
            if !(OPACITY_MIN..=OPACITY_MAX).contains(&opacity) {
                return Err("透明度必须在 0.1 到 1 之间".to_string());
            }
            current.opacity = opacity;
        }
        if let Some(opacity_enabled) = self.opacity_enabled {
            current.opacity_enabled = opacity_enabled;
        }
        if let Some(always_on_top) = self.always_on_top {
            current.always_on_top = always_on_top;
        }
        if let Some(close_to_tray) = self.close_to_tray {
            current.close_to_tray = close_to_tray;
        }
        if let Some(notify_enabled) = self.notify_enabled {
            current.notify_enabled = notify_enabled;
        }
        if let Some(notify_chatroom) = self.notify_chatroom {
            current.notify_chatroom = notify_chatroom;
        }
        if let Some(notify_chat) = self.notify_chat {
            current.notify_chat = notify_chat;
        }
        if let Some(notify_at) = self.notify_at {
            current.notify_at = notify_at;
        }
        if let Some(notify_reply) = self.notify_reply {
            current.notify_reply = notify_reply;
        }
        if let Some(notify_sys) = self.notify_sys {
            current.notify_sys = notify_sys;
        }
        if let Some(notify_talk) = self.notify_talk {
            current.notify_talk = notify_talk;
        }
        if let Some(notify_talk_pattern) = self.notify_talk_pattern {
            current.notify_talk_pattern = notify_talk_pattern;
        }
        if let Some(notify_sound) = self.notify_sound {
            current.notify_sound = notify_sound;
        }
        if let Some(notify_system) = self.notify_system {
            current.notify_system = notify_system;
        }
        if let Some(auto_reward) = self.auto_reward {
            current.auto_reward = auto_reward;
        }
        if let Some(redpack_notice) = self.redpack_notice {
            current.redpack_notice = redpack_notice;
        }
        Ok(current.sanitize())
    }
}

/// `window_set_always_on_top`。前端传 `on`，也接受 `alwaysOnTop`。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AlwaysOnTopRequest {
    #[serde(default)]
    pub always_on_top: Option<bool>,
    #[serde(default)]
    pub on: Option<bool>,
}

impl AlwaysOnTopRequest {
    pub fn value(&self) -> Result<bool, String> {
        self.always_on_top
            .or(self.on)
            .ok_or_else(|| "缺少 alwaysOnTop".to_string())
    }
}

/// `window_set_opacity`
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpacityRequest {
    pub opacity: f64,
}

/// `notify_show`。权限失败必须返回 business，不得假装已发。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotifyShowRequest {
    pub title: String,
    pub body: String,
}

fn clip_pattern(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() <= TALK_PATTERN_MAX {
        return trimmed.to_string();
    }
    let mut end = TALK_PATTERN_MAX;
    while !trimmed.is_char_boundary(end) {
        end -= 1;
    }
    trimmed[..end].to_string()
}

fn first_nonempty(left: &str, right: &str) -> Option<String> {
    let left = left.trim();
    if !left.is_empty() {
        return Some(left.to_string());
    }
    let right = right.trim();
    if right.is_empty() {
        None
    } else {
        Some(right.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn settings_camel_case() {
        let settings = AppSettings::default();
        let value = serde_json::to_value(&settings).expect("serialize");
        assert_eq!(value["themeId"], "default");
        assert_eq!(value["hotkey"], "Win+F2");
        assert_eq!(value["bossKey"], "Win+F2");
        assert_eq!(value["alwaysOnTop"], false);
        assert_eq!(value["closeToTray"], false);
        assert_eq!(value["opacityEnabled"], false);
        assert_eq!(value["notifyEnabled"], false);
        assert_eq!(value["notifyChatroom"], false);
        assert_eq!(value["notifyChat"], false);
        assert_eq!(value["notifyAt"], false);
        assert_eq!(value["notifyReply"], false);
        assert_eq!(value["notifySys"], false);
        assert_eq!(value["notifyTalk"], false);
        assert_eq!(value["notifyTalkPattern"], "");
        assert_eq!(value["notifySound"], false);
        assert_eq!(value["notifySystem"], false);
        assert_eq!(value["autoReward"], false);
        assert_eq!(value["redpackNotice"], false);
        assert!(value.get("token").is_none());
        assert!(value.get("apiKey").is_none());
    }

    #[test]
    fn legacy_settings_keep_new_flags_off() {
        let settings: AppSettings = serde_json::from_value(json!({
            "themeId": "default",
            "hotkey": "Win+F2",
            "bossKey": "Win+F2",
            "opacity": 1.0,
            "alwaysOnTop": false,
            "closeToTray": true,
            "notifyEnabled": true
        }))
        .expect("deserialize");
        assert!(settings.notify_enabled);
        assert!(!settings.auto_reward);
        assert!(!settings.redpack_notice);
        assert!(!settings.notify_chatroom);
        assert!(settings.notify_talk_pattern.is_empty());
    }

    #[test]
    fn patch_rejects_empty_hotkey() {
        let patch: SettingsPatch =
            serde_json::from_value(json!({ "hotkey": "   ", "bossKey": "  " })).expect("deserialize");
        let err = patch.apply(AppSettings::default()).unwrap_err();
        assert!(err.contains("hotkey"));
    }

    #[test]
    fn always_on_top_accepts_on() {
        let req: AlwaysOnTopRequest =
            serde_json::from_value(json!({ "on": true })).expect("deserialize");
        assert_eq!(req.value().expect("on"), true);
    }
}
