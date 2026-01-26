#![allow(unused_imports)]
pub mod http_client;
pub mod http_headers;
pub mod js_function_worker;
pub mod js_runtime;
pub mod logging;
pub mod errors;
pub mod signing;
pub mod live_stream_v2;
pub mod live_stream_v2_cmd;
pub mod types;
pub mod types_rust;

// Re-export necessary types to make them available directly under platforms::common::TypeName
pub use http_client::FollowHttpClient;
pub use js_runtime::{bootstrap_basic_browser_env, ensure_js_runtime_platform_initialized, new_js_runtime};
pub use live_stream_v2::{
    infer_stream_type, truncate_variants, GetLiveStreamRequest, LiveStatus, LiveStreamMode,
    LiveStreamResponse, Playback, RoomMeta, StreamType,
};
pub use types::BilibiliDanmakuState;
pub use types::DanmakuFrontendPayload;
pub use types::DouyinDanmakuState;
pub use types::DouyuDanmakuState;
pub use types::GetStreamUrlPayload;
pub use types::HuyaDanmakuState;
pub use types::LiveStreamInfo;
