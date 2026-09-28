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
    pub description: String,
    pub version: String,
    pub kind: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionScan {
    pub root: String,
    pub themes: Vec<ExtensionItem>,
    pub plugins: Vec<ExtensionItem>,
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
            unsupported,
            message: "扩展目录不存在，继续使用内置主题".to_string(),
        });
    }
    let mut themes = Vec::new();
    let mut plugins = Vec::new();
    let entries = match std::fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(_) => {
            return Ok(ExtensionScan {
                root: root.display().to_string(),
                themes,
                plugins,
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
            plugins.push(item);
        }
    }
    Ok(ExtensionScan {
        root: root.display().to_string(),
        themes,
        plugins,
        unsupported,
        message: "只列出本机扩展，没有执行插件脚本".to_string(),
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
    Some(ExtensionItem {
        key: format!("{publisher}.{name}"),
        name: name.to_string(),
        description: description.chars().take(120).collect(),
        version: value
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or("")
            .chars()
            .take(32)
            .collect(),
        kind: kind.to_string(),
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
