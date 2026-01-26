use crate::platforms::common::http_client::HttpClient;
use crate::platforms::common::http_headers::{headers_with_user_agent_and_referer, insert_cookie};
use crate::platforms::douyin::signed_url::global_builder;
use reqwest::header::{HeaderValue, ACCEPT_ENCODING};
use serde_json::Value;

use crate::platforms::common::errors::DtvError;

// Use the tested cookie from douyin_rust sample to improve API success.
const DEFAULT_COOKIE: &str =
    "ttwid=1%7C2iDIYVmjzMcpZ20fcaFde0VghXAA3NaNXE_SLR68IyE%7C1761045455%7Cab35197d5cfb21df6cbb2fa7ef1c9262206b062c315b9d04da746d0b37dfbc7d";
// Align UA with the working Douyin Rust sample to keep a_bogus inputs consistent.
pub const DEFAULT_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.97 Safari/537.36 Core/1.116.567.400 QQBrowser/19.7.6764.400";

#[derive(Debug, Clone)]
pub struct DouyinRoomData {
    pub room: Value,
}

// 直接从返回的 stream_data 中补全 ORIGIN，不依赖 HTML 解析，贴近 douyin_rust 实现。
fn merge_origin_stream(room: &mut Value) {
    let Some(stream_url) = room.get_mut("stream_url") else { return };
    let live_core_sdk_data = stream_url.get("live_core_sdk_data");
    if live_core_sdk_data.is_none() {
        return;
    }

    let pull_datas = stream_url.get("pull_datas").and_then(|v| v.as_object());
    let json_str = if let Some(pd) = pull_datas {
        if let Some((_, entry)) = pd.iter().next() {
            entry
                .get("stream_data")
                .and_then(|s| s.as_str())
                .map(|s| s.to_string())
        } else {
            None
        }
    } else {
        live_core_sdk_data
            .and_then(|d| d.get("pull_data"))
            .and_then(|p| p.get("stream_data"))
            .and_then(|s| s.as_str())
            .map(|s| s.to_string())
    };
    let Some(json_str) = json_str else { return };

    let parsed: Value = serde_json::from_str(&json_str).unwrap_or(Value::Null);
    let origin_main = parsed
        .get("data")
        .and_then(|d| d.get("origin"))
        .and_then(|o| o.get("main"));
    let Some(origin_main) = origin_main else { return };

    let origin_codec = origin_main
        .get("sdk_params")
        .and_then(|s| s.as_str())
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
        .and_then(|v| v.get("VCodec").cloned())
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default();
    let origin_hls = origin_main
        .get("hls")
        .and_then(|v| v.as_str())
        .map(|s| format!("{}&codec={}", s, origin_codec));
    let origin_flv = origin_main
        .get("flv")
        .and_then(|v| v.as_str())
        .map(|s| format!("{}&codec={}", s, origin_codec));

    if let Some(hls_origin) = origin_hls {
        match stream_url.get_mut("hls_pull_url_map") {
            Some(map_val) if map_val.is_object() => {
                if let Some(map) = map_val.as_object_mut() {
                    let existing = map.clone();
                    map.clear();
                    map.insert("ORIGIN".to_string(), Value::String(hls_origin.clone()));
                    map.extend(existing);
                }
            }
            _ => {
                let mut new_map = serde_json::Map::new();
                new_map.insert("ORIGIN".to_string(), Value::String(hls_origin));
                stream_url.as_object_mut().map(|obj| {
                    obj.insert("hls_pull_url_map".to_string(), Value::Object(new_map))
                });
            }
        }
    }

    if let Some(flv_origin) = origin_flv {
        match stream_url.get_mut("flv_pull_url") {
            Some(map_val) if map_val.is_object() => {
                if let Some(map) = map_val.as_object_mut() {
                    let existing = map.clone();
                    map.clear();
                    map.insert("ORIGIN".to_string(), Value::String(flv_origin.clone()));
                    map.extend(existing);
                }
            }
            _ => {
                let mut new_map = serde_json::Map::new();
                new_map.insert("ORIGIN".to_string(), Value::String(flv_origin));
                stream_url.as_object_mut().map(|obj| {
                    obj.insert("flv_pull_url".to_string(), Value::Object(new_map))
                });
            }
        }
    }
}

