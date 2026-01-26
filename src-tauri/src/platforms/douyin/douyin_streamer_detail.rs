use crate::platforms::common::http_client::HttpClient;
use crate::platforms::common::types::StreamVariant;
use crate::platforms::common::GetStreamUrlPayload;
use crate::platforms::common::LiveStreamInfo as CommonLiveStreamInfo;
use crate::platforms::douyin::web_api::{
    choose_flv_stream, fetch_room_data, normalize_douyin_live_id, DouyinRoomData,
    DEFAULT_USER_AGENT,
};
use crate::proxy::ProxyServerHandle;
use crate::StreamUrlStore;
use regex::Regex;
use reqwest::header::{HeaderMap, HeaderValue, REFERER, USER_AGENT};
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::platforms::common::errors::DtvError;

const QUALITY_OD: &str = "OD";
const QUALITY_BD: &str = "BD";
const QUALITY_UHD: &str = "UHD";

pub async fn get_douyin_live_stream_url_with_quality(
    _app_handle: AppHandle,
    _stream_url_store: State<'_, StreamUrlStore>,
    _proxy_server_handle: State<'_, ProxyServerHandle>,
    payload: GetStreamUrlPayload,
    quality: String,
) -> Result<CommonLiveStreamInfo, DtvError> {
    let requested_id = payload.args.room_id_str.trim().to_string();
    if requested_id.is_empty() {
        return Ok(CommonLiveStreamInfo {
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

    tracing::debug!(
        "[Douyin Stream Detail] Fetching stream for '{}' with requested quality '{}'",
        requested_id, quality
    );

    let http_client = HttpClient::new_direct_connection()
        .map_err(|e| DtvError::internal(format!("Failed to create direct connection HttpClient: {}", e)))?;

    let normalized_id = normalize_douyin_live_id(&requested_id);
    let DouyinRoomData { mut room } = fetch_room_data(&http_client, &normalized_id, None, true).await?;
    let origin_from_html = fetch_origin_flv_from_live_page(&http_client, &normalized_id)
        .await
        .unwrap_or_else(|err| {
            tracing::warn!(
                "[Douyin Stream Detail] Failed to fetch live page for origin stream: {}",
                err
            );
            None
        });
    if let Some(url) = origin_from_html.as_deref() {
        insert_origin_flv(&mut room, url);
    }
    let web_rid = extract_web_rid(&room).unwrap_or_else(|| normalized_id.clone());
    let status = room
        .get("status")
        .and_then(|v| v.as_i64())
        .unwrap_or_default() as i32;
    let title = room
        .get("title")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let anchor_name = extract_anchor_name(&room);
    let avatar = extract_avatar(&room);
    let available_streams = collect_available_streams(&room);

    if status != 2 {
        println!(
            "[Douyin Stream Detail] Room '{}' is not live (status={}). Returning metadata only.",
            web_rid, status
        );
        return Ok(CommonLiveStreamInfo {
            title,
            anchor_name,
            avatar,
            stream_url: None,
            status: Some(status),
            error_message: None,
            upstream_url: None,
            available_streams: available_streams.clone(),
            normalized_room_id: None,
            web_rid: Some(web_rid),
        });
    }

    let target_quality = normalize_quality_tag(&quality);
    let selected = pick_douyin_flv_by_quality(&room, target_quality, origin_from_html.as_deref())
        .or_else(|| choose_flv_stream(&room, target_quality))
        .or_else(|| first_flv_stream(&room))
        .ok_or_else(|| {
            DtvError::api("[Douyin Stream Detail] No FLV streams available in stream_url.flv_pull_url".to_string())
        })?;
    let (selected_key, real_url) = selected;
    tracing::debug!(
        "[Douyin Stream Detail] Selected FLV stream key='{}' url='{}'",
        selected_key, real_url
    );

    let sanitized_url = enforce_https(&real_url);

    Ok(CommonLiveStreamInfo {
        title,
        anchor_name,
        avatar,
        stream_url: Some(sanitized_url.clone()),
        status: Some(status),
        error_message: None,
        upstream_url: Some(sanitized_url),
        available_streams,
        normalized_room_id: None,
        web_rid: Some(web_rid),
    })
}

fn normalize_quality_tag(input: &str) -> &str {
    match input.trim().to_uppercase().as_str() {
        "OD" => QUALITY_OD,
        "BD" => QUALITY_BD,
        "UHD" => QUALITY_UHD,
        _ => QUALITY_OD,
    }
}

pub(crate) fn extract_web_rid(room: &Value) -> Option<String> {
    room.get("owner")
        .and_then(|o| o.get("web_rid"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            room.get("anchor")
                .and_then(|a| a.get("web_rid"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .or_else(|| {
            room.get("web_rid")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
}

pub(crate) fn extract_anchor_name(room: &Value) -> Option<String> {
    room.get("anchor_name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            room.get("owner")
                .and_then(|o| o.get("nickname"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .or_else(|| {
            room.get("anchor")
                .and_then(|a| a.get("nickname"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
}

fn enforce_https(url: &str) -> String {
    if url.starts_with("https://") {
        url.to_string()
    } else if url.starts_with("http://") {
        format!("https://{}", &url["http://".len()..])
    } else {
        url.to_string()
    }
}

pub(crate) fn extract_avatar(room: &Value) -> Option<String> {
    room.get("owner")
        .and_then(|o| o.get("avatar_thumb"))
        .and_then(|thumb| thumb.get("url_list"))
        .and_then(|list| list.get(0))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            room.get("anchor")
                .and_then(|a| a.get("avatar_thumb"))
                .and_then(|thumb| thumb.get("url_list"))
                .and_then(|list| list.get(0))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
}

pub(crate) fn collect_available_streams(room: &Value) -> Option<Vec<StreamVariant>> {
    let flv_map = room
        .get("stream_url")
        .and_then(|v| v.get("flv_pull_url"))
        .and_then(|v| v.as_object())?;
    let variants = flv_map
        .iter()
        .filter_map(|(k, v)| {
            v.as_str().map(|url| StreamVariant {
                url: url.to_string(),
                format: Some("flv".to_string()),
                desc: Some(k.to_string()),
                qn: None,
                protocol: url.split(':').next().map(|s| s.to_string()),
            })
        })
        .collect::<Vec<_>>();
    if variants.is_empty() {
        None
    } else {
        Some(variants)
    }
}

fn first_flv_stream(room: &Value) -> Option<(String, String)> {
    let flv_map = room
        .get("stream_url")
        .and_then(|v| v.get("flv_pull_url"))
        .and_then(|v| v.as_object())?;
    flv_map
        .iter()
        .find_map(|(k, v)| v.as_str().map(|url| (k.to_string(), url.to_string())))
}

fn pick_douyin_flv_by_quality(
    room: &Value,
    target_quality: &str,
    origin_override: Option<&str>,
) -> Option<(String, String)> {
    let flv_map = room
        .get("stream_url")
        .and_then(|v| v.get("flv_pull_url"))
        .and_then(|v| v.as_object())?;

    let origin_url = origin_override
        .or_else(|| flv_map.get("ORIGIN").and_then(|v| v.as_str()));
    let full_hd1 = flv_map.get("FULL_HD1").and_then(|v| v.as_str());
    let hd1 = flv_map.get("HD1").and_then(|v| v.as_str());
    let sd_fallback = flv_map
        .get("SD1")
        .and_then(|v| v.as_str())
        .or_else(|| flv_map.get("SD2").and_then(|v| v.as_str()));

    match target_quality {
        QUALITY_OD => origin_url
            .map(|u| ("ORIGIN".to_string(), u.to_string()))
            .or_else(|| full_hd1.map(|u| ("FULL_HD1".to_string(), u.to_string()))),
        QUALITY_UHD => {
            if origin_url.is_some() {
                full_hd1.map(|u| ("FULL_HD1".to_string(), u.to_string()))
            } else {
                hd1.map(|u| ("HD1".to_string(), u.to_string()))
            }
        }
        QUALITY_BD => hd1
            .map(|u| ("HD1".to_string(), u.to_string()))
            .or_else(|| sd_fallback.map(|u| ("SD1".to_string(), u.to_string()))),
        _ => None,
    }
}

fn insert_origin_flv(room: &mut Value, origin_url: &str) {
    let Some(stream_url) = room.get_mut("stream_url") else {
        return;
    };
    let flv_map_val = stream_url.get_mut("flv_pull_url");
    match flv_map_val {
        Some(map_val) if map_val.is_object() => {
            if let Some(map) = map_val.as_object_mut() {
                map.insert("ORIGIN".to_string(), Value::String(origin_url.to_string()));
            }
        }
        _ => {
            let mut new_map = serde_json::Map::new();
            new_map.insert("ORIGIN".to_string(), Value::String(origin_url.to_string()));
            stream_url.as_object_mut().map(|obj| {
                obj.insert("flv_pull_url".to_string(), Value::Object(new_map))
            });
        }
    }
}

async fn fetch_origin_flv_from_live_page(
    http_client: &HttpClient,
    web_id: &str,
) -> Result<Option<String>, String> {
    let url = format!("https://live.douyin.com/{}", web_id);
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(DEFAULT_USER_AGENT));
    headers.insert(
        REFERER,
        HeaderValue::from_str(&url).map_err(|e| format!("Invalid Referer header: {}", e))?,
    );

    let html = http_client
        .get_text_with_headers(&url, Some(headers))
        .await?;
    Ok(extract_origin_flv_from_html(&html))
}

fn extract_origin_flv_from_html(html: &str) -> Option<String> {
    let re = Regex::new(r#"https?://[^"'\s]*stream-\d+\.flv[^"'\s]*"#).ok()?;
    for m in re.find_iter(html) {
        let mut url = unescape_js_escapes(m.as_str());
        url = url.replace("&amp;", "&");
        let host = url
            .split("://")
            .nth(1)
            .and_then(|rest| rest.split('/').next())
            .unwrap_or("");
        if !url.contains("_uhd.flv")
            && !url.contains("only_audio=1")
            && !url.contains("pull-hs")
            && !url.contains("wsSecret")
            && host.contains("flv")
        {
            return Some(url);
        }
    }
    None
}

fn unescape_js_escapes(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.peek() {
                Some('u') => {
                    chars.next();
                    let mut hex = String::new();
                    for _ in 0..4 {
                        if let Some(h) = chars.next() {
                            hex.push(h);
                        } else {
                            break;
                        }
                    }
                    if let Ok(code) = u16::from_str_radix(&hex, 16) {
                        if let Some(decoded) = char::from_u32(code as u32) {
                            out.push(decoded);
                            continue;
                        }
                    }
                    out.push('\\');
                    out.push('u');
                    out.push_str(&hex);
                }
                Some('/') => {
                    chars.next();
                    out.push('/');
                }
                Some('\\') => {
                    chars.next();
                    out.push('\\');
                }
                Some('"') => {
                    chars.next();
                    out.push('"');
                }
                Some('\'') => {
                    chars.next();
                    out.push('\'');
                }
                Some('n') => {
                    chars.next();
                    out.push('\n');
                }
                Some('r') => {
                    chars.next();
                    out.push('\r');
                }
                Some('t') => {
                    chars.next();
                    out.push('\t');
                }
                _ => out.push(ch),
            }
        } else {
            out.push(ch);
        }
    }
    out
}
