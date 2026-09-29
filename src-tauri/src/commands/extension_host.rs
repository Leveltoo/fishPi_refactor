//! 本地扩展目录：只读本机 `package.json` 和主题 CSS。
//!
//! 不下载远程插件，不执行插件脚本，不把凭据或 shell 交给插件。
//! 旧版 `activate(context, electron)` 没有安全等价物，调用一律返回明确错误。

use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::error::AppError;

const MAX_CSS: usize = 200_000;
const MAX_PACKAGE: usize = 64_000;
const MAX_HOOK: usize = 256_000;
const MAX_HOOKS: usize = 100;

const UNSUPPORTED: &[&str] = &[
    "electron",
    "electron.shell",
    "electron.ipcRenderer",
    "child_process",
    "context.fishpi",
    "login 事件",
    "require",
    "远程下载插件",
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionItem {
    pub key: String,
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub version: String,
    pub kind: String,
    pub author: String,
    pub homepage: String,
    pub repository: String,
    pub icon: String,
}

/// 扩展目录里的 hook 脚本原文。Rust 只读取，不执行；执行由前端决定。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookScript {
    pub key: String,
    pub source: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionScan {
    pub root: String,
    pub themes: Vec<ExtensionItem>,
    pub plugins: Vec<ExtensionItem>,
    pub hooks: Vec<HookScript>,
    pub unsupported: Vec<String>,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeCss {
    pub applied: bool,
    pub css: String,
    pub message: String,
}

#[tauri::command(rename_all = "camelCase")]
pub fn extension_scan(app: AppHandle, root: Option<String>) -> Result<ExtensionScan, AppError> {
    let root = resolve_root(&app, root);
    let unsupported = UNSUPPORTED.iter().map(|item| (*item).to_string()).collect();
    if !root.is_dir() {
        return Ok(ExtensionScan {
            root: root.display().to_string(),
            themes: Vec::new(),
            plugins: Vec::new(),
            hooks: Vec::new(),
            unsupported,
            message: "扩展目录不存在，继续使用内置主题".to_string(),
        });
    }
    let mut themes = Vec::new();
    let mut plugins = Vec::new();
    let mut hooks = Vec::new();
    let entries = match std::fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(_) => {
            return Ok(ExtensionScan {
                root: root.display().to_string(),
                themes,
                plugins,
                hooks,
                unsupported,
                message: "扩展目录无法读取，继续使用内置主题".to_string(),
            });
        }
    };
    for entry in entries.flatten() {
        if themes.len() + plugins.len() >= 200 {
            break;
        }
        let folder = entry.path();
        if !folder.is_dir() {
            continue;
        }
        let Some(item) = read_package(&folder) else {
            continue;
        };
        if item.kind == "theme" {
            themes.push(item);
        } else {
            if hooks.len() < MAX_HOOKS {
                if let Some(script) = read_hook_script(&folder) {
                    hooks.push(script);
                }
            }
            plugins.push(item);
        }
    }
    Ok(ExtensionScan {
        root: root.display().to_string(),
        themes,
        plugins,
        hooks,
        unsupported,
        message: "只列出本机扩展，不执行插件脚本。主题 CSS 仍可加载。".to_string(),
    })
}

/// `Default` 或加载失败时 `applied = false`，调用方应撤掉已注入的样式。
#[tauri::command(rename_all = "camelCase")]
pub fn extension_load_theme(
    app: AppHandle,
    root: Option<String>,
    theme: String,
) -> Result<ThemeCss, AppError> {
    let theme = theme.trim();
    if theme.is_empty() || theme == "Default" {
        return Ok(ThemeCss {
            applied: false,
            css: String::new(),
            message: "使用内置主题".to_string(),
        });
    }
    let root = resolve_root(&app, root);
    let Some(file) = theme_css_file(&root, theme) else {
        return Ok(ThemeCss {
            applied: false,
            css: String::new(),
            message: "没有找到这个本地主题，继续使用内置主题".to_string(),
        });
    };
    let bytes = match std::fs::read(&file) {
        Ok(bytes) if bytes.len() <= MAX_CSS => bytes,
        Ok(_) => {
            return Ok(ThemeCss {
                applied: false,
                css: String::new(),
                message: "主题文件太大，继续使用内置主题".to_string(),
            });
        }
        Err(_) => {
            return Ok(ThemeCss {
                applied: false,
                css: String::new(),
                message: "主题文件读取失败，继续使用内置主题".to_string(),
            });
        }
    };
    let Ok(css) = String::from_utf8(bytes) else {
        return Ok(ThemeCss {
            applied: false,
            css: String::new(),
            message: "主题文件不是文本，继续使用内置主题".to_string(),
        });
    };
    if css_is_remote(&css) {
        return Ok(ThemeCss {
            applied: false,
            css: String::new(),
            message: "主题包含远程样式，已拒绝，继续使用内置主题".to_string(),
        });
    }
    Ok(ThemeCss {
        applied: true,
        css,
        message: "已加载本地主题文件".to_string(),
    })
}

/// 任何插件 API 都拒绝。不读取、不执行插件脚本。
#[tauri::command(rename_all = "camelCase")]
pub fn extension_call(api: String) -> Result<(), AppError> {
    let name = api.trim();
    let name = if name.len() <= 40
        && !name.is_empty()
        && name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_'))
    {
        name
    } else {
        "未知"
    };
    Err(AppError::business(format!(
        "不支持的插件 API：{name}"
    )))
}

fn resolve_root(app: &AppHandle, root: Option<String>) -> PathBuf {
    if let Some(root) = root.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) {
        return PathBuf::from(root);
    }
    PathBuf::from(super::config_import::load_prefs(app).extension_root)
}

