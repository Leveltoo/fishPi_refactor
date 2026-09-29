//! 聊天室消息 DTO。
//!
//! 历史 HTTP 与实时 WS 归一成同一形状，避免「实时是卡片、刷新后变原始 JSON」。
//! 天气 / 音乐带上消息里已有的字段，缺了就留空，前端退化成摘要，不编造。
//! 弹幕颜色只保留安全的 CSS 颜色。绝不把 `content` 对象当 HTML 交给前端。

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use fishpi_sdk::domain::chatroom::{
    BarragerMsg, ChatRoomContentKind, ChatRoomEvent, ChatRoomMsg, CustomMsg, MusicMsg,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 弹幕 / 进出场没有服务端 oId。每次事件生成新 ID，禁止用正文当稳定 ID，也不要拿去撤回。
static SYNTHETIC_SEQ: AtomicU64 = AtomicU64::new(1);

/// 消息类别。历史 `content.msgType` 与实时 `ChatRoomEvent` 变体都映射到这里。
///
/// 使用全小写，与计划中的 `msg | music | weather | redpacket | barrager | custom | unknown` 对齐。
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChatMessageKind {
    Msg,
    Music,
    Weather,
    Redpacket,
    Barrager,
    Custom,
    Unknown,
}

impl From<ChatRoomContentKind> for ChatMessageKind {
    fn from(kind: ChatRoomContentKind) -> Self {
        match kind {
            ChatRoomContentKind::Normal => Self::Msg,
            ChatRoomContentKind::Music => Self::Music,
            ChatRoomContentKind::Weather => Self::Weather,
            ChatRoomContentKind::RedPacket => Self::Redpacket,
        }
    }
}

/// 天气卡片的一天。空字符串表示该字段在 payload 里不存在，不是 0 度。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WeatherDayDto {
    pub date: String,
    pub max_temp: String,
    pub min_temp: String,
    pub code: String,
}

/// 天气卡片。只拷贝消息里已有的 `t` / `st` / `date` / `max` / `min` / `weatherCode`。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WeatherCardDto {
    pub area: String,
    pub summary: String,
    pub days: Vec<WeatherDayDto>,
}

/// 音乐卡片。`audioUrl` 仅在 `source` 能解析出网易云 `id=` 时给出，地址与旧客户端相同。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MusicCardDto {
    pub title: String,
    pub source: String,
    pub cover_url: String,
    pub from: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_url: Option<String>,
}

/// 红包领取人。头像只保留公开 HTTP(S) URL，缺了就空字符串，不编造。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RedpacketWhoDto {
    pub user_name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub user_id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub avatar: String,
}

/// 聊天室消息里的红包卡片。字段来自 SDK `ChatRoomMsg.content`，缺了就空/0。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RedpacketCardDto {
    /// `random` / `average` / `specify` / `heartbeat` / `rockPaperScissors`。未知类型保持原字符串。
    #[serde(rename = "type")]
    pub packet_type: String,
    pub msg: String,
    pub money: u64,
    pub got: u64,
    pub count: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recivers: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub who: Vec<RedpacketWhoDto>,
}

/// 一条聊天室消息（历史与实时同一形状）。
///
/// `id` 用字符串：服务端 `oId` 是雪花数字串，前端 `number` 会丢精度，撤回/去重必须对得上。
/// `md` 是 Markdown 原文（复制 / 回复 / 复读）；`text` 在 Html 模式下是服务端 HTML。
/// `rawHint` 是特殊消息的纯文本摘要，不是原始 JSON。
/// 新增字段都有 `serde(default)`，旧消息缺这些键时仍能反序列化。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageDto {
    pub id: String,
    pub kind: ChatMessageKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub md: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    pub user_name: String,
    pub user_nickname: String,
    pub user_avatar_url: String,
    pub time: String,
    pub revoked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_hint: Option<String>,
    /// 发言来源客户端，例如 `Web`、`Android`。SDK 把空 client 填成 `Other`，这里不把占位符传出去。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub via_client: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub via_version: Option<String>,
    /// 弹幕颜色。只接受安全 CSS 颜色，拒绝 `url(` / `expression`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weather: Option<WeatherCardDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub music: Option<MusicCardDto>,
    /// 红包卡片。历史 `content` 里的 got/count/money/who 原样映射，不只压成 rawHint。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redpacket: Option<RedpacketCardDto>,
}

