//! Explicit single-folder selection; no settings writes or file contents are exposed.

use std::path::Path;

use tauri::{AppHandle, WebviewWindow};

use crate::error::AppError;

#[tauri::command(rename_all = "camelCase")]
pub async fn extension_choose_directory(
    app: AppHandle,
    window: WebviewWindow,
    root: Option<String>,
) -> Result<Option<String>, AppError> {
    let initial = root
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| super::config_import::load_prefs(&app).extension_root);
    let mut dialog = rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title("Select extension directory");
    // The same validator guards extension_host::resolve_root and preference saves.
    if super::config_import::valid_extension_root(&initial) {
        dialog = dialog.set_directory(initial.trim());
    }
    match dialog.pick_folder().await {
        Some(folder) => selected_directory(folder.path()).map(Some),
        None => Ok(None),
    }
}

fn selected_directory(path: &Path) -> Result<String, AppError> {
    let root = path
        .to_str()
        .ok_or_else(|| AppError::business("Extension directory must be valid UTF-8"))?;
    if !super::config_import::valid_extension_root(root) || !path.is_dir() {
        return Err(AppError::business(
            "Extension root must be an absolute local directory",
        ));
    }
    Ok(root.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_reuses_host_validation_and_requires_a_directory() {
        let root = std::env::temp_dir();
        assert_eq!(
            selected_directory(&root).unwrap(),
            root.to_str().unwrap().trim()
        );
        for invalid in [
            "relative",
            "\\\\server\\share",
            "//server/share",
            "https://example.com/extensions",
            "bad\0path",
        ] {
            assert!(selected_directory(Path::new(invalid)).is_err());
        }
        assert!(selected_directory(&std::env::current_exe().unwrap()).is_err());
        assert!(selected_directory(&root.join(format!(
            "fishpi-missing-extension-root-{}",
            std::process::id()
        )))
        .is_err());
    }
}
