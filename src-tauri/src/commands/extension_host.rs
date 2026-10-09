//! Read-only legacy extension discovery. Never load JS or expose host credentials.
//! Theme source is inert text; the frontend maps only known color variables.

use std::collections::HashSet;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::error::AppError;

const MAX_PACKAGE: usize = 64_000;
const MAX_CSS: usize = 200_000;
const MAX_README: usize = 128_000;
const MAX_ICON: usize = 32_000;
const MAX_PACKAGES: usize = 200;
const MAX_ENTRIES: usize = 2_000;

const UNSUPPORTED: &[&str] = &[
    "activate(context, electron): no Node/Electron runtime or arbitrary local permissions",
    "context.fishpi / login(token): credentials stay in Rust and the system keyring",
    "require / fs / child_process / electron.shell: no arbitrary files, processes or downloads",
    "hooks().sendMsgEvent / messageEvent / liveness: JS callbacks cannot run in the trusted webview",
    "setHookJs(file) / activate($VueApp): Vue root, DOM and renderer require are not exposed",
    "setSidebar(icon, url) / getSettingUrl(): privileged Electron webviews are not available",
    "context.on(command) / send / webview.$ipc: no untrusted plugin command dispatcher",
    "logout / quit listeners: no plugin runtime to deliver lifecycle callbacks",
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionScan {
    pub root: String,
    pub themes: Vec<ExtensionItem>,
    pub plugins: Vec<ExtensionItem>,
    pub unsupported: Vec<String>,
    pub diagnostics: Vec<String>,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeCss {
    /// Source was read, not executed or attached to the document.
    pub applied: bool,
    pub css: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionDetail {
    pub key: String,
    pub readme: String,
    pub message: String,
}

struct LocalPackage {
    folder: PathBuf,
    manifest: Value,
    item: ExtensionItem,
}

#[tauri::command(rename_all = "camelCase")]
pub fn extension_scan(app: AppHandle, root: Option<String>) -> Result<ExtensionScan, AppError> {
    Ok(scan_directory(&resolve_root(&app, root)?))
}

fn scan_directory(root: &Path) -> ExtensionScan {
    let (packages, diagnostics) = discover(root);
    let mut themes = Vec::new();
    let mut plugins = Vec::new();
    for package in packages {
        if package.item.kind == "theme" {
            themes.push(package.item);
        } else {
            plugins.push(package.item);
        }
    }
    ExtensionScan {
        root: root.display().to_string(),
        themes,
        plugins,
        unsupported: UNSUPPORTED.iter().map(|text| (*text).to_string()).collect(),
        diagnostics,
        message: "Local metadata only; plugin JavaScript is not loaded.".to_string(),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn extension_load_theme(
    app: AppHandle,
    root: Option<String>,
    theme: String,
) -> Result<ThemeCss, AppError> {
    load_theme_source(&resolve_root(&app, root)?, theme.trim())
}

fn load_theme_source(root: &Path, theme: &str) -> Result<ThemeCss, AppError> {
    if theme.is_empty() || theme == "Default" {
        return Ok(theme_fallback("Built-in theme"));
    }
    let (packages, _) = discover(root);
    let Some(package) = packages
        .into_iter()
        .find(|package| package.item.kind == "theme" && package.item.key == theme)
    else {
        return Ok(theme_fallback(
            "Local theme not found; using the built-in theme",
        ));
    };
    let Some(main) = package.manifest.get("main").and_then(Value::as_str) else {
        return Ok(theme_fallback("Theme package has no CSS entry"));
    };
    let Some(relative) = safe_relative(main) else {
        return Ok(theme_fallback("Theme entry escapes its package"));
    };
    if !relative
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("css"))
    {
        return Ok(theme_fallback("Theme entry must be a local CSS file"));
    }
    match read_text(&package.folder, &relative, MAX_CSS) {
        Ok(css) => Ok(ThemeCss {
            applied: true,
            css,
            message: "Local theme source read; only mapped colors may be applied".to_string(),
        }),
        Err(reason) => Ok(theme_fallback(reason)),
    }
}

fn theme_fallback(message: &str) -> ThemeCss {
    ThemeCss {
        applied: false,
        css: String::new(),
        message: message.to_string(),
    }
}

/// Only a read-only README operation is supported. Legacy executable APIs fail explicitly.
#[tauri::command(rename_all = "camelCase")]
pub fn extension_call(
    app: AppHandle,
    api: String,
    key: Option<String>,
    root: Option<String>,
) -> Result<ExtensionDetail, AppError> {
    if api != "readme" {
        return Err(AppError::business(
            "Legacy executable plugin API is unavailable; only readme is supported",
        ));
    }
    let key = key.ok_or_else(|| AppError::business("Missing extension key"))?;
    let (packages, _) = discover(&resolve_root(&app, root)?);
    let package = packages
        .into_iter()
        .find(|package| package.item.key == key)
        .ok_or_else(|| AppError::business("Local extension not found"))?;
    read_detail(&package)
}

fn read_detail(package: &LocalPackage) -> Result<ExtensionDetail, AppError> {
    let entries = std::fs::read_dir(&package.folder)
        .map_err(|_| AppError::business("Cannot read extension directory"))?;
    let mut candidates = Vec::new();
    for entry in entries.take(MAX_ENTRIES).flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let lower = name.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "readme.md" | "readme.markdown" | "readme.txt" | "readme"
        ) {
            candidates.push(name);
        }
    }
    candidates.sort_by_key(|name| {
        (
            name.to_ascii_lowercase() != "readme.md",
            name.to_ascii_lowercase(),
        )
    });
    let readme = match candidates.first() {
        Some(name) => {
            read_text(&package.folder, Path::new(name), MAX_README).map_err(AppError::business)?
        }
        None => String::new(),
    };
    Ok(ExtensionDetail {
        key: package.item.key.clone(),
        message: if readme.is_empty() {
            "No README provided"
        } else {
            "README loaded without executable HTML or external images"
        }
        .to_string(),
        readme,
    })
}

fn resolve_root(app: &AppHandle, root: Option<String>) -> Result<PathBuf, AppError> {
    let root = root
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| super::config_import::load_prefs(app).extension_root);
    if !super::config_import::valid_extension_root(&root) {
        return Err(AppError::business(
            "Extension root must be an absolute local directory",
        ));
    }
    Ok(PathBuf::from(root.trim()))
}

fn discover(root: &Path) -> (Vec<LocalPackage>, Vec<String>) {
    let mut diagnostics = Vec::new();
    let mut packages = Vec::new();
    let Ok(canonical_root) = root.canonicalize() else {
        diagnostics.push("Extension directory does not exist or cannot be accessed".to_string());
        return (packages, diagnostics);
    };
    let Ok(entries) = std::fs::read_dir(&canonical_root) else {
        diagnostics.push("Extension directory cannot be read".to_string());
        return (packages, diagnostics);
    };
    let mut folders = Vec::new();
    for (index, entry) in entries.enumerate() {
        if index >= MAX_ENTRIES {
            diagnostics.push(format!("Directory entry limit reached ({MAX_ENTRIES})"));
            break;
        }
        let Ok(entry) = entry else {
            diagnostics.push("An extension directory entry cannot be read".to_string());
            continue;
        };
        if !entry
            .file_type()
            .is_ok_and(|kind| kind.is_dir() && !kind.is_symlink())
        {
            continue;
        }
        let Ok(folder) = entry.path().canonicalize() else {
            continue;
        };
        if folder.starts_with(&canonical_root) && folder != canonical_root {
            folders.push(folder);
        } else {
            diagnostics.push("A linked extension directory escapes the root".to_string());
        }
    }
    folders.sort();
    folders.dedup();
    let mut keys = HashSet::new();
    for folder in folders {
        if packages.len() >= MAX_PACKAGES {
            diagnostics.push(format!("Extension package limit reached ({MAX_PACKAGES})"));
            break;
        }
        if !folder.join("package.json").exists() {
            continue;
        }
        let parsed = read_text(&folder, Path::new("package.json"), MAX_PACKAGE)
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok());
        let Some(manifest) = parsed else {
            diagnostics
                .push("An invalid, oversized or inaccessible package.json was skipped".to_string());
            continue;
        };
        if manifest.get("fishpi").is_none() {
            continue;
        }
        let Some(item) = package_item(&folder, &manifest) else {
            diagnostics.push("Invalid fishpi package metadata was skipped".to_string());
            continue;
        };
        if !keys.insert(item.key.clone()) {
            diagnostics.push(format!("Duplicate extension key skipped: {}", item.key));
            continue;
        }
        packages.push(LocalPackage {
            folder,
            manifest,
            item,
        });
    }
    (packages, diagnostics)
}

