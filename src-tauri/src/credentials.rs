//! 系统凭据存储：仅供 Rust 调用，禁止明文文件降级。
//!
//! token 只在本模块与 keyring 之间读写，函数内不得 log。

use keyring::Entry;

use crate::error::AppError;

/// 与 `tauri.conf.json` 的 identifier 对齐，避免和其他应用抢同一条凭据。
const SERVICE: &str = "com.leveltoo.fishpi-desktop";
/// 当前只持久化登录 token，账号名固定为 `api_key`。
const ACCOUNT_API_KEY: &str = "api_key";

/// 将 token 写入系统凭据存储。
///
/// 失败时返回 `credential_storage`，由 command 决定「仅本次会话」并提示不能保持登录。
/// 禁止在失败路径写入任何本地明文文件。
pub fn save(token: &str) -> Result<(), AppError> {
    let token = token.trim();
    if token.is_empty() {
        return Err(AppError::credential_storage(
            "凭据为空，拒绝写入系统凭据存储",
        ));
    }
    let entry = credential_entry()?;
    entry
        .set_password(token)
        .map_err(|_| AppError::credential_storage("写入系统凭据存储失败"))
}

/// 读取已保存的 token。无记录返回 `Ok(None)`，不视为错误。
///
/// 调用方须尽快用其构造 `FishPi`，不得把返回值写入可序列化结构或日志。
pub fn load() -> Result<Option<String>, AppError> {
    let entry = credential_entry()?;
    match entry.get_password() {
        Ok(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(AppError::credential_storage("读取系统凭据存储失败")),
    }
}

/// 删除已保存的 token。本来就没有记录视为成功。
///
/// 删除失败必须返回错误，command 不得宣称已完成持久退出。
pub fn delete() -> Result<(), AppError> {
    let entry = credential_entry()?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(AppError::credential_storage("删除系统凭据存储失败")),
    }
}

fn credential_entry() -> Result<Entry, AppError> {
    Entry::new(SERVICE, ACCOUNT_API_KEY)
        .map_err(|_| AppError::credential_storage("无法访问系统凭据存储"))
}
