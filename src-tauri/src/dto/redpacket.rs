//! 开红包 IPC DTO。SDK domain 不直接 Serialize，这里只映射前端要用的字段。

use fishpi_sdk::client::RedPacketSend;
use fishpi_sdk::domain::redpacket::RedPacketType;
use fishpi_sdk::domain::redpacket::{GestureType, RedPacketGot, RedPacketInfo};
use serde::{Deserialize, Serialize};

/// `redpacket_open` 入参。`oId` 是聊天室消息 ID 字符串，禁止用 JS number。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenRedPacketRequest {
    pub o_id: String,
    #[serde(default)]
    pub gesture: Option<u8>,
    #[serde(default)]
    pub expected_session_generation: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendRedPacketRequest {
    #[serde(rename = "type")]
    pub packet_type: String,
    pub money: u32,
    pub count: u32,
    pub msg: String,
    #[serde(default, rename = "recivers", alias = "receivers")]
    pub receivers: Vec<String>,
    #[serde(default)]
    pub gesture: Option<u8>,
    #[serde(default)]
    pub expected_session_generation: Option<u64>,
}

impl SendRedPacketRequest {
    pub fn into_sdk(self) -> Result<RedPacketSend, String> {
        let (packet_type, default_message) = match self.packet_type.as_str() {
            "random" => (RedPacketType::Random, "摸鱼者，事竟成！"),
            "average" => (RedPacketType::Average, "平分红包，人人有份！"),
            "specify" => (RedPacketType::Specify, "试试看，这是给你的红包吗？"),
            "heartbeat" => (RedPacketType::Heartbeat, "玩的就是心跳！"),
            "rockPaperScissors" => (RedPacketType::RockPaperScissors, "石头剪刀布！"),
            _ => return Err("红包类型无效".into()),
        };
        if self.money == 0 {
            return Err("积分必须大于 0".into());
        }
        let mut receivers = Vec::new();
        if self.packet_type == "specify" {
            for name in self.receivers {
                let name = name.trim().to_string();
                if !name.is_empty() && !receivers.contains(&name) {
                    receivers.push(name);
                }
            }
            if receivers.is_empty() || receivers.len() > 1000 {
                return Err("请为专属红包选择 1 至 1000 位收件人".into());
            }
        }
        let count = match self.packet_type.as_str() {
            "specify" => receivers.len() as u32,
            "rockPaperScissors" => 1,
            _ if (1..=1000).contains(&self.count) => self.count,
            _ => return Err("红包个数必须是 1 至 1000 的整数".into()),
        };
        let message = if self.msg.trim().is_empty() {
            default_message.to_string()
        } else {
            self.msg.trim().to_string()
        };
        let mut packet =
            RedPacketSend::new(packet_type, self.money, count, message).with_receivers(receivers);
        if self.packet_type == "rockPaperScissors" {
            let gesture =
                parse_gesture(self.gesture)?.ok_or_else(|| "请先选择猜拳手势".to_string())?;
            packet = packet.with_gesture(gesture);
        } else if self.gesture.is_some() {
            return Err("只有猜拳红包可携带手势".into());
        }
        Ok(packet)
    }
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
        assert_eq!(
            parse_gesture(req.gesture).unwrap().map(|g| g as u8),
            Some(1)
        );
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

    fn send_request(kind: &str) -> SendRedPacketRequest {
        SendRedPacketRequest {
            packet_type: kind.into(),
            money: 32,
            count: 2,
            msg: String::new(),
            receivers: Vec::new(),
            gesture: None,
            expected_session_generation: None,
        }
    }

    #[test]
    fn send_maps_all_five_types_and_defaults() {
        for kind in ["random", "average", "heartbeat"] {
            let packet = send_request(kind).into_sdk().unwrap();
            assert_eq!(packet.r#type, kind);
            assert_eq!(packet.count, 2);
            assert!(!packet.message.is_empty());
            assert!(packet.gesture.is_none());
        }
        let mut request = send_request("specify");
        request.receivers = vec![" alice ".into(), "alice".into(), "bob".into(), "".into()];
        let packet = request.into_sdk().unwrap();
        assert_eq!(packet.count, 2);
        assert_eq!(packet.receivers, ["alice", "bob"]);
        let mut request = send_request("rockPaperScissors");
        request.gesture = Some(0);
        let packet = request.into_sdk().unwrap();
        assert_eq!(packet.count, 1);
        assert_eq!(packet.gesture, Some(0));
    }

    #[test]
    fn send_rejects_invalid_inputs_before_network() {
        assert!(send_request("unknown").into_sdk().is_err());
        assert!(send_request("specify").into_sdk().is_err());
        assert!(send_request("rockPaperScissors").into_sdk().is_err());
        for count in [0, 1001] {
            let mut request = send_request("random");
            request.count = count;
            assert!(request.into_sdk().is_err());
        }
        let mut request = send_request("random");
        request.money = 0;
        assert!(request.into_sdk().is_err());
        for gesture in [Some(3), Some(255)] {
            assert!(parse_gesture(gesture).is_err());
        }
        assert!(serde_json::from_value::<SendRedPacketRequest>(json!({
            "type": "random", "money": 1.5, "count": 2, "msg": ""
        }))
        .is_err());
        assert!(serde_json::from_value::<OpenRedPacketRequest>(json!({
            "oId": 1760000000000_u64
        }))
        .is_err());
    }
}