impl ChatMessageDto {
    /// 将一页历史 `ChatRoomMsg` 映射为前端消息列表。
    pub fn from_history(messages: Vec<ChatRoomMsg>) -> Vec<Self> {
        messages.into_iter().map(Self::from).collect()
    }

    /// 实时事件里只有消息类变体能变成聊天行；在线/话题/撤回/红包状态/表态返回 `None`。
    pub fn from_event(event: ChatRoomEvent) -> Option<Self> {
        match event {
            ChatRoomEvent::Msg(msg)
            | ChatRoomEvent::RedPacket(msg)
            | ChatRoomEvent::Weather(msg) => Some(Self::from(msg)),
            ChatRoomEvent::Music(msg) => Some(Self::from(msg)),
            ChatRoomEvent::Barrager(msg) => Some(Self::from(msg)),
            ChatRoomEvent::Custom(msg) => Some(Self::from(msg)),
            ChatRoomEvent::Online { .. }
            | ChatRoomEvent::DiscussChanged(_)
            | ChatRoomEvent::Revoke(_)
            | ChatRoomEvent::RedPacketStatus(_)
            | ChatRoomEvent::ChatReaction(_) => None,
        }
    }

    /// 无法识别的载荷占位，保证消息流不因未知 type 崩溃。
    pub fn unknown(raw_hint: impl Into<String>) -> Self {
        Self {
            id: String::new(),
            kind: ChatMessageKind::Unknown,
            md: None,
            text: None,
            user_name: String::new(),
            user_nickname: String::new(),
            user_avatar_url: String::new(),
            time: String::new(),
            revoked: false,
            raw_hint: Some(raw_hint.into()),
            via_client: None,
            via_version: None,
            color: None,
            weather: None,
            music: None,
            redpacket: None,
        }
    }
}

impl From<&ChatRoomMsg> for ChatMessageDto {
    fn from(msg: &ChatRoomMsg) -> Self {
        let kind = classify_chat_msg(msg);
        let (md, text, raw_hint, weather, music, redpacket) = match kind {
            ChatMessageKind::Msg => {
                let (md, text, hint) = normal_body(msg);
                (md, text, hint, None, None, None)
            }
            ChatMessageKind::Music => (
                None,
                None,
                Some(music_hint(&msg.content)),
                None,
                music_card_from_content(&msg.content),
                None,
            ),
            ChatMessageKind::Weather => (
                None,
                None,
                Some(weather_hint(&msg.content)),
                weather_card(&msg.content),
                None,
                None,
            ),
            ChatMessageKind::Redpacket => (
                None,
                None,
                Some(redpacket_hint(&msg.content)),
                None,
                None,
                redpacket_card(&msg.content),
            ),
            ChatMessageKind::Unknown
            | ChatMessageKind::Barrager
            | ChatMessageKind::Custom => (None, None, Some(unknown_hint()), None, None, None),
        };
        let (via_client, via_version) = via_parts(&msg.client);

        Self {
            id: msg.id.clone(),
            kind,
            md,
            text,
            user_name: msg.user_name.clone(),
            user_nickname: msg.user_nickname.clone(),
            user_avatar_url: msg.user_avatar_url.clone(),
            time: msg.time.clone(),
            revoked: false,
            raw_hint,
            via_client,
            via_version,
            color: None,
            weather,
            music,
            redpacket,
        }
    }
}

impl From<ChatRoomMsg> for ChatMessageDto {
    fn from(msg: ChatRoomMsg) -> Self {
        Self::from(&msg)
    }
}

impl From<&MusicMsg> for ChatMessageDto {
    fn from(msg: &MusicMsg) -> Self {
        let mut dto = ChatMessageDto::from(&msg.base);
        dto.kind = ChatMessageKind::Music;
        dto.md = None;
        dto.text = None;
        dto.raw_hint = Some(music_title_hint(&msg.title));
        dto.weather = None;
        dto.music = music_card(&msg.title, &msg.source, &msg.cover_url, &msg.from);
        dto.redpacket = None;
        dto
    }
}

