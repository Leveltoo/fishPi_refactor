//! 开红包 IPC DTO。SDK domain 不直接 Serialize，这里只映射前端要用的字段。

use fishpi_sdk::domain::redpacket::{GestureType, RedPacketGot, RedPacketInfo};
use serde::{Deserialize, Serialize};

/// `redpacket_open` 入参。`oId` 是聊天室消息 ID 字符串，禁止用 JS number。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenRedPacketRequest {
    pub o_id: String,
    #[serde(default)]
    pub gesture: Option<u8>,
}

/// 开红包结果。形状对齐前端 `RedPacketInfo` / Android `redpacket_info_to_json`。
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RedPacketInfoDto {
    pub session_generation: u64,
    pub info: RedPacketBaseDto,
    pub receivers: Vec<String>,
    pub who: Vec<RedPacketGotDto>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RedPacketBaseDto {
    pub count: u32,
    pub got: u32,
    pub message: String,
    pub user_name: String,
    pub user_avatar_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gesture: Option<u8>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RedPacketGotDto {
    pub user_id: String,
    pub user_name: String,
    pub avatar: String,
    pub user_money: i32,
    pub time: String,
}

impl RedPacketInfoDto {
    pub fn from_sdk(session_generation: u64, info: RedPacketInfo) -> Self {
        Self {
            session_generation,
            info: RedPacketBaseDto {
                count: info.info.count,
                got: info.info.got,
                message: info.info.message,
                user_name: info.info.user_name,
                user_avatar_url: info.info.user_avatar_url,
                gesture: info.info.gesture.map(|g| g as u8),
            },
            receivers: info.receivers,
            who: info.who.into_iter().map(RedPacketGotDto::from).collect(),
        }
    }
}

impl From<RedPacketGot> for RedPacketGotDto {
    fn from(got: RedPacketGot) -> Self {
        Self {
            user_id: got.user_id.to_string(),
            user_name: got.user_name,
            avatar: got.avatar,
            user_money: got.user_money,
            time: got.time,
        }
    }
}

pub fn parse_gesture(value: Option<u8>) -> Result<Option<GestureType>, String> {
    match value {
        None => Ok(None),
        Some(0) => Ok(Some(GestureType::Rock)),
        Some(1) => Ok(Some(GestureType::Scissors)),
        Some(2) => Ok(Some(GestureType::Paper)),
        Some(_) => Err("猜拳手势无效".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn open_request_reads_oid_camel_case() {
        let req: OpenRedPacketRequest = serde_json::from_value(json!({
            "oId": "1760000000000",
            "gesture": 1
        }))
        .expect("deserialize");
        assert_eq!(req.o_id, "1760000000000");
        assert_eq!(req.gesture, Some(1));
        assert_eq!(parse_gesture(req.gesture).unwrap().map(|g| g as u8), Some(1));
    }

    #[test]
    fn info_dto_uses_camel_case_and_string_ids() {
        let dto = RedPacketInfoDto {
            session_generation: 3,
            info: RedPacketBaseDto {
                count: 3,
                got: 1,
                message: "恭喜发财".into(),
                user_name: "alice".into(),
                user_avatar_url: "https://example.com/a.png".into(),
                gesture: Some(0),
            },
            receivers: vec!["bob".into()],
            who: vec![RedPacketGotDto {
                user_id: "99".into(),
                user_name: "bob".into(),
                avatar: "".into(),
                user_money: 7,
                time: "12:00".into(),
            }],
        };
        let json = serde_json::to_value(&dto).expect("serialize");
        assert_eq!(json["sessionGeneration"], 3);
        assert_eq!(json["info"]["userName"], "alice");
        assert_eq!(json["info"]["userAvatarUrl"], "https://example.com/a.png");
        assert_eq!(json["who"][0]["userId"], "99");
        assert_eq!(json["who"][0]["userMoney"], 7);
        assert!(json["oId"].is_null());
    }
}
