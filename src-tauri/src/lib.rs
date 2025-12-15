#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use log::LevelFilter;
use reqwest;
use std::collections::HashMap;
use std::env;
use std::io::Write;
use std::sync::{Arc, Mutex};
use tauri::Wry;
use tokio::sync::oneshot;

mod platforms;
mod proxy;

use platforms::common::{DouyinDanmakuState, FollowHttpClient, HuyaDanmakuState};
use platforms::douyin::fetch_douyin_room_info;
use platforms::douyin::fetch_douyin_streamer_info;
use platforms::douyin::start_douyin_danmu_listener;
use platforms::douyin::{get_douyin_live_stream_url, get_douyin_live_stream_url_with_quality};
use platforms::douyu::fetch_categories;
use platforms::douyu::{fetch_live_list, fetch_live_list_for_cate3};
use platforms::huya::stop_huya_danmaku_listener;
use platforms::huya::{fetch_huya_live_list, start_huya_danmaku_listener};

#[derive(Default, Clone)]
pub struct StreamUrlStore {
    pub url: Arc<Mutex<String>>,
}

// State for managing Douyu danmaku listener handles (stop signals)
#[derive(Default, Clone)]
#[allow(dead_code)]
pub struct DouyuDanmakuHandles(Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>);

// Douyu主播搜索：调用平台模块的 perform_anchor_search
#[tauri::command]
async fn search_anchor(keyword: String) -> Result<String, String> {
    platforms::douyu::search_anchor::perform_anchor_search(&keyword)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_stream_url_cmd(room_id: String) -> Result<String, String> {
    platforms::douyu::get_stream_url(&room_id, None)
        .await
        .map_err(|e| {
            eprintln!(
                "[Rust Error] Failed to get stream URL for room {}: {}",
                room_id,
                e.to_string()
            );
            format!("Failed to get stream URL: {}", e.to_string())
        })
}

#[tauri::command]
async fn get_stream_url_with_quality_cmd(
    room_id: String,
    quality: String,
    line: Option<String>,
) -> Result<String, String> {
    platforms::douyu::get_stream_url_with_quality(&room_id, &quality, line.as_deref())
        .await
        .map_err(|e| {
            eprintln!(
                "[Rust Error] Failed to get stream URL for room {}: {}",
                room_id,
                e.to_string()
            );
            format!("Failed to get stream URL: {}", e.to_string())
        })
}

#[tauri::command]
async fn set_stream_url_cmd(state: tauri::State<'_, StreamUrlStore>, url: String) -> Result<(), String> {
    let mut stored_url = state.url.lock().map_err(|e| e.to_string())?;
    *stored_url = url;
    Ok(())
}

// Simple stubs for danmaku start/stop on mobile (implementations were not present)
#[tauri::command]
async fn start_danmaku_listener(
    _state: tauri::State<'_, DouyuDanmakuHandles>,
    _room_id: String,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
async fn stop_danmaku_listener(
    _state: tauri::State<'_, DouyuDanmakuHandles>,
    _room_id: String,
) -> Result<(), String> {
    Ok(())
}

fn resolve_log_level() -> LevelFilter {
    let env_log_level = env::var("DTV_LOG_LEVEL")
        .or_else(|_| env::var("TAURI_DTV_LOG_LEVEL"))
        .unwrap_or_default()
        .to_lowercase();

    if let Some(level) = match env_log_level.as_str() {
        "debug" => Some(LevelFilter::Debug),
        "warn" => Some(LevelFilter::Warn),
        "error" => Some(LevelFilter::Error),
        "trace" => Some(LevelFilter::Trace),
        "off" => Some(LevelFilter::Off),
        "info" => Some(LevelFilter::Info),
        _ => None,
    } {
        return level;
    }

    LevelFilter::Info
}

fn init_logger(level: LevelFilter) {
    let mut builder = env_logger::builder();
    builder.format(|buf, record| {
        writeln!(buf, "[{}] {} - {}", record.level(), record.target(), record.args())
    });
    builder.filter(None, level);
    let _ = builder.try_init();
}

fn build_app() -> tauri::Builder<Wry> {
    let log_level = resolve_log_level();
    init_logger(log_level);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
        .no_proxy()
        .build()
        .expect("Failed to create reqwest client");
    let follow_http_client = FollowHttpClient::new().expect("Failed to create follow http client");

    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .manage(client)
        .manage(follow_http_client)
        .manage(DouyuDanmakuHandles::default())
        .manage(DouyinDanmakuState::default())
        .manage(HuyaDanmakuState::default())
        .manage(platforms::common::BilibiliDanmakuState::default())
        .manage(StreamUrlStore::default())
        .manage(proxy::ProxyServerHandle::default())
        .manage(platforms::bilibili::state::BilibiliState::default())
        .invoke_handler(tauri::generate_handler![
            get_stream_url_cmd,
            get_stream_url_with_quality_cmd,
            set_stream_url_cmd,
            search_anchor,
            start_danmaku_listener,
            stop_danmaku_listener,
            start_douyin_danmu_listener,
            start_huya_danmaku_listener,
            stop_huya_danmaku_listener,
            platforms::bilibili::danmaku::start_bilibili_danmaku_listener,
            platforms::bilibili::danmaku::stop_bilibili_danmaku_listener,
            proxy::start_proxy,
            proxy::stop_proxy,
            proxy::start_static_proxy_server,
            fetch_categories,
            fetch_live_list,
            fetch_live_list_for_cate3,
            platforms::douyu::fetch_douyu_room_info,
            platforms::douyu::fetch_three_cate,
            platforms::douyin::danmu::signature::generate_douyin_ms_token,
            platforms::douyin::douyin_streamer_list::fetch_douyin_partition_rooms,
            get_douyin_live_stream_url,
            get_douyin_live_stream_url_with_quality,
            fetch_douyin_room_info,
            fetch_douyin_streamer_info,
            fetch_huya_live_list,
            platforms::huya::fetch_huya_join_params,
            platforms::huya::stream_url::get_huya_unified_cmd,
            platforms::bilibili::state::generate_bilibili_w_webid,
            platforms::bilibili::live_list::fetch_bilibili_live_list,
            platforms::bilibili::stream_url::get_bilibili_live_stream_url_with_quality,
            platforms::bilibili::streamer_info::fetch_bilibili_streamer_info,
            platforms::bilibili::cookie::get_bilibili_cookie,
            platforms::bilibili::cookie::bootstrap_bilibili_cookie,
            platforms::bilibili::search::search_bilibili_rooms,
            platforms::huya::search::search_huya_anchors,
        ])
}

pub fn run_desktop() {
    let context = tauri::generate_context!();
    build_app()
        .run(context)
        .expect("error while running tauri application");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    run_desktop();
}