impl From<MusicMsg> for ChatMessageDto {
    fn from(msg: MusicMsg) -> Self {
        Self::from(&msg)
    }
}

impl From<&BarragerMsg> for ChatMessageDto {
    fn from(msg: &BarragerMsg) -> Self {
        Self {
            // 弹幕没有服务端 oId；此前缀 ID 仅供前端 key，不能拿去 revoke。
            id: unique_client_id("barrager"),
            kind: ChatMessageKind::Barrager,
            md: None,
            text: nonempty(&msg.barrager_content),
            user_name: msg.user_name.clone(),
            user_nickname: msg.user_nickname.clone(),
            user_avatar_url: msg.user_avatar_url.clone(),
            time: String::new(),
            revoked: false,
            raw_hint: None,
            via_client: None,
            via_version: None,
            color: safe_css_color(&msg.barrager_color),
            weather: None,
            music: None,
            redpacket: None,
        }
    }
}

impl From<BarragerMsg> for ChatMessageDto {
    fn from(msg: BarragerMsg) -> Self {
        Self::from(&msg)
    }
}

impl From<&CustomMsg> for ChatMessageDto {
    fn from(msg: &CustomMsg) -> Self {
        Self {
            id: unique_client_id("custom"),
            kind: ChatMessageKind::Custom,
            md: None,
            text: nonempty(&msg.message),
            user_name: String::new(),
            user_nickname: String::new(),
            user_avatar_url: String::new(),
            time: String::new(),
            revoked: false,
            raw_hint: None,
            via_client: None,
            via_version: None,
            color: None,
            weather: None,
            music: None,
            redpacket: None,
        }
    }
}

impl From<CustomMsg> for ChatMessageDto {
    fn from(msg: CustomMsg) -> Self {
        Self::from(&msg)
    }
}

fn classify_chat_msg(msg: &ChatRoomMsg) -> ChatMessageKind {
    match msg.content_kind() {
        ChatRoomContentKind::Music => ChatMessageKind::Music,
        ChatRoomContentKind::Weather => ChatMessageKind::Weather,
        ChatRoomContentKind::RedPacket => ChatMessageKind::Redpacket,
        ChatRoomContentKind::Normal => match &msg.content {
            Value::String(_) | Value::Null => ChatMessageKind::Msg,
            _ => ChatMessageKind::Unknown,
        },
    }
}

fn normal_body(msg: &ChatRoomMsg) -> (Option<String>, Option<String>, Option<String>) {
    let md = nonempty(&msg.md);
    // `type=Html` 时 content 是服务端 HTML；md 仍是 Markdown。两者都保留：
    // 展示走 HTML，复制 / 回复 / 复读走 md。
    let text = match &msg.content {
        Value::String(s) => nonempty(s),
        _ => None,
    };
    (md, text, None)
}

fn music_hint(content: &Value) -> String {
    music_title_hint(json_str(content, &["title"]).unwrap_or_default())
}

fn music_title_hint(title: &str) -> String {
    match nonempty(title) {
        Some(title) => format!("【音乐】{title}"),
        None => "【音乐】".to_string(),
    }
}

fn music_card_from_content(content: &Value) -> Option<MusicCardDto> {
    music_card(
        json_str(content, &["title"]).unwrap_or_default(),
        json_str(content, &["source"]).unwrap_or_default(),
        json_str(content, &["coverURL", "coverUrl"]).unwrap_or_default(),
        json_str(content, &["from"]).unwrap_or_default(),
    )
}

fn music_card(title: &str, source: &str, cover: &str, from: &str) -> Option<MusicCardDto> {
    let title = title.trim().to_string();
    let source = source.trim().to_string();
    let cover_url = public_http_url(cover).unwrap_or_default();
    let from = from.trim().to_string();
    let audio_url = netease_audio_url(&source);
    if title.is_empty() && source.is_empty() && cover_url.is_empty() && audio_url.is_none() {
        return None;
    }
    Some(MusicCardDto {
        title,
        source,
        cover_url,
        from,
        audio_url,
    })
}

