use serde::Serialize;
use std::fs;

#[derive(Serialize)]
pub struct ImportedConfigFile {
    pub path: String,
    pub content: String,
}

#[tauri::command]
pub fn save_config_export(
    default_file_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    save_config_export_impl(default_file_name, contents)
}

#[tauri::command]
pub fn pick_config_import() -> Result<Option<ImportedConfigFile>, String> {
    pick_config_import_impl()
}

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
fn save_config_export_impl(
    default_file_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    let fallback_file_name = "dtv-config.json";
    let selected_path = rfd::FileDialog::new()
        .add_filter("DTV Config", &["json"])
        .set_file_name(if default_file_name.trim().is_empty() {
            fallback_file_name
        } else {
            default_file_name.trim()
        })
        .save_file();

    let Some(path) = selected_path else {
        return Ok(None);
    };

    fs::write(&path, contents)
        .map_err(|error| format!("Failed to export config file: {}", error))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn save_config_export_impl(
    _default_file_name: String,
    _contents: String,
) -> Result<Option<String>, String> {
    Err("Config export is only supported on desktop platforms.".to_string())
}

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
fn pick_config_import_impl() -> Result<Option<ImportedConfigFile>, String> {
    let selected_path = rfd::FileDialog::new()
        .add_filter("DTV Config", &["json"])
        .pick_file();

    let Some(path) = selected_path else {
        return Ok(None);
    };

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read config file: {}", error))?;
    Ok(Some(ImportedConfigFile {
        path: path.to_string_lossy().into_owned(),
        content,
    }))
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn pick_config_import_impl() -> Result<Option<ImportedConfigFile>, String> {
    Err("Config import is only supported on desktop platforms.".to_string())
}