async fn fetch_room_from_api(
    http_client: &HttpClient,
    web_id: &str,
    cookies: Option<&str>,
    include_stream: bool,
) -> Result<DouyinRoomData, DtvError> {
    let mut headers = headers_with_user_agent_and_referer(
        DEFAULT_USER_AGENT,
        &format!("https://live.douyin.com/{web_id}"),
    ).map_err(|e| DtvError::internal(e))?;
    headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("identity"));
    insert_cookie(&mut headers, Some(cookies.unwrap_or(DEFAULT_COOKIE))).map_err(|e| DtvError::internal(e))?;

    let params = vec![
        ("aid", "6383"),
        ("app_name", "douyin_web"),
        ("live_id", "1"),
        ("device_platform", "web"),
        ("language", "zh-CN"),
        ("browser_language", "zh-CN"),
        ("browser_platform", "Win32"),
        ("browser_name", "Chrome"),
        ("browser_version", "116.0.0.0"),
        ("web_rid", web_id),
        ("msToken", ""),
    ];
    let api = global_builder().build_signed_url(
        "https://live.douyin.com/webcast/room/web/enter/",
        params
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
        DEFAULT_USER_AGENT,
    ).map_err(|e| DtvError::internal(e))?;
    let json: Value = http_client
        .inner
        .get(&api)
        .headers(headers)
        .send()
        .await
        .map_err(|e| DtvError::network(format!("Failed to request Douyin web enter API: {}", e)))?
        .json()
        .await
        .map_err(|e| DtvError::api(format!("Failed to parse Douyin web enter response: {}", e)))?;

    let room = json
        .get("data")
        .and_then(|d| d.get("data"))
        .and_then(|arr| arr.get(0))
        .cloned()
        .ok_or_else(|| DtvError::api("Douyin web enter API did not return room data".to_string()))?;

    let anchor_name = json
        .get("data")
        .and_then(|d| d.get("user"))
        .and_then(|u| u.get("nickname"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut room_mut = room;
    if let Some(name) = anchor_name {
        if let Some(obj) = room_mut.as_object_mut() {
            obj.insert("anchor_name".to_string(), Value::String(name));
        }
    }
    if include_stream {
        merge_origin_stream(&mut room_mut);
    }
    Ok(DouyinRoomData { room: room_mut })
}

/// Normalize user input into a Douyin web_id. Supports raw IDs and full URLs such as
/// `https://live.douyin.com/123456` or `https://www.douyin.com/follow/live/123456`.
pub fn normalize_douyin_live_id(id_or_url: &str) -> String {
    let trimmed = id_or_url.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    // Prefer explicit room/query parameters if present.
    if let Some(qpos) = trimmed.find('?') {
        let query = &trimmed[qpos + 1..];
        for kv in query.split('&') {
            if let Some(val) = kv
                .strip_prefix("room_id=")
                .or_else(|| kv.strip_prefix("roomId="))
                .or_else(|| kv.strip_prefix("web_rid="))
                .or_else(|| kv.strip_prefix("webId="))
            {
                let cleaned = val
                    .split(['&', '#'])
                    .find(|s| !s.is_empty())
                    .unwrap_or(val);
                if !cleaned.is_empty() {
                    return cleaned.to_string();
                }
            }
        }
    }

    // Handle any douyin.com URL (live.douyin.com, www.douyin.com/follow/live/xxx, etc.).
    if let Some(pos) = trimmed.find("douyin.com/") {
        let start = pos + "douyin.com/".len();
        let remainder = &trimmed[start..];
        let path_only = remainder.split(['?', '#']).next().unwrap_or(remainder);
        if let Some(segment) = path_only
            .rsplit('/')
            .find(|segment| !segment.is_empty())
        {
            return segment
                .split(['?', '&', '#'])
                .find(|s| !s.is_empty())
                .unwrap_or(segment)
                .to_string();
        }
    }

    // Fallback: strip trailing query/hash from raw input.
    trimmed
        .split(['?', '&', '#'])
        .find(|s| !s.is_empty())
        .unwrap_or(trimmed)
        .to_string()
}

pub async fn fetch_room_data(
    http_client: &HttpClient,
    raw_id: &str,
    cookies: Option<&str>,
    include_stream: bool,
) -> Result<DouyinRoomData, DtvError> {
    let web_id = normalize_douyin_live_id(raw_id);
    // 简化逻辑：直接走网页版接口 + a_bogus，避免 HTML 解析失败。
    fetch_room_from_api(http_client, &web_id, cookies, include_stream).await
}

pub fn choose_flv_stream(room: &Value, desired_quality: &str) -> Option<(String, String)> {
    let flv_map = room
        .get("stream_url")
        .and_then(|v| v.get("flv_pull_url"))
        .and_then(|v| v.as_object())?;

    const QUALITY_ORDER: [&str; 6] = ["OD", "BD", "UHD", "HD", "SD", "LD"];

    let mut entries: Vec<(String, String)> = flv_map
        .iter()
        .filter_map(|(key, value)| value.as_str().map(|url| (key.clone(), url.to_string())))
        .collect();

    if entries.is_empty() {
        return None;
    }

    while entries.len() < QUALITY_ORDER.len() {
        if let Some(last) = entries.last().cloned() {
            entries.push(last);
        } else {
            break;
        }
    }

    let desired = desired_quality.trim().to_uppercase();
    let idx = QUALITY_ORDER
        .iter()
        .position(|q| q.eq_ignore_ascii_case(&desired))
        .unwrap_or(0);

    entries
        .get(idx)
        .cloned()
        .or_else(|| entries.last().cloned())
}