fn package_item(folder: &Path, value: &Value) -> Option<ExtensionItem> {
    let fishpi = value.get("fishpi")?.as_object()?;
    let name = value.get("name")?.as_str()?.trim();
    let publisher = value
        .get("publisher")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .unwrap_or("unknown");
    let key = format!("{publisher}.{name}");
    if name.is_empty()
        || key.len() > 120
        || key.chars().any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return None;
    }
    Some(ExtensionItem {
        key,
        name: name.to_string(),
        display_name: clip_field(value.get("displayName").and_then(Value::as_str), 80)
            .unwrap_or_else(|| name.to_string()),
        description: clip_field(value.get("description").and_then(Value::as_str), 240)
            .unwrap_or_default(),
        version: clip_field(value.get("version").and_then(Value::as_str), 32).unwrap_or_default(),
        kind: if fishpi.get("type").and_then(Value::as_str) == Some("theme") {
            "theme"
        } else {
            "extension"
        }
        .to_string(),
        author: json_person_name(value.get("author"))
            .or_else(|| clip_field(Some(publisher), 64))
            .unwrap_or_default(),
        homepage: safe_http_url(value.get("homepage")),
        repository: safe_http_url(value.get("repository")),
        icon: fishpi
            .get("icon")
            .and_then(Value::as_str)
            .map(|relative| read_icon_data_url(folder, relative))
            .unwrap_or_default(),
    })
}

