use crate::platforms::common::http_client::HttpClient;
use crate::platforms::common::{FollowHttpClient, GetStreamUrlPayload, LiveStreamInfo};
use crate::platforms::douyin::web_api::{fetch_room_data, normalize_douyin_live_id, DouyinRoomData};
use tauri::State;

use crate::platforms::common::errors::DtvError;

pub async fn fetch_douyin_streamer_info(
    payload: GetStreamUrlPayload,
    follow_http: State<'_, FollowHttpClient>,
) -> Result<LiveStreamInfo, DtvError> {
    let requested_id = payload.args.room_id_str.trim().to_string();
    if requested_id.is_empty() {
        return Ok(LiveStreamInfo {
            title: None,
            anchor_name: None,
            avatar: None,
            stream_url: None,
            status: None,
            error_message: Some("Douyin web_id cannot be empty.".to_string()),
            upstream_url: None,
            available_streams: None,
            normalized_room_id: None,
            web_rid: None,
        });
    }

    let http_client: &HttpClient = &follow_http.0;

    let normalized_id = normalize_douyin_live_id(&requested_id);

    match fetch_room_data(http_client, &normalized_id, None, false).await {
        Ok(DouyinRoomData { room }) => {
            let web_rid = super::douyin_streamer_detail::extract_web_rid(&room)
                .unwrap_or_else(|| normalized_id.clone());
            let status = room
                .get("status")
                .and_then(|v| v.as_i64())
                .unwrap_or_default() as i32;
            let title = room
                .get("title")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let anchor_name = super::douyin_streamer_detail::extract_anchor_name(&room);
            let avatar = super::douyin_streamer_detail::extract_avatar(&room);
            let available_streams = super::douyin_streamer_detail::collect_available_streams(&room);

            Ok(LiveStreamInfo {
                title,
                anchor_name,
                avatar,
                stream_url: None,
                status: Some(status),
                error_message: None,
                upstream_url: None,
                available_streams,
                normalized_room_id: None,
                web_rid: Some(web_rid),
            })
        }
        Err(e) => Ok(LiveStreamInfo {
            title: None,
            anchor_name: None,
            avatar: None,
            stream_url: None,
            status: None,
                error_message: Some(format!("获取抖音房间信息失败: {}", e)),
                upstream_url: None,
                available_streams: None,
                normalized_room_id: None,
                web_rid: Some(normalized_id),
        }),
    }
}
