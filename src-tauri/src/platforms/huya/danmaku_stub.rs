// Mobile stub implementations to avoid pulling in `tars-stream`
use tauri::State;

use crate::platforms::common::HuyaDanmakuState;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct HuyaJoinParams {
    pub yyid: i64,
    pub top_sid: i64,
}

pub async fn fetch_huya_join_params(_room_id: String) -> Result<HuyaJoinParams, String> {
    Err("虎牙弹幕在移动端未实现".to_string())
}

pub async fn start_huya_danmaku_listener(
    _payload: crate::platforms::common::GetStreamUrlPayload,
    _app_handle: tauri::AppHandle,
    _state: State<'_, HuyaDanmakuState>,
) -> Result<(), String> {
    Ok(())
}

pub async fn stop_huya_danmaku_listener(
    _state: State<'_, HuyaDanmakuState>,
    _room_id: String,
) -> Result<(), String> {
    Ok(())
}
