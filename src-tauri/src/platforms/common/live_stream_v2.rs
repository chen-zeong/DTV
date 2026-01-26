use serde::{Deserialize, Serialize};

use crate::platforms::common::types::StreamVariant;
use crate::platforms::common::types_rust::SupportedPlatformRust;

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LiveStreamMode {
    Playback,
    Meta,
}

#[derive(Debug, Deserialize, Clone)]
pub struct GetLiveStreamRequest {
    pub platform: SupportedPlatformRust,
    pub room_id: String,
    pub quality: Option<String>,
    pub line: Option<String>,
    pub cookie: Option<String>,
    // Default behavior: debug is enabled unless explicitly set to false.
    pub debug: Option<bool>,
    // Default behavior: playback mode.
    pub mode: Option<LiveStreamMode>,
}

impl GetLiveStreamRequest {
    pub fn debug_enabled(&self) -> bool {
        self.debug != Some(false)
    }

    pub fn mode(&self) -> LiveStreamMode {
        self.mode.unwrap_or(LiveStreamMode::Playback)
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct LiveStreamResponse {
    pub status: LiveStatus,
    pub room: RoomMeta,
    pub playback: Option<Playback>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LiveStatus {
    Live,
    Offline,
    Error,
}

#[derive(Debug, Serialize, Clone)]
pub struct RoomMeta {
    pub platform: SupportedPlatformRust,
    pub room_id: String,
    pub normalized_room_id: Option<String>,
    pub web_rid: Option<String>,
    pub title: Option<String>,
    pub anchor_name: Option<String>,
    pub avatar: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct Playback {
    pub url: String,
    pub stream_type: StreamType,
    pub upstream_url: Option<String>,
    pub variants: Option<Vec<StreamVariant>>,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StreamType {
    Flv,
    Hls,
    Unknown,
}

pub fn infer_stream_type(url: &str) -> StreamType {
    let lower = url.to_lowercase();
    if lower.contains(".m3u8") {
        return StreamType::Hls;
    }
    if lower.contains(".flv") || lower.contains("/live.flv") {
        return StreamType::Flv;
    }
    StreamType::Unknown
}

pub fn truncate_variants(mut variants: Vec<StreamVariant>) -> Vec<StreamVariant> {
    const MAX_VARIANTS: usize = 20;
    if variants.len() > MAX_VARIANTS {
        variants.truncate(MAX_VARIANTS);
    }
    variants
}
