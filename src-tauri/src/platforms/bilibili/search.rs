use once_cell::sync::Lazy;
use regex::Regex;
use reqwest::header::{COOKIE, REFERER, USER_AGENT};
use serde::Serialize;
use serde_json::Value;

const DEFAULT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const LIVE_REFERER: &str = "https://live.bilibili.com/";
const SEARCH_ENDPOINT: &str = "https://api.bilibili.com/x/web-interface/search/type";
const FINGERPRINT_ENDPOINT: &str = "https://api.bilibili.com/x/frontend/finger/spi";

static EM_TAG_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)</?em[^>]*>").unwrap());

#[derive(Debug, Serialize)]
pub struct BilibiliSearchItem {
    pub room_id: String,
    pub title: String,
    pub cover: String,
    pub anchor: String,
    pub avatar: String,
    pub watching: String,
    pub area: String,
    pub is_live: bool,
}

fn strip_em_tags(input: &str) -> String {
    EM_TAG_PATTERN.replace_all(input, "").to_string()
}

fn normalize_image(raw: Option<&str>) -> String {
    let Some(url) = raw else {
        return String::new();
    };
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let full = if trimmed.starts_with("http") {
        trimmed.to_string()
    } else {
        format!("https:{}", trimmed)
    };
    if full.contains('@') {
        full
    } else {
        format!("{}@400w.jpg", full)
    }
}

fn parse_cookie_pairs(cookie: &str) -> Vec<(String, String)> {
    cookie
        .split(';')
        .filter_map(|segment| {
            let trimmed = segment.trim();
            if trimmed.is_empty() {
                return None;
            }
            let mut parts = trimmed.splitn(2, '=');
            let key = parts.next()?.trim();
            let value = parts.next().unwrap_or("").trim();
            Some((key.to_string(), value.to_string()))
        })
        .collect()
}

fn find_cookie<'a>(cookies: &'a [(String, String)], key: &str) -> Option<&'a str> {
    cookies
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .map(|(_, v)| v.as_str())
}

fn upsert_cookie(cookies: &mut Vec<(String, String)>, key: &str, value: &str) {
    if let Some(slot) = cookies
        .iter_mut()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
    {
        slot.0 = key.to_string();
        slot.1 = value.to_string();
    } else {
        cookies.push((key.to_string(), value.to_string()));
    }
}

fn build_cookie_header(cookies: &[(String, String)]) -> String {
    cookies
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join("; ")
}

async fn ensure_buvid(client: &reqwest::Client, cookie_header: &mut String) -> Result<(), String> {
    let mut cookies = parse_cookie_pairs(cookie_header);
    let has_buvid3 = find_cookie(&cookies, "buvid3").is_some();
    let has_buvid4 = find_cookie(&cookies, "buvid4").is_some();

    if has_buvid3 && has_buvid4 {
        return Ok(());
    }

    let mut request = client
        .get(FINGERPRINT_ENDPOINT)
        .header(USER_AGENT, DEFAULT_UA)
        .header(REFERER, LIVE_REFERER);

    if !cookie_header.trim().is_empty() {
        request = request.header(COOKIE, cookie_header.as_str());
    }

    let resp = request
        .send()
        .await
        .map_err(|e| format!("Failed to fetch fingerprint: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Fingerprint status error: {}", e))?;

    let payload: Value = resp
        .json()
        .await
        .map_err(|e| format!("Fingerprint JSON parse error: {}", e))?;

    if let Some(data) = payload.get("data") {
        if let Some(b3) = data.get("b_3").and_then(|v| v.as_str()) {
            if !b3.is_empty() {
                upsert_cookie(&mut cookies, "buvid3", b3);
            }
        }
        if let Some(b4) = data.get("b_4").and_then(|v| v.as_str()) {
            if !b4.is_empty() {
                upsert_cookie(&mut cookies, "buvid4", b4);
            }
        }
    }

    *cookie_header = build_cookie_header(&cookies);
    Ok(())
}

#[tauri::command]
pub async fn search_bilibili_rooms(
    keyword: String,
    page: Option<u32>,
    cookie: Option<String>,
) -> Result<Vec<BilibiliSearchItem>, String> {
    let trimmed = keyword.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    let mut cookie_header = cookie.unwrap_or_default();

    let client = reqwest::Client::builder()
        .http1_only()
        .connect_timeout(std::time::Duration::from_secs(15))
        .no_proxy()
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;

    let _ = ensure_buvid(&client, &mut cookie_header).await;

    let mut req = client
        .get(SEARCH_ENDPOINT)
        .header(USER_AGENT, DEFAULT_UA)
        .header(REFERER, LIVE_REFERER)
        .query(&[
            ("context", ""),
            ("search_type", "live"),
            ("cover_type", "user_cover"),
            ("order", ""),
            ("keyword", trimmed),
            ("category_id", ""),
            ("__refresh__", ""),
            ("_extra", ""),
            ("highlight", "0"),
            ("single_column", "0"),
            ("page", &page.unwrap_or(1).to_string()),
        ]);

    if !cookie_header.trim().is_empty() {
        req = req.header(COOKIE, cookie_header);
    }

    let payload: Value = req
        .send()
        .await
        .map_err(|e| format!("Bilibili search request error: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Bilibili search status error: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse bilibili search JSON: {}", e))?;

    if payload.get("code").and_then(|v| v.as_i64()).unwrap_or(-1) != 0 {
        let msg = payload
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(format!("Bilibili search failed: {}", msg));
    }

    let mut result = Vec::new();
    if let Some(live_users) = payload
        .get("data")
        .and_then(|v| v.get("result"))
        .and_then(|v| v.get("live_user"))
        .and_then(|v| v.as_array())
    {
        result.reserve(live_users.len());
        for entry in live_users {
            let room_id = entry
                .get("roomid")
                .and_then(|v| v.as_i64())
                .map(|v| v.to_string())
                .unwrap_or_default();
            let title = entry
                .get("title")
                .and_then(|v| v.as_str())
                .map(strip_em_tags)
                .unwrap_or_default();
            let cover = normalize_image(entry.get("cover").and_then(|v| v.as_str()));
            let avatar = normalize_image(entry.get("uface").and_then(|v| v.as_str()));
            let anchor = entry
                .get("uname")
                .and_then(|v| v.as_str())
                .map(strip_em_tags)
                .unwrap_or_default();
            let watching = entry
                .get("online")
                .map(|v| match v {
                    Value::String(s) => s.clone(),
                    Value::Number(num) => num.to_string(),
                    _ => String::new(),
                })
                .unwrap_or_default();
            let area = entry
                .get("cate_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let is_live = entry
                .get("live_status")
                .and_then(|v| v.as_i64())
                .unwrap_or(0)
                == 1;

            result.push(BilibiliSearchItem {
                room_id,
                title,
                cover,
                anchor,
                avatar,
                watching,
                area,
                is_live,
            });
        }
    }

    Ok(result)
}