fn read_package(folder: &Path) -> Option<ExtensionItem> {
    let bytes = std::fs::read(folder.join("package.json")).ok()?;
    if bytes.len() > MAX_PACKAGE {
        return None;
    }
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    let fishpi = value.get("fishpi")?.as_object()?;
    let name = value.get("name").and_then(Value::as_str)?.trim();
    if name.is_empty() {
        return None;
    }
    let publisher = value
        .get("publisher")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .unwrap_or("unknown");
    let kind = if fishpi.get("type").and_then(Value::as_str) == Some("theme") {
        "theme"
    } else {
        "extension"
    };
    let description = value
        .get("description")
        .or_else(|| value.get("displayName"))
        .and_then(Value::as_str)
        .unwrap_or(name);
    let display_name = value
        .get("displayName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .unwrap_or(name);
    let author = json_person_name(value.get("author"))
        .or_else(|| clip_field(value.get("publisher").and_then(Value::as_str), 40))
        .unwrap_or_else(|| "神秘开发者".to_string());
    let homepage = safe_http_url(value.get("homepage"));
    let repository = {
        let from_field = safe_http_url(value.get("repository"));
        if from_field.is_empty() {
            safe_http_url(
                value
                    .get("repository")
                    .and_then(Value::as_object)
                    .and_then(|obj| obj.get("url")),
            )
        } else {
            from_field
        }
    };
    let icon = fishpi
        .get("icon")
        .and_then(Value::as_str)
        .map(|relative| read_icon_data_url(folder, relative))
        .unwrap_or_default();
    Some(ExtensionItem {
        key: format!("{publisher}.{name}"),
        name: name.to_string(),
        display_name: display_name.chars().take(80).collect(),
        description: description.chars().take(120).collect(),
        version: value
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or("")
            .chars()
            .take(32)
            .collect(),
        kind: kind.to_string(),
        author,
        homepage,
        repository,
        icon,
    })
}

fn theme_css_file(root: &Path, theme: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let folder = entry.path();
        if !folder.is_dir() {
            continue;
        }
        let Ok(bytes) = std::fs::read(folder.join("package.json")) else {
            continue;
        };
        if bytes.len() > MAX_PACKAGE {
            continue;
        }
        let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
            continue;
        };
        let Some(fishpi) = value.get("fishpi").and_then(Value::as_object) else {
            continue;
        };
        if fishpi.get("type").and_then(Value::as_str) != Some("theme") {
            continue;
        }
        let Some(name) = value.get("name").and_then(Value::as_str).map(str::trim) else {
            continue;
        };
        let publisher = value
            .get("publisher")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .unwrap_or("unknown");
        let key = format!("{publisher}.{name}");
        if key != theme && name != theme {
            continue;
        }
        let Some(main) = value.get("main").and_then(Value::as_str) else {
            continue;
        };
        let Some(relative) = safe_relative(main) else {
            continue;
        };
        if !relative
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("css"))
        {
            return None;
        }
        let file = folder.join(relative);
        let Ok(root_canon) = folder.canonicalize() else {
            return None;
        };
        let Ok(file_canon) = file.canonicalize() else {
            return None;
        };
        if file_canon.starts_with(&root_canon) {
            return Some(file_canon);
        }
        return None;
    }
    None
}

fn safe_relative(main: &str) -> Option<PathBuf> {
    let path = Path::new(main.trim());
    if path.as_os_str().is_empty() || path.is_absolute() {
        return None;
    }
    if path.components().any(|part| matches!(part, Component::ParentDir)) {
        return None;
    }
    Some(path.to_path_buf())
}

