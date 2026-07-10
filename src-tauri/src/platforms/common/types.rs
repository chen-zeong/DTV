use serde::{Deserialize, Serialize};

// Wrapper for payload like { args: { room_id_str: "..." } }
// Used by get_douyin_live_stream_url and start_douyin_danmaku_listener
#[derive(Deserialize, Debug)]
#[allow(dead_code)]
pub struct PayloadWrapperForRoomId {
    pub args: RoomIdDetail,
}

#[derive(Deserialize, Debug)]
#[allow(dead_code)]
pub struct RoomIdDetail {
    #[serde(alias = "roomIdStr")]
    pub room_id_str: String,
}

// New payload wrapper specifically for get_douyin_live_stream_url
#[derive(Deserialize, Debug)]
#[allow(dead_code)]
pub struct GetStreamUrlArgs {
    pub room_id_str: String,
}

#[derive(Deserialize, Debug)]
#[allow(dead_code)]
pub struct GetStreamUrlPayload {
    pub args: GetStreamUrlArgs,
}

// 描述一个可用的播放流变体（用于调试/导出所有地址）
#[derive(Serialize, Clone, Debug)]
pub struct StreamVariant {
    pub url: String,
    pub format: Option<String>,   // e.g. flv, ts, mp4
    pub desc: Option<String>,     // e.g. 原画/高清
    pub qn: Option<i32>,          // B 站的清晰度编号
    pub protocol: Option<String>, // e.g. http, https, ws/hls
}

// For the return type of get_douyin_live_stream_url
// Matches LiveStreamInfo interface in DouyinLive.vue
#[derive(Serialize, Clone, Debug)]
pub struct LiveStreamInfo {
    pub title: Option<String>,
    pub anchor_name: Option<String>,
    pub avatar: Option<String>,
    pub stream_url: Option<String>,
    pub status: Option<i32>,
    pub error_message: Option<String>,
    // 新增：上游真实地址（未经过本地代理）
    pub upstream_url: Option<String>,
    // 新增：所有可用的播放地址列表（调试/导出用）
    pub available_streams: Option<Vec<StreamVariant>>,
    // 新增：规范化后的房间ID（例如从 web_id 提取出的 room.id_str）
    pub normalized_room_id: Option<String>,
    // 新增：直播间的 web_rid（用于关注列表以 web_id 为主键）
    pub web_rid: Option<String>,
}

#[derive(Default, Clone)]
#[allow(dead_code)]
pub struct StreamUrlStore {
    pub url: std::sync::Arc<std::sync::Mutex<String>>,
}

// Moved from main.rs
// State for the Douyin Danmaku listener
#[derive(Default)]
#[allow(dead_code)]
pub struct DouyinDanmakuState(pub std::sync::Mutex<Option<tokio::sync::mpsc::Sender<()>>>);

// State for the Bilibili Danmaku listener
#[derive(Default)]
#[allow(dead_code)]
pub struct BilibiliDanmakuState(pub std::sync::Mutex<Option<tokio::sync::mpsc::Sender<()>>>);

// State for the Douyu Danmaku listener
#[derive(Default)]
#[allow(dead_code)]
pub struct DouyuDanmakuState(pub std::sync::Mutex<Option<tokio::sync::mpsc::Sender<()>>>);

// State for the Huya Danmaku listener
#[derive(Default)]
#[allow(dead_code)]
pub struct HuyaDanmakuState(pub std::sync::Mutex<Option<tokio::sync::mpsc::Sender<()>>>);

#[derive(Serialize, Clone, Debug, specta::Type)]
pub struct DanmakuFrontendPayload {
    pub room_id: String,
    pub user: String,
    pub content: String,
    pub user_level: i64,
    pub fans_club_level: i32,
    pub color: Option<String>,
}
