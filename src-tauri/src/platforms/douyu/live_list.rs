use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct LiveStreamer {
    rid: String,
    room_name: String,
    nickname: String,
    room_src: String,
    avatar: String,
    hn: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FrontendStreamer {
    pub rid: String,
    #[serde(rename = "roomName")]
    pub room_name: String,
    pub nickname: String,
    #[serde(rename = "roomSrc")]
    pub room_src: String,
    pub avatar: String,
    pub hn: String, // Will store 'ol' (online count) as string
    #[serde(rename = "isLive", skip_serializing_if = "Option::is_none")]
    pub is_live: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LiveListDataWrapper {
    pub list: Vec<FrontendStreamer>,
    pub total: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FrontendLiveListResponse {
    pub error: i32,
    pub msg: Option<String>,
    pub data: Option<LiveListDataWrapper>,
}

// Structs for parsing Douyu's mobile API (hgapi/live/cate/newRecList) response
// Based on newRecList.json and web search result
#[derive(Deserialize, Debug)]
struct NewRecStreamerRaw {
    rid: i64, // numeric room ID
    #[serde(rename = "roomName")]
    room_name: String,
    nickname: String,
    #[serde(rename = "roomSrc")]
    room_src: String, // Main cover image
    avatar: String,
    hn: String, // Viewers count string (e.g., "101.8万")
                // rs_ext: Option<Vec<ImageRsExtRaw>>, // Removed as unused
}

#[derive(Deserialize, Debug)]
struct NewRecListDataRaw {
    list: Vec<NewRecStreamerRaw>,
    total: i32, // Total number of streamers
}

#[derive(Deserialize, Debug)]
struct NewRecListApiResponse {
    error: i32,
    msg: Option<String>,
    data: Option<NewRecListDataRaw>, // Optional because API might return error
}

// Structs for parsing Douyu's V1 API response for third-level categories
#[derive(Deserialize, Debug)]
struct DouyuV1Streamer {
    rid: u32, // Douyu uses number for rid here
    rn: String,
    nn: String,
    av: String,
    ol: u32,      // Douyu online count
    rs16: String, // Cover image
    #[serde(rename = "type")]
    stream_type: Option<u32>, // Example: type:1 might mean live
                  // Add any other fields you might need, e.g. cid3 for verification
}

#[derive(Deserialize, Debug)]
struct DouyuV1Data {
    rl: Vec<DouyuV1Streamer>,
    // Douyu's V1 directory API typically doesn't provide a total count.
    // It might have `pgcnt` (page count) in some versions, but not in the example.
    // We will estimate `total` based on the number of items returned vs. page size.
}

#[derive(Deserialize, Debug)]
struct DouyuV1ApiResponse {
    code: i32,
    msg: Option<String>,
    data: Option<DouyuV1Data>,
}

#[command]
pub async fn fetch_live_list(offset: u32, cate2: String, limit: u32) -> FrontendLiveListResponse {
    let url = format!(
        "https://m.douyu.com/hgapi/live/cate/newRecList?offset={}&cate2={}&limit={}",
        offset, cate2, limit
    );

    let client = reqwest::Client::builder()
        .http1_only()
        .connect_timeout(std::time::Duration::from_secs(15))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())
        .unwrap();
    let response_result = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1")
        .send()
        .await;

    let response = match response_result {
        Ok(res) => res,
        Err(e) => {
            eprintln!("[Backend fetch_live_list] Reqwest error: {}", e);
            return FrontendLiveListResponse {
                error: 500,
                msg: Some(format!("Network request failed: {}", e)),
                data: None,
            };
        }
    };

    if !response.status().is_success() {
        let status_code = response.status().as_u16() as i32;
        let err_msg = format!(
            "[Backend fetch_live_list] API request failed with status: {}",
            response.status()
        );
        eprintln!("{}", err_msg);
        return FrontendLiveListResponse {
            error: status_code,
            msg: Some(format!("Douyu API request failed: {}", response.status())),
            data: None,
        };
    }

    let text = match response.text().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!(
                "[Backend fetch_live_list] Error reading response text: {}",
                e
            );
            return FrontendLiveListResponse {
                error: 500,
                msg: Some(format!("Failed to read response text: {}", e)),
                data: None,
            };
        }
    };

    match serde_json::from_str::<NewRecListApiResponse>(&text) {
        // Use new API response struct
        Ok(douyu_response) => {
            if douyu_response.error == 0 {
                if let Some(douyu_data) = douyu_response.data {
                    let streamers_transformed: Vec<FrontendStreamer> = douyu_data
                        .list
                        .into_iter()
                        .map(|s_raw| {
                            FrontendStreamer {
                                rid: s_raw.rid.to_string(),
                                room_name: s_raw.room_name,
                                nickname: s_raw.nickname,
                                avatar: s_raw.avatar,
                                room_src: s_raw.room_src, // Using main room_src for now
                                hn: s_raw.hn,
                                is_live: Some(true), // Assuming all returned by this API are live
                            }
                        })
                        .collect();

                    let frontend_data = LiveListDataWrapper {
                        list: streamers_transformed,
                        total: douyu_data.total as u32, // API returns i32, wrapper expects u32
                    };
                    FrontendLiveListResponse {
                        error: 0,
                        msg: douyu_response.msg.or_else(|| Some("Success".to_string())),
                        data: Some(frontend_data),
                    }
                } else {
                    eprintln!(
                        "[Backend fetch_live_list] API success but no data field. Raw: {}",
                        text
                    );
                    FrontendLiveListResponse {
                        error: -1,
                        msg: Some("Douyu API success code but no data field.".to_string()),
                        data: None,
                    }
                }
            } else {
                eprintln!(
                    "[Backend fetch_live_list] API returned error {}. Msg: {:?}. Raw: {}",
                    douyu_response.error, douyu_response.msg, text
                );
                FrontendLiveListResponse {
                    error: douyu_response.error,
                    msg: douyu_response
                        .msg
                        .or_else(|| Some("Error from Douyu API".to_string())),
                    data: None,
                }
            }
        }
        Err(e) => {
            eprintln!(
                "[Backend fetch_live_list] Error parsing Douyu Mobile JSON: {}. Raw: {}",
                e, text
            );
            FrontendLiveListResponse {
                error: -2,
                msg: Some(format!("Failed to parse Douyu API response: {}", e)),
                data: None,
            }
        }
    }
}