/// 读取插件的 hook 脚本原文。
///
/// 入口由 `package.json` 的 `fishpi.hooks` 指定（相对路径），缺省为插件目录下的
/// `hooks.js`。只接受目录内的 `.js` 文件，带大小上限；不做任何执行。
fn read_hook_script(folder: &Path) -> Option<HookScript> {
    let bytes = std::fs::read(folder.join("package.json")).ok()?;
    if bytes.len() > MAX_PACKAGE {
        return None;
    }
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    let fishpi = value.get("fishpi")?.as_object()?;
    if fishpi.get("type").and_then(Value::as_str) == Some("theme") {
        return None;
    }
    let name = value.get("name").and_then(Value::as_str)?.trim();
    if name.is_empty() {
        return None;
    }
    let publisher = value
        .get("publisher")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .unwrap_or("unknown");
    let hooks_rel = fishpi
        .get("hooks")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| "hooks.js".to_string());
    let relative = safe_relative(&hooks_rel)?;
    if !relative
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("js"))
    {
        return None;
    }
    let file = folder.join(relative);
    let root_canon = folder.canonicalize().ok()?;
    let file_canon = file.canonicalize().ok()?;
    if !file_canon.starts_with(&root_canon) {
        return None;
    }
    let raw = std::fs::read(&file).ok()?;
    if raw.len() > MAX_HOOK {
        return None;
    }
    let source = String::from_utf8(raw).ok()?;
    Some(HookScript {
        key: format!("{publisher}.{name}"),
        source,
    })
}

fn css_is_remote(css: &str) -> bool {
    let lower = css.to_ascii_lowercase();
    lower.contains("@import")
        || lower.contains("expression(")
        || lower.contains("javascript:")
        || lower.contains("</style")
        || lower.contains("<script")
        || (lower.contains("url(")
            && (lower.contains("http:") || lower.contains("https:") || lower.contains("//")))
}

fn clip_field(text: Option<&str>, max: usize) -> Option<String> {
    let text = text?.trim();
    if text.is_empty() {
        return None;
    }
    Some(text.chars().take(max).collect())
}

fn json_person_name(value: Option<&Value>) -> Option<String> {
    let value = value?;
    if let Some(name) = value.as_str() {
        return clip_field(Some(name), 40);
    }
    clip_field(value.get("name").and_then(Value::as_str), 40)
}

/// 只接受 http(s) 主页。字符串或 `{ url }` 都读。其它协议返回空。
fn safe_http_url(value: Option<&Value>) -> String {
    let raw = match value {
        Some(Value::String(text)) => text.as_str(),
        Some(Value::Object(obj)) => obj.get("url").and_then(Value::as_str).unwrap_or(""),
        _ => "",
    };
    let trimmed = raw.trim().strip_prefix("git+").unwrap_or(raw.trim());
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return String::new();
    }
    if trimmed.len() > 200
        || trimmed
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '<' | '>' | '"' | ' '))
    {
        return String::new();
    }
    trimmed.to_string()
}

const MAX_ICON: usize = 256_000;

/// 把插件目录内的本地图标读成 data URL。越界路径、脚本 SVG、过大文件都丢弃。
fn read_icon_data_url(folder: &Path, relative: &str) -> String {
    let Some(path) = safe_relative(relative) else {
        return String::new();
    };
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        _ => return String::new(),
    };
    let file = folder.join(path);
    let Ok(root) = folder.canonicalize() else {
        return String::new();
    };
    let Ok(canon) = file.canonicalize() else {
        return String::new();
    };
    if !canon.starts_with(&root) {
        return String::new();
    }
    let Ok(bytes) = std::fs::read(&canon) else {
        return String::new();
    };
    if bytes.is_empty() || bytes.len() > MAX_ICON {
        return String::new();
    }
    if ext == "svg" {
        let Ok(text) = std::str::from_utf8(&bytes) else {
            return String::new();
        };
        let lower = text.to_ascii_lowercase();
        if lower.contains("<script")
            || lower.contains("javascript:")
            || lower.contains("onload=")
            || lower.contains("onerror=")
        {
            return String::new();
        }
    }
    format!("data:{mime};base64,{}", base64_encode(&bytes))
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let a = u32::from(chunk[0]);
        let b = u32::from(chunk.get(1).copied().unwrap_or(0));
        let c = u32::from(chunk.get(2).copied().unwrap_or(0));
        let triple = (a << 16) | (b << 8) | c;
        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn http_url_from_string_or_object() {
        assert_eq!(
            safe_http_url(Some(&json!("https://example.com/ext"))),
            "https://example.com/ext"
        );
        assert_eq!(
            safe_http_url(Some(&json!({ "url": "https://github.com/a/b" }))),
            "https://github.com/a/b"
        );
        assert_eq!(safe_http_url(Some(&json!("javascript:alert(1)"))), "");
        assert_eq!(safe_http_url(Some(&json!("ftp://example.com"))), "");
    }

    #[test]
    fn person_name_from_string_or_object() {
        assert_eq!(
            json_person_name(Some(&json!("Ada"))),
            Some("Ada".to_string())
        );
        assert_eq!(
            json_person_name(Some(&json!({ "name": "Lin" }))),
            Some("Lin".to_string())
        );
        assert_eq!(json_person_name(Some(&json!(""))), None);
    }
}
