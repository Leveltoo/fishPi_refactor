//! 用户搜索、名片、活跃度 / 签到 DTO。不含 token。

use fishpi_sdk::domain::user::{AtUser, UserInfo};
use serde::{Deserialize, Serialize};

/// `user_search` 入参。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserSearchRequest {
    pub query: String,
}

/// 用户名联想命中。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserSearchHit {
    pub user_name: String,
    pub user_avatar_url: String,
}

impl From<AtUser> for UserSearchHit {
    fn from(user: AtUser) -> Self {
        Self {
            user_name: user.username.as_str().to_string(),
            user_avatar_url: user.avatar,
        }
    }
}

/// `user_search` 结果。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserSearchResult {
    pub session_generation: u64,
    pub users: Vec<UserSearchHit>,
}

/// `user_profile` 入参。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserProfileRequest {
    pub user_name: String,
}

/// 名片用用户资料。不含邮箱、token、密码。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserProfileDto {
    pub user_name: String,
    pub user_nickname: String,
    pub user_avatar_url: String,
    pub user_no: String,
    pub role: String,
    pub intro: String,
    pub city: String,
    pub online: bool,
    pub points: i32,
    pub following: i32,
    pub follower: i32,
    pub card_bg: String,
    pub metals: Vec<MetalDto>,
}

/// 名片佩戴勋章（仅公开展示字段）。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetalDto {
    pub icon: String,
    pub description: String,
    pub enabled: bool,
}

impl From<&UserInfo> for UserProfileDto {
    fn from(user: &UserInfo) -> Self {
        Self {
            user_name: user.username.as_str().to_string(),
            user_nickname: user.nickname.clone(),
            user_avatar_url: user.avatar.clone(),
            user_no: user.user_no.clone(),
            role: user.role.clone(),
            intro: user.intro.clone(),
            city: user.city.clone(),
            online: user.online,
            points: user.points,
            following: user.following,
            follower: user.follower,
            card_bg: user.card_bg.clone(),
            metals: user
                .metals
                .iter()
                .filter(|m| m.enabled)
                .map(|m| MetalDto {
                    icon: m.icon.clone(),
                    description: m.description.clone(),
                    enabled: m.enabled,
                })
                .collect(),
        }
    }
}

impl From<UserInfo> for UserProfileDto {
    fn from(user: UserInfo) -> Self {
        Self::from(&user)
    }
}

/// `user_profile` 结果。
///
/// `profile` 是规范嵌套；`user` 与顶层 flatten 给名片 overlay 用（它读 `user` / 顶层字段）。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserProfileResult {
    pub session_generation: u64,
    pub profile: UserProfileDto,
    pub user: UserProfileDto,
    pub user_name: String,
    pub user_nickname: String,
    pub user_avatar_url: String,
    pub intro: String,
    pub points: i32,
}

impl UserProfileResult {
    pub fn new(session_generation: u64, profile: UserProfileDto) -> Self {
        Self {
            session_generation,
            user_name: profile.user_name.clone(),
            user_nickname: profile.user_nickname.clone(),
            user_avatar_url: profile.user_avatar_url.clone(),
            intro: profile.intro.clone(),
            points: profile.points,
            user: profile.clone(),
            profile,
        }
    }
}

/// `user_liveness`。活跃度建议至少间隔 10 分钟查询，由前端节流。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserLivenessResult {
    pub session_generation: u64,
    pub liveness: f64,
}

/// `user_is_checkin`
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserCheckinResult {
    pub session_generation: u64,
    pub checked_in: bool,
}

/// `user_is_collected_liveness`
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserCollectedLivenessResult {
    pub session_generation: u64,
    pub collected: bool,
}

/// `user_reward_liveness` 成功结果。超时走 `outcome_unknown`，不在这里填假积分。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserRewardLivenessResult {
    pub session_generation: u64,
    pub points: i32,
    pub sum: i32,
}

impl UserRewardLivenessResult {
    pub fn new(session_generation: u64, points: i32) -> Self {
        Self {
            session_generation,
            points,
            sum: points,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_hit_camel_case() {
        let dto = UserSearchHit {
            user_name: "alice".into(),
            user_avatar_url: "https://example.com/a.png".into(),
        };
        let value = serde_json::to_value(&dto).expect("serialize");
        assert_eq!(value["userName"], "alice");
        assert_eq!(value["userAvatarUrl"], "https://example.com/a.png");
    }
}
