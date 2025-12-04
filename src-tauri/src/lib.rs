// pub mod fetch; // Removed

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn open_url_cmd(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let (cmd, args) = ("cmd", vec!["/C", "start", &url]);
    #[cfg(target_os = "macos")]
    let (cmd, args) = ("open", vec![&url]);
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let (cmd, args) = ("xdg-open", vec![&url]);

    std::process::Command::new(cmd)
        .args(args)
        .status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![greet, open_url_cmd])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