fn safe_relative(value: &str) -> Option<PathBuf> {
    let normalized = value.trim().replace('\\', "/");
    if normalized.is_empty() || normalized.contains(':') || normalized.chars().any(char::is_control)
    {
        return None;
    }
    let path = PathBuf::from(normalized);
    if path.components().any(|part| {
        matches!(
            part,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return None;
    }
    Some(path)
}

fn read_bytes(folder: &Path, relative: &Path, max: usize) -> Result<Vec<u8>, &'static str> {
    let root = folder
        .canonicalize()
        .map_err(|_| "Package directory cannot be read")?;
    let file = folder
        .join(relative)
        .canonicalize()
        .map_err(|_| "Local file not found")?;
    if !file.starts_with(&root) {
        return Err("Local file escapes its package");
    }
    let file = std::fs::File::open(file).map_err(|_| "Local file cannot be read")?;
    let metadata = file.metadata().map_err(|_| "Local file cannot be read")?;
    if !metadata.is_file() || metadata.len() > max as u64 {
        return Err("Local file is not a regular file or exceeds its size limit");
    }
    let mut bytes = Vec::new();
    file.take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Local file cannot be read")?;
    if bytes.len() > max {
        return Err("Local file exceeds its size limit");
    }
    Ok(bytes)
}

fn read_text(folder: &Path, relative: &Path, max: usize) -> Result<String, &'static str> {
    String::from_utf8(read_bytes(folder, relative, max)?)
        .map(|text| text.trim_start_matches('\u{feff}').to_string())
        .map_err(|_| "Local file is not UTF-8 text")
}

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
        // SVG may contain styles and external references, not just script tags.
        _ => return String::new(),
    };
    let Ok(bytes) = read_bytes(folder, &path, MAX_ICON) else {
        return String::new();
    };
    if bytes.is_empty() {
        return String::new();
    }
    format!("data:{mime};base64,{}", base64_encode(&bytes))
}

fn safe_http_url(value: Option<&Value>) -> String {
    let raw = match value {
        Some(Value::String(text)) => text.as_str(),
        Some(Value::Object(obj)) => obj.get("url").and_then(Value::as_str).unwrap_or(""),
        _ => "",
    };
    let raw = raw.trim().strip_prefix("git+").unwrap_or(raw.trim());
    let Ok(url) = reqwest::Url::parse(raw) else {
        return String::new();
    };
    if raw.len() > 2_000
        || !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || raw.chars().any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return String::new();
    }
    url.to_string()
}

fn clip_field(text: Option<&str>, max: usize) -> Option<String> {
    let text = text?.trim();
    (!text.is_empty()).then(|| text.chars().take(max).collect())
}