/// 旧客户端 `source.match(/id=(\\d+)/)`，音频地址同样是 outer url。
fn netease_audio_url(source: &str) -> Option<String> {
    let marker = "id=";
    let mut rest = source;
    while let Some(index) = rest.find(marker) {
        let after = &rest[index + marker.len()..];
        let id: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
        if (1..=20).contains(&id.len()) {
            return Some(format!(
                "http://music.163.com/song/media/outer/url?id={id}"
            ));
        }
        rest = &rest[index + marker.len()..];
    }
    None
}

fn weather_hint(content: &Value) -> String {
    let area = json_str(content, &["t", "city"]);
    let desc = json_str(content, &["st", "describe", "description"]);
    match (area, desc) {
        (Some(area), Some(desc)) => format!("【天气】{area} {desc}"),
        (Some(area), None) => format!("【天气】{area}"),
        (None, Some(desc)) => format!("【天气】{desc}"),
        (None, None) => "【天气】".to_string(),
    }
}

fn weather_card(content: &Value) -> Option<WeatherCardDto> {
    let area = json_str(content, &["t", "city"]).unwrap_or("").to_string();
    let summary = json_str(content, &["st", "describe", "description"])
        .unwrap_or("")
        .to_string();
    let dates = csv_field(content, "date");
    let maxes = csv_field(content, "max");
    let mins = csv_field(content, "min");
    let codes = csv_field(content, "weatherCode");
    let len = dates
        .len()
        .max(maxes.len())
        .max(mins.len())
        .max(codes.len());
    let mut days = Vec::new();
    for index in 0..len {
        let day = WeatherDayDto {
            date: dates.get(index).cloned().unwrap_or_default(),
            max_temp: maxes.get(index).cloned().unwrap_or_default(),
            min_temp: mins.get(index).cloned().unwrap_or_default(),
            code: codes
                .get(index)
                .map(|code| weather_code(code))
                .unwrap_or_default(),
        };
        if day.date.is_empty()
            && day.max_temp.is_empty()
            && day.min_temp.is_empty()
            && day.code.is_empty()
        {
            continue;
        }
        days.push(day);
    }
    if area.is_empty() && summary.is_empty() && days.is_empty() {
        return None;
    }
    Some(WeatherCardDto {
        area,
        summary,
        days,
    })
}

fn weather_code(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 40 {
        return String::new();
    }
    if trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
    {
        trimmed.to_string()
    } else {
        String::new()
    }
}

fn csv_field(content: &Value, key: &str) -> Vec<String> {
    match json_str(content, &[key]) {
        Some(value) => value.split(',').map(|part| part.trim().to_string()).collect(),
        None => Vec::new(),
    }
}

fn redpacket_hint(content: &Value) -> String {
    let type_name = match json_str(content, &["type"]).unwrap_or_default() {
        "random" => "拼手气红包",
        "average" => "平分红包",
        "specify" => "专属红包",
        "heartbeat" => "心跳红包",
        "rockPaperScissors" => "猜拳红包",
        _ => "红包",
    };
    let got = json_u64(content, "got");
    let count = json_u64(content, "count");
    let mut hint = format!("【{type_name}】已领 {got}/{count}");
    if let Some(bless) = json_str(content, &["msg", "message"]) {
        hint.push(' ');
        hint.push_str(&truncate_chars(bless, 32));
    }
    hint
}

/// 从历史/实时 `content` 抽出红包卡片。who 只拷贝已有 userName/avatar，不查在线列表。
fn redpacket_card(content: &Value) -> Option<RedpacketCardDto> {
    if !content.is_object() {
        return Some(RedpacketCardDto::default());
    }
    Some(RedpacketCardDto {
        packet_type: json_str(content, &["type"]).unwrap_or("").to_string(),
        msg: json_str(content, &["msg", "message"])
            .unwrap_or("")
            .to_string(),
        money: json_u64(content, "money"),
        got: json_u64(content, "got"),
        count: json_u64(content, "count"),
        recivers: json_string_vec(content, &["recivers", "receivers"]),
        who: redpacket_who(content),
    })
}

