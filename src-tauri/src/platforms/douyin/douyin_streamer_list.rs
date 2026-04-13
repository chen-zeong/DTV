use crate::platforms::common::http_client::HttpClient;
use crate::platforms::douyin::a_bogus::generate_a_bogus;
use crate::platforms::douyin::web_api::DEFAULT_USER_AGENT;
use reqwest::header::{HeaderMap, HeaderValue, COOKIE, USER_AGENT};
use serde::{Deserialize, Serialize};
use tauri::State; // Removed SET_COOKIE
use urlencoding::encode;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DouyinRoomCover {
    pub url_list: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DouyinRoomOwner {
    pub nickname: String,
    pub avatar_thumb: Option<DouyinRoomCover>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DouyinRoomStats {
    pub total_user_str: String,
    pub user_count_str: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DouyinRoom {
    #[serde(rename = "id_str")]
    // id_str is inside the JSON room object and contains the correct room_id
    pub room_id: String,

    pub title: String,
    pub cover: DouyinRoomCover,
    pub owner: DouyinRoomOwner,
    pub stats: DouyinRoomStats,
    // Add other fields from the JSON room object if necessary
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DouyinPartitionRoomData {
    #[serde(rename = "web_rid")] // Capture the top-level web_rid from JSON
    pub actual_web_rid_for_frontend: String, // Field to hold the true web_rid

    pub room: DouyinRoom,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DouyinPartitionDataWrapper {
    pub data: Vec<DouyinPartitionRoomData>,
    pub count: i32,
    pub offset: i32,
    pub has_more: Option<bool>, // Added for pagination
                                // pub total: Option<i32>, // If available and needed
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DouyinPartitionApiErrorData {
    pub message: Option<String>,
    pub prompts: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum DouyinPartitionApiResponseData {
    Success(DouyinPartitionDataWrapper),
    Error(DouyinPartitionApiErrorData),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DouyinPartitionApiResponse {
    pub data: DouyinPartitionApiResponseData,
    pub status_code: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LiveRoomFrontend {
    pub web_rid: String,
    pub title: String,
    pub cover_url: String,
    pub owner_nickname: String,
    pub user_count_str: String,
    pub avatar_url: String,
}

// This struct will wrap the list of rooms and the has_more flag for the frontend.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DouyinLiveListResponse {
    pub rooms: Vec<LiveRoomFrontend>,
    pub has_more: bool,
    pub next_offset: i32, // The offset to use for the next request
}

#[tauri::command]
pub async fn fetch_douyin_partition_rooms(
    _http_client: State<'_, reqwest::Client>,
    partition: String,
    partition_type: String,
    offset: i32, // This is the offset for the current request (0, 15, 30...)
    ms_token: String,
) -> Result<DouyinLiveListResponse, String> {
    let count: i32 = 15; // Number of items requested per page, explicitly typed as i32

    // 抖音接口在国内可以直接访问，使用直连方式，避免代理问题
    // 使用 new_direct_connection() 绕过系统代理设置
    let local_client =
        HttpClient::new_direct_connection().map_err(|e| format!("Failed to create HttpClient: {}", e))?;

    // 使用更新的 Cookie（从浏览器获取的最新值）
    // 注意：这些 Cookie 可能会过期，需要定期从浏览器更新
    let hardcoded_odin_tt = "54c68ba8fa8ce792ad017c55272d171c283baedc87b2f6282ca8706df295cbd89c5d55449b587b7ebe0a2e352e394a86975955c9ed7f98f209996bdca2749479619aceecc7b75c2374e146b5a722b2e1";
    let hardcoded_ttwid = "1%7CdVwg8DUriPlMDlcGA6XsVP8FZW2vzZEtEnoAxpXQxP8%7C1757517390%7C954f1753f33b21b018d616437b3f053026c22f17cde00bccd655bfb0d71056c5";

    let cookie_string = format!("odin_tt={}; ttwid={}", hardcoded_odin_tt, hardcoded_ttwid);

    let mut headers = HeaderMap::new();
    headers.insert(
        COOKIE,
        HeaderValue::from_str(&cookie_string)
            .map_err(|e| format!("Failed to create cookie header value: {}", e))?,
    );
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static(DEFAULT_USER_AGENT),
    );

    let params: Vec<(String, String)> = vec![
        ("aid".to_string(), "6383".to_string()),
        ("app_name".to_string(), "douyin_web".to_string()),
        ("live_id".to_string(), "1".to_string()),
        ("device_platform".to_string(), "web".to_string()),
        ("language".to_string(), "zh-CN".to_string()),
        ("enter_from".to_string(), "web_homepage_hot".to_string()),
        ("cookie_enabled".to_string(), "true".to_string()),
        ("screen_width".to_string(), "1920".to_string()),
        ("screen_height".to_string(), "1080".to_string()),
        ("browser_language".to_string(), "zh-CN".to_string()),
        ("browser_platform".to_string(), "MacIntel".to_string()),
        ("browser_name".to_string(), "Chrome".to_string()),
        ("browser_version".to_string(), "120.0.0.0".to_string()),
        ("count".to_string(), count.to_string()),
        ("offset".to_string(), offset.to_string()),
        ("partition".to_string(), partition.clone()),
        ("partition_type".to_string(), partition_type.clone()),
        ("req_from".to_string(), "2".to_string()),
        ("msToken".to_string(), ms_token.clone()),
    ];

    let query = serde_urlencoded::to_string(&params)
        .map_err(|e| format!("Failed to encode Douyin partition params: {}", e))?;
    let sign = generate_a_bogus(&query, DEFAULT_USER_AGENT);
    let url = format!(
        "https://live.douyin.com/webcast/web/partition/detail/room/v2/?{}&a_bogus={}",
        query,
        encode(&sign)
    );

    match local_client
        .get_json_with_headers::<DouyinPartitionApiResponse>(&url, Some(headers))
        .await
    {
        Ok(api_response) => {
            // 检查状态码
            if api_response.status_code != 0 {
                // 尝试获取错误信息
                let error_msg = match &api_response.data {
                    DouyinPartitionApiResponseData::Error(err_data) => {
                        format!(
                            "抖音 API 错误 ({}): {}",
                            api_response.status_code,
                            err_data.message.as_deref().unwrap_or("未知错误")
                        )
                    }
                    DouyinPartitionApiResponseData::Success(_) => {
                        format!("抖音 API 返回非零状态码：{}", api_response.status_code)
                    }
                };
                return Err(error_msg);
            }

            // 解析成功响应
            let data_wrapper = match &api_response.data {
                DouyinPartitionApiResponseData::Success(data) => data,
                DouyinPartitionApiResponseData::Error(err_data) => {
                    return Err(format!(
                        "抖音 API 返回错误：{}",
                        err_data.message.as_deref().unwrap_or("未知错误")
                    ));
                }
            };

            let mut frontend_rooms = Vec::new();
            let received_rooms_count = data_wrapper.data.len();

            for room_data in &data_wrapper.data {
                let room_details = &room_data.room;

                let avatar_url = room_details
                    .owner
                    .avatar_thumb
                    .as_ref()
                    .and_then(|thumb| thumb.url_list.get(0))
                    .cloned()
                    .unwrap_or_default();

                let user_count_display = room_details
                    .stats
                    .user_count_str
                    .clone()
                    .unwrap_or_else(|| room_details.stats.total_user_str.clone());

                frontend_rooms.push(LiveRoomFrontend {
                    web_rid: room_data.actual_web_rid_for_frontend.clone(),
                    title: room_details.title.clone(),
                    cover_url: room_details
                        .cover
                        .url_list
                        .get(0)
                        .cloned()
                        .unwrap_or_default(),
                    owner_nickname: room_details.owner.nickname.clone(),
                    user_count_str: user_count_display,
                    avatar_url,
                });
            }

            // 使用 API 提供的 has_more；回退到长度检查
            let api_has_more = data_wrapper.has_more.unwrap_or(false);
            let has_more = api_has_more || received_rooms_count == (count as usize);

            // 优先使用 API 的 offset（如果向前移动）；否则增加接收到的数量
            let next_offset_for_frontend = if data_wrapper.offset > offset {
                data_wrapper.offset
            } else {
                offset + (received_rooms_count as i32)
            };

            Ok(DouyinLiveListResponse {
                rooms: frontend_rooms,
                has_more,
                next_offset: next_offset_for_frontend,
            })
        }
        Err(e) => Err(format!("网络错误，无法获取抖音房间列表：{}", e)),
    }
}