fn json_person_name(value: Option<&Value>) -> Option<String> {
    let value = value?;
    clip_field(
        value
            .as_str()
            .or_else(|| value.get("name").and_then(Value::as_str)),
        64,
    )
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let triple = (u32::from(chunk[0]) << 16)
            | (u32::from(chunk.get(1).copied().unwrap_or(0)) << 8)
            | u32::from(chunk.get(2).copied().unwrap_or(0));
        out.push(TABLE[((triple >> 18) & 63) as usize] as char);
        out.push(TABLE[((triple >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((triple >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(triple & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "fishpi-extension-test-{}-{stamp}",
                std::process::id()
            ));
            std::fs::create_dir(&root).unwrap();
            Self(root)
        }

        fn package(&self, folder: &str, manifest: Value) -> PathBuf {
            let path = self.0.join(folder);
            std::fs::create_dir(&path).unwrap();
            std::fs::write(path.join("package.json"), manifest.to_string()).unwrap();
            path
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn scans_metadata_without_loading_js_and_reports_duplicates() {
        let fixture = Fixture::new();
        let manifest = json!({"name":"demo","main":"missing.js","fishpi":{}});
        fixture.package("a", manifest.clone());
        fixture.package("b", manifest);
        fixture.package("c", json!({"name":"ordinary"}));
        fixture.package(
            "d",
            json!({"name":"theme","fishpi":{"type":"theme"},"main":"main.css"}),
        );
        let scan = scan_directory(&fixture.0);
        assert_eq!(scan.plugins.len(), 1);
        assert_eq!(scan.plugins[0].key, "unknown.demo");
        assert_eq!(scan.themes.len(), 1);
        assert!(scan
            .diagnostics
            .iter()
            .any(|text| text.contains("Duplicate")));
        assert!(serde_json::to_value(scan).unwrap().get("hooks").is_none());
    }

    #[test]
    fn rejects_cross_platform_traversal_and_ads() {
        for path in [
            "../a",
            "..\\a",
            "/a",
            "C:\\a",
            "\\\\server\\a",
            "icon.png:stream",
            "a\0",
        ] {
            assert!(safe_relative(path).is_none(), "{path:?}");
        }
        assert_eq!(
            safe_relative("./theme.css"),
            Some(PathBuf::from("./theme.css"))
        );
        assert_eq!(
            safe_relative("assets\\icon.png"),
            Some(PathBuf::from("assets/icon.png"))
        );
    }

    #[test]
    fn theme_uses_exact_publisher_key_and_falls_back() {
        let fixture = Fixture::new();
        let folder = fixture.package(
            "theme",
            json!({"name":"demo","publisher":"one","main":"theme.css","fishpi":{"type":"theme"}}),
        );
        std::fs::write(
            folder.join("theme.css"),
            ":root { --global-text-color: white; }",
        )
        .unwrap();
        assert!(load_theme_source(&fixture.0, "one.demo").unwrap().applied);
        assert!(!load_theme_source(&fixture.0, "demo").unwrap().applied);
        assert!(!load_theme_source(&fixture.0, "Default").unwrap().applied);
        std::fs::remove_file(folder.join("theme.css")).unwrap();
        assert!(!load_theme_source(&fixture.0, "one.demo").unwrap().applied);
    }

    #[test]
    fn bounded_text_and_readme_are_data_only() {
        let fixture = Fixture::new();
        let folder = fixture.package("plugin", json!({"name":"demo","fishpi":{}}));
        std::fs::write(
            folder.join("README.md"),
            "<script>bad()</script>\n# Read me",
        )
        .unwrap();
        let (packages, _) = discover(&fixture.0);
        assert!(read_detail(&packages[0])
            .unwrap()
            .readme
            .contains("<script>"));
        assert!(read_text(&folder, Path::new("README.md"), 4).is_err());
        std::fs::write(folder.join("invalid.txt"), [0xff]).unwrap();
        assert!(read_text(&folder, Path::new("invalid.txt"), 10).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_linked_files_and_folders_outside_root() {
        let fixture = Fixture::new();
        let outside = Fixture::new();
        let folder = fixture.package("plugin", json!({"name":"demo","fishpi":{}}));
        std::fs::write(outside.0.join("private.txt"), "private").unwrap();
        std::os::unix::fs::symlink(outside.0.join("private.txt"), folder.join("README.md"))
            .unwrap();
        std::os::unix::fs::symlink(&outside.0, fixture.0.join("escape")).unwrap();
        assert!(read_text(&folder, Path::new("README.md"), MAX_README).is_err());
        assert_eq!(discover(&fixture.0).0.len(), 1);
    }

    #[test]
    fn urls_people_icons_and_base64() {
        assert_eq!(
            safe_http_url(Some(&json!({"url":"git+https://example.com/a"}))),
            "https://example.com/a"
        );
        for url in [
            "javascript:alert(1)",
            "file:///secret",
            "https://user:password@example.com",
            "https://",
        ] {
            assert!(safe_http_url(Some(&json!(url))).is_empty());
        }
        assert_eq!(
            json_person_name(Some(&json!({"name":"Ada"}))),
            Some("Ada".to_string())
        );
        let fixture = Fixture::new();
        std::fs::write(fixture.0.join("icon.svg"), "<svg/>").unwrap();
        assert!(read_icon_data_url(&fixture.0, "icon.svg").is_empty());
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
    }
}