fn redpacket_who(content: &Value) -> Vec<RedpacketWhoDto> {
    let Some(items) = content.get("who").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut who = Vec::new();
    for item in items {
        let user_name = json_str(item, &["userName", "user_name"])
            .unwrap_or("")
            .to_string();
        if user_name.is_empty() {
            continue;
        }
        let user_id = json_str(item, &["userId", "user_id"])
            .unwrap_or("")
            .to_string();
        let avatar = json_str(item, &["avatar", "userAvatarUrl", "userAvatarURL"])
            .and_then(public_http_url)
            .unwrap_or_default();
        who.push(RedpacketWhoDto {
            user_name,
            user_id,
            avatar,
        });
    }
    who
}

fn json_string_vec(content: &Value, keys: &[&str]) -> Vec<String> {
    for key in keys {
        let Some(value) = content.get(*key) else {
            continue;
        };
        match value {
            Value::Array(items) => {
                return items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                    .map(ToString::to_string)
                    .collect();
            }
            Value::String(text) => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    return Vec::new();
                }
                if trimmed.starts_with('[') {
                    if let Ok(Value::Array(items)) = serde_json::from_str::<Value>(trimmed) {
                        return items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::trim)
                            .filter(|t| !t.is_empty())
                            .map(ToString::to_string)
                            .collect();
                    }
                }
                return vec![trimmed.to_string()];
            }
            _ => {}
        }
    }
    Vec::new()
}

fn unknown_hint() -> String {
    "暂不支持的消息类型".to_string()
}

/// 弹幕/进出场没有服务端 oId。时间戳 + 序号保证同人同文也能进窗，且不会撞上可撤回的数字 oId。
fn unique_client_id(kind: &str) -> String {
    let seq = SYNTHETIC_SEQ.fetch_add(1, Ordering::Relaxed);
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("{kind}:{millis}:{seq}")
}

/// `Windows/1.2.3` 拆成客户端和版本。空值和 SDK 的 `Other` 占位不展示。
fn via_parts(client: &str) -> (Option<String>, Option<String>) {
    let trimmed = client.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("Other") {
        return (None, None);
    }
    match trimmed.split_once('/') {
        Some((name, version)) => (
            nonempty(name).filter(|value| value.chars().count() <= 32),
            nonempty(version).filter(|value| value.chars().count() <= 32),
        ),
        None => (nonempty(trimmed).filter(|value| value.chars().count() <= 32), None),
    }
}

fn nonempty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn json_str<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|text| !text.is_empty())
}

fn json_u64(value: &Value, key: &str) -> u64 {
    let Some(raw) = value.get(key) else {
        return 0;
    };
    if let Some(n) = raw.as_u64() {
        return n;
    }
    if let Some(n) = raw.as_i64() {
        return n.max(0) as u64;
    }
    if let Some(text) = raw.as_str() {
        return text.trim().parse().unwrap_or(0);
    }
    0
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let taken: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{taken}…")
    } else {
        taken
    }
}

pub(crate) fn public_http_url(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return None;
    }
    if trimmed
        .chars()
        .any(|ch| ch.is_whitespace() || matches!(ch, '<' | '>' | '"' | '\''))
    {
        return None;
    }
    let rest = trimmed.split_once("://")?.1;
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if host.is_empty() || host.contains('@') {
        return None;
    }
    Some(trimmed.to_string())
}

/// 弹幕颜色：十六进制、rgb/hsl，或纯字母颜色名。拒绝 `url` / `expression` 和引号。
pub(crate) fn safe_css_color(raw: &str) -> Option<String> {
    let value = raw.trim();
    if value.is_empty() || value.chars().count() > 64 {
        return None;
    }
    let lower = value.to_ascii_lowercase();
    if lower.contains("url")
        || lower.contains("expression")
        || lower.contains('\\')
        || lower.contains('@')
        || lower.contains(';')
        || lower.contains('{')
        || lower.contains('}')
        || lower.contains('<')
        || lower.contains('>')
        || lower.contains('"')
        || lower.contains('\'')
        || lower.contains("/*")
    {
        return None;
    }
    if is_hex_color(&lower) || is_functional_color(&lower) || is_named_color(&lower) {
        Some(lower)
    } else {
        None
    }
}

