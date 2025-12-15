#[cfg(not(mobile))]
pub mod danmaku;
#[cfg(mobile)]
pub mod danmaku_stub;
pub mod live_list;
pub mod search;
pub mod stream_url;

#[cfg(not(mobile))]
pub use danmaku::HuyaJoinParams;
#[cfg(mobile)]
pub use danmaku_stub::HuyaJoinParams;

#[cfg(not(mobile))]
#[tauri::command]
pub async fn fetch_huya_join_params(room_id: String) -> Result<HuyaJoinParams, String> {
    danmaku::fetch_huya_join_params(room_id).await
}

#[cfg(mobile)]
#[tauri::command]
pub async fn fetch_huya_join_params(room_id: String) -> Result<HuyaJoinParams, String> {
    danmaku_stub::fetch_huya_join_params(room_id).await
}

#[cfg(not(mobile))]
#[tauri::command]
pub async fn start_huya_danmaku_listener(
    payload: crate::platforms::common::GetStreamUrlPayload,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::platforms::common::HuyaDanmakuState>,
) -> Result<(), String> {
    danmaku::start_huya_danmaku_listener(payload, app_handle, state).await
}

#[cfg(mobile)]
#[tauri::command]
pub async fn start_huya_danmaku_listener(
    payload: crate::platforms::common::GetStreamUrlPayload,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::platforms::common::HuyaDanmakuState>,
) -> Result<(), String> {
    danmaku_stub::start_huya_danmaku_listener(payload, app_handle, state).await
}

#[cfg(not(mobile))]
#[tauri::command]
pub async fn stop_huya_danmaku_listener(
    state: tauri::State<'_, crate::platforms::common::HuyaDanmakuState>,
    room_id: String,
) -> Result<(), String> {
    danmaku::stop_huya_danmaku_listener(room_id, state).await
}

#[cfg(mobile)]
#[tauri::command]
pub async fn stop_huya_danmaku_listener(
    state: tauri::State<'_, crate::platforms::common::HuyaDanmakuState>,
    room_id: String,
) -> Result<(), String> {
    danmaku_stub::stop_huya_danmaku_listener(state, room_id).await
}

pub use live_list::fetch_huya_live_list;
