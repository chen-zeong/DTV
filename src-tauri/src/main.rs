// 在开发模式下允许控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use reqwest;
use std::collections::HashMap;
use std::env;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;
use tauri::Manager;
mod platforms;
mod proxy;
use platforms::common::{DouyinDanmakuState, FollowHttpClient, HuyaDanmakuState};
use platforms::douyin::danmu::signature::generate_douyin_ms_token;
use platforms::douyin::fetch_douyin_partition_rooms;
use platforms::douyin::start_douyin_danmu_listener;
use platforms::douyu::fetch_categories;
use platforms::douyu::fetch_three_cate;
use platforms::douyu::{fetch_live_list, fetch_live_list_for_cate3};
use platforms::huya::stop_huya_danmaku_listener;
use platforms::huya::{fetch_huya_live_list, start_huya_danmaku_listener};
// use platforms::huya::get_huya_stream_url_with_quality; // removed in favor of unified cmd

#[derive(Default, Clone)]
pub struct StreamUrlStore {
    pub urls: Arc<Mutex<HashMap<(String, String), String>>>, // (platform, room_id) -> url
}

// State for managing Douyu danmaku listener handles (stop signals)
#[derive(Default, Clone)]
pub struct DouyuDanmakuHandles(Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>);

// Command to start Douyu danmaku listener
#[tauri::command]
async fn start_danmaku_listener(
    room_id: String,
    window: tauri::Window,
    danmaku_handles: tauri::State<'_, DouyuDanmakuHandles>,
) -> Result<(), String> {
    // If a listener for this room_id already exists, stop it first.
    if let Some(existing_sender) = danmaku_handles.0.lock().unwrap().remove(&room_id) {
        let _ = existing_sender.send(());
    }

    let (stop_tx, stop_rx) = oneshot::channel();
    danmaku_handles
        .0
        .lock()
        .unwrap()
        .insert(room_id.clone(), stop_tx);

    let window_clone = window.clone();
    let room_id_clone = room_id.clone();
    tokio::spawn(async move {
        let mut client = platforms::douyu::danmu_start::DanmakuClient::new(
            &room_id_clone,
            window_clone,
            stop_rx, // Pass the receiver part of the oneshot channel
        );
        if let Err(e) = client.start().await {
            eprintln!(
                "[Rust Main] Douyu danmaku client for room {} failed: {}",
                room_id_clone, e
            );
        }
    });

    Ok(())
}

// Command to stop Douyu danmaku listener
#[tauri::command]
async fn stop_danmaku_listener(
    room_id: String,
    danmaku_handles: tauri::State<'_, DouyuDanmakuHandles>,
) -> Result<(), String> {
    if let Some(sender) = danmaku_handles.0.lock().unwrap().remove(&room_id) {
        match sender.send(()) {
            Ok(_) => Ok(()),
            Err(_) => Err(format!(
                "Failed to stop Douyu danmaku listener for room {}: receiver dropped.",
                room_id
            )),
        }
    } else {
        Ok(())
    }
}

// search_anchor seems fine, assuming douyu::search_anchor is correct
#[tauri::command]
async fn search_anchor(keyword: String) -> Result<String, String> {
    platforms::douyu::perform_anchor_search(&keyword)
        .await
        .map_err(|e| e.to_string())
}

// Main function corrected
fn main() {
    // Create a new HTTP client instance to be managed by Tauri
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
        .no_proxy()
        .build()
        .expect("Failed to create reqwest client");
    let follow_http_client = FollowHttpClient::new().expect("Failed to create follow http client");

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new()
            .level(if std::env::var("DTV_DEBUG").map(|v| v == "1").unwrap_or(false) {
                log::LevelFilter::Debug
            } else {
                log::LevelFilter::Info
            })
            .targets([
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }),
            ])
            .build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Apply macOS vibrancy to the main window when running on macOS
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                if let Some(window) = app.get_webview_window("main") {
                    match apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, None) {
                        Ok(_) => tracing::info!("vibrancy applied successfully"),
                        Err(e) => tracing::error!("vibrancy error: {:?}", e),
                    }
                }
            }
            Ok(())
        })
        .manage(client) // Manage the reqwest client
        .manage(follow_http_client) // 专用关注刷新客户端，避免占用默认连接池
        .manage(DouyuDanmakuHandles::default()) // Manage new DouyuDanmakuHandles
        .manage(DouyinDanmakuState::default()) // Manage DouyinDanmakuState
        .manage(HuyaDanmakuState::default()) // Manage HuyaDanmakuState
        .manage(platforms::common::BilibiliDanmakuState::default()) // Manage BilibiliDanmakuState
        .manage(StreamUrlStore::default())
        .manage(proxy::ProxyServerHandle::default())
        .manage(platforms::bilibili::state::BilibiliState::default())
        .invoke_handler(tauri::generate_handler![
            platforms::common::live_stream_v2_cmd::get_live_stream_v2,
            search_anchor,
            start_danmaku_listener,      // Douyu danmaku start
            stop_danmaku_listener,       // Douyu danmaku stop
            start_douyin_danmu_listener, // Added Douyin danmaku listener command
            start_huya_danmaku_listener, // Added Huya danmaku listener command
            stop_huya_danmaku_listener,  // Added Huya danmaku stop command
            platforms::bilibili::danmaku::start_bilibili_danmaku_listener,
            platforms::bilibili::danmaku::stop_bilibili_danmaku_listener,
             proxy::stop_proxy,
             proxy::start_static_proxy_server,
             fetch_categories,
             fetch_live_list,
             fetch_live_list_for_cate3,
             fetch_three_cate,
              generate_douyin_ms_token,
              fetch_douyin_partition_rooms,
              fetch_huya_live_list,
              platforms::bilibili::state::generate_bilibili_w_webid,
              platforms::bilibili::live_list::fetch_bilibili_live_list,
              platforms::bilibili::cookie::get_bilibili_cookie,
              platforms::bilibili::cookie::bootstrap_bilibili_cookie,
              platforms::bilibili::search::search_bilibili_rooms,
              platforms::huya::search::search_huya_anchors,
         ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