fn is_hex_color(value: &str) -> bool {
    let Some(digits) = value.strip_prefix('#') else {
        return false;
    };
    matches!(digits.len(), 3 | 4 | 6 | 8) && digits.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn is_functional_color(value: &str) -> bool {
    let Some((head, rest)) = value.split_once('(') else {
        return false;
    };
    if !matches!(head, "rgb" | "rgba" | "hsl" | "hsla") {
        return false;
    }
    if !rest.ends_with(')') || rest.contains('(') {
        return false;
    }
    rest.chars()
        .all(|ch| ch.is_ascii_digit() || matches!(ch, ' ' | ',' | '.' | '%' | '/' | ')'))
}

fn is_named_color(value: &str) -> bool {
    (3..=20).contains(&value.len()) && value.chars().all(|ch| ch.is_ascii_alphabetic())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn redpacket_card_maps_got_count_money_who() {
        let content = json!({
            "msgType": "redPacket",
            "type": "random",
            "msg": "摸鱼者，事竟成！",
            "money": 32,
            "got": 2,
            "count": 3,
            "recivers": [],
            "who": [
                {
                    "userName": "alice",
                    "userId": "1",
                    "avatar": "https://example.com/a.png"
                },
                {
                    "userName": "bob",
                    "avatar": "javascript:alert(1)"
                }
            ]
        });
        let card = redpacket_card(&content).expect("card");
        assert_eq!(card.packet_type, "random");
        assert_eq!(card.msg, "摸鱼者，事竟成！");
        assert_eq!(card.money, 32);
        assert_eq!(card.got, 2);
        assert_eq!(card.count, 3);
        assert_eq!(card.who.len(), 2);
        assert_eq!(card.who[0].user_name, "alice");
        assert_eq!(card.who[0].avatar, "https://example.com/a.png");
        assert_eq!(card.who[1].user_name, "bob");
        assert_eq!(card.who[1].avatar, "");
    }

    #[test]
    fn redpacket_card_serializes_type_not_packet_type() {
        let card = RedpacketCardDto {
            packet_type: "specify".into(),
            msg: "给你".into(),
            money: 16,
            got: 0,
            count: 1,
            recivers: vec!["carol".into()],
            who: Vec::new(),
        };
        let value = serde_json::to_value(&card).expect("serialize");
        assert_eq!(value["type"], "specify");
        assert_eq!(value["msg"], "给你");
        assert_eq!(value["money"], 16);
        assert_eq!(value["recivers"][0], "carol");
        assert!(value.get("packetType").is_none());
    }

    fn sample_barrager(content: &str) -> BarragerMsg {
        BarragerMsg {
            user_name: "alice".into(),
            user_nickname: "Alice".into(),
            barrager_content: content.into(),
            barrager_color: "#fff".into(),
            user_avatar_url: String::new(),
            user_avatar_url20: String::new(),
            user_avatar_url48: String::new(),
            user_avatar_url210: String::new(),
        }
    }

    #[test]
    fn barrager_ids_are_unique_for_same_content() {
        let msg = sample_barrager("摸鱼");
        let first = ChatMessageDto::from(&msg);
        let second = ChatMessageDto::from(&msg);
        assert_ne!(first.id, second.id);
        assert!(first.id.starts_with("barrager:"));
        assert!(second.id.starts_with("barrager:"));
        assert_ne!(first.id, format!("barrager:{}:{}", msg.user_name, msg.barrager_content));
        assert!(!first.id.chars().all(|ch| ch.is_ascii_digit()));
    }

    #[test]
    fn custom_ids_are_unique_for_same_content() {
        let msg = CustomMsg {
            message: "进入了聊天室".into(),
        };
        let first = ChatMessageDto::from(&msg);
        let second = ChatMessageDto::from(&msg);
        assert_ne!(first.id, second.id);
        assert!(first.id.starts_with("custom:"));
        assert_ne!(first.id, format!("custom:{}", msg.message));
        assert!(!first.id.chars().all(|ch| ch.is_ascii_digit()));
    }
}