// New command for third-level categories
#[command]
pub async fn fetch_live_list_for_cate3(
    cate3_id: String,
    page: u32,
    limit: u32,
) -> FrontendLiveListResponse {
    let current_page = if page == 0 { 1 } else { page }; // Ensure page is at least 1 for the URL

    let url = format!(
        "https://www.douyu.com/gapi/rkc/directory/mixListV1/3_{}/{}?limit={}",
        cate3_id, current_page, limit
    );
    println!("[Backend fetch_live_list_for_cate3] Fetching URL: {}", url);

    let client = match reqwest::Client::builder()
        .http1_only()
        .connect_timeout(std::time::Duration::from_secs(15))
        .no_proxy()
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return FrontendLiveListResponse {
                error: 500,
                msg: Some(format!("Failed to build HTTP client: {}", e)),
                data: None,
            };
        }
    };
    let response_result = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
        .send()
        .await;

    let response = match response_result {
        Ok(res) => res,
        Err(e) => {
            eprintln!("[Backend fetch_live_list_for_cate3] Reqwest error: {}", e);
            return FrontendLiveListResponse {
                error: 500, // Simulate HTTP 500 for client error
                msg: Some(format!("Network request failed: {}", e)),
                data: None,
            };
        }
    };

    if !response.status().is_success() {
        let status_code = response.status().as_u16() as i32;
        let err_msg = format!(
            "[Backend fetch_live_list_for_cate3] API request failed with status: {}",
            response.status()
        );
        eprintln!("{}", err_msg);
        return FrontendLiveListResponse {
            error: status_code,
            msg: Some(format!("Douyu API request failed: {}", response.status())),
            data: None,
        };
    }

    let text = match response.text().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!(
                "[Backend fetch_live_list_for_cate3] Error reading response text: {}",
                e
            );
            return FrontendLiveListResponse {
                error: 500,
                msg: Some(format!("Failed to read response text: {}", e)),
                data: None,
            };
        }
    };

    match serde_json::from_str::<DouyuV1ApiResponse>(&text) {
        Ok(douyu_response) => {
            if douyu_response.code == 0 {
                if let Some(douyu_data) = douyu_response.data {
                    let streamers_transformed: Vec<FrontendStreamer> = douyu_data
                        .rl
                        .into_iter()
                        .map(|s| FrontendStreamer {
                            rid: s.rid.to_string(),
                            room_name: s.rn,
                            nickname: s.nn,
                            avatar: s.av, // This is usually a path, might need full URL prefix if not already there
                            room_src: s.rs16,
                            hn: s.ol.to_string(), // Convert online count to string
                            is_live: Some(s.stream_type.map_or(true, |st| st == 1)), // Assume live if no type or type is 1
                        })
                        .collect();

                    let total_returned = streamers_transformed.len() as u32;
                    let estimated_total = if total_returned < limit {
                        (current_page - 1) * limit + total_returned // If less than limit, means it's the last page
                    } else {
                        current_page * limit + 1 // Otherwise, assume there's at least one more page
                    };

                    let frontend_data = LiveListDataWrapper {
                        list: streamers_transformed,
                        total: estimated_total, // Using estimated total
                    };
                    FrontendLiveListResponse {
                        error: 0,
                        msg: douyu_response.msg.or_else(|| Some("Success".to_string())),
                        data: Some(frontend_data),
                    }
                } else {
                    eprintln!("[Backend fetch_live_list_for_cate3] API success but no data field. Raw: {}", text);
                    FrontendLiveListResponse {
                        error: -1,
                        msg: Some("Douyu API success code but no data field.".to_string()),
                        data: None,
                    }
                }
            } else {
                eprintln!(
                    "[Backend fetch_live_list_for_cate3] API returned error {}. Msg: {:?}. Raw: {}",
                    douyu_response.code, douyu_response.msg, text
                );
                FrontendLiveListResponse {
                    error: douyu_response.code,
                    msg: douyu_response
                        .msg
                        .or_else(|| Some("Error from Douyu API".to_string())),
                    data: None,
                }
            }
        }
        Err(e) => {
            eprintln!(
                "[Backend fetch_live_list_for_cate3] Error parsing Douyu V1 API JSON: {}. Raw: {}",
                e, text
            );
            FrontendLiveListResponse {
                error: -2,
                msg: Some(format!("Failed to parse Douyu API response: {}", e)),
                data: None,
            }
        }
    }
}
