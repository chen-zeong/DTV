use chrono::Local;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Serialize)]
pub struct ImportedJsonFile {
    pub path: String,
    pub content: String,
}

fn is_lan_sync_json_candidate(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    let lower = name.to_ascii_lowercase();
    if !lower.ends_with(".json") {
        return false;
    }
    lower.starts_with("dtv-sync")
}

fn sanitize_file_name(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        let ok = ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.';
        out.push(if ok { ch } else { '_' });
    }
    let trimmed = out.trim_matches(['.', ' ']).to_string();
    if trimmed.is_empty() {
        "dtv-sync.json".to_string()
    } else {
        trimmed
    }
}

fn ensure_json_ext(file_name: &str) -> String {
    if file_name.to_ascii_lowercase().ends_with(".json") {
        file_name.to_string()
    } else {
        format!("{file_name}.json")
    }
}

fn unique_path(mut path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }

    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "dtv-sync".to_string());
    let ext = path.extension().map(|s| s.to_string_lossy().into_owned());

    for idx in 2..=9999 {
        let file_name = match &ext {
            Some(ext) if !ext.is_empty() => format!("{stem}-{idx}.{ext}"),
            _ => format!("{stem}-{idx}"),
        };
        let candidate = parent.join(file_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    path.set_file_name(format!("{stem}-{}", Local::now().timestamp_millis()));
    path
}

#[tauri::command]
pub fn export_lan_sync_json_to_desktop(
    app: tauri::AppHandle,
    contents: String,
    default_file_name: Option<String>,
) -> Result<String, String> {
    let desktop = app
        .path()
        .desktop_dir()
        .map_err(|e| format!("Failed to resolve desktop dir: {e}"))?;

    let fallback_name = format!("dtv-sync-{}.json", Local::now().format("%Y%m%d-%H%M%S"));
    let raw_name = default_file_name.unwrap_or(fallback_name);
    let file_name = ensure_json_ext(&sanitize_file_name(raw_name.trim()));

    let path = unique_path(desktop.join(file_name));
    fs::write(&path, contents).map_err(|e| format!("Failed to export json file: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn pick_lan_sync_json_import(app: tauri::AppHandle) -> Result<Option<ImportedJsonFile>, String> {
    let desktop = app.path().desktop_dir().ok();
    let mut dialog = rfd::FileDialog::new().add_filter("DTV Sync", &["json"]);
    if let Some(dir) = desktop {
        dialog = dialog.set_directory(dir);
    }

    let Some(path) = dialog.pick_file() else {
        return Ok(None);
    };

    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read json file: {e}"))?;
    Ok(Some(ImportedJsonFile {
        path: path.to_string_lossy().into_owned(),
        content,
    }))
}

#[tauri::command]
pub fn import_latest_lan_sync_json_from_desktop(app: tauri::AppHandle) -> Result<Option<ImportedJsonFile>, String> {
    let desktop = app
        .path()
        .desktop_dir()
        .map_err(|e| format!("Failed to resolve desktop dir: {e}"))?;

    let mut best: Option<(PathBuf, std::time::SystemTime)> = None;

    let entries = fs::read_dir(&desktop).map_err(|e| format!("Failed to read desktop dir: {e}"))?;
    for entry in entries {
        let entry = match entry {
            Ok(v) => v,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_file() || !is_lan_sync_json_candidate(&path) {
            continue;
        }
        let modified = match fs::metadata(&path).and_then(|m| m.modified()) {
            Ok(t) => t,
            Err(_) => continue,
        };
        match &best {
            None => best = Some((path, modified)),
            Some((_, best_time)) if modified > *best_time => best = Some((path, modified)),
            _ => {}
        }
    }

    let Some((path, _)) = best else {
        return Ok(None);
    };
    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read json file: {e}"))?;
    Ok(Some(ImportedJsonFile {
        path: path.to_string_lossy().into_owned(),
        content,
    }))
}
