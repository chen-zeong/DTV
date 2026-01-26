use html_escape::decode_html_entities;
use reqwest::{
    header::{HeaderMap, HeaderValue},
    redirect::Policy,
    Client,
};
use serde::Deserialize;
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::platforms::douyu::sign_worker;

use crate::platforms::common::errors::DtvError;

#[derive(Deserialize, Debug)]
struct BetardRoomInfo {
    room_id: Option<Value>,
    show_status: Option<Value>,
}

#[derive(Deserialize, Debug)]
struct BetardResponse {
    room: Option<BetardRoomInfo>,
}

#[derive(Clone, Debug)]
struct DouyuPlayInfo {
    variants: Vec<DouyuRateVariant>,
    cdns: Vec<String>,
}

#[derive(Clone, Debug)]
struct DouyuRateVariant {
    name: String,
    rate: i32,
    bit: Option<i32>,
}

fn value_to_i32(value: &Value) -> Option<i32> {
    match value {
        Value::Number(num) => num.as_i64().map(|n| n as i32),
        Value::String(s) => s.parse::<i32>().ok(),
        _ => None,
    }
}

fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::Number(num) => Some(num.to_string()),
        Value::String(s) => Some(s.to_string()),
        _ => None,
    }
}

struct DouYu {
    did: String,
    rid: String,
    client: Client,
}

const DEFAULT_DOUYU_CDN: &str = "ws-h5";
const DEFAULT_DOUYU_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";
const DEFAULT_DOUYU_DID: &str = "10000000000000000000000000001501";

fn normalize_douyu_cdn(input: Option<&str>) -> &'static str {
    match input
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .as_deref()
    {
        Some("ws-h5") => "ws-h5",
        Some("tct-h5") => "tct-h5",
        Some("ali-h5") => "ali-h5",
        Some("hs-h5") => "hs-h5",
        _ => DEFAULT_DOUYU_CDN,
    }
}

impl DouYu {
    async fn new(rid: &str) -> Result<Self, Box<dyn std::error::Error>> {
        // 迁移到 reqwest：禁用系统代理、限制重定向、设置默认 UA/语言等头部
        let mut default_headers = HeaderMap::new();
        default_headers.insert(
            "User-Agent",
            HeaderValue::from_static(DEFAULT_DOUYU_UA),
        );
        default_headers.insert(
            "Accept-Language",
            HeaderValue::from_static("zh-CN,zh;q=0.9"),
        );
        let client = Client::builder()
            .redirect(Policy::limited(10))
            .no_proxy()
            .default_headers(default_headers)
            .build()?;

        Ok(Self {
            did: DEFAULT_DOUYU_DID.to_string(),
            rid: rid.to_string(),
            client,
        })
    }

    async fn fetch_room_detail(&self) -> Result<(String, bool), Box<dyn std::error::Error>> {
        let url = format!("https://www.douyu.com/betard/{}", self.rid);
        let json = self
            .client
            .get(url)
            .header("Referer", format!("https://www.douyu.com/{}", self.rid))
            .send()
            .await?
            .json::<BetardResponse>()
            .await?;

        let room = json.room.ok_or("Missing room data")?;
        let room_id_value = room.room_id.ok_or("Missing room_id")?;
        let room_id = value_to_string(&room_id_value).ok_or("Invalid room_id")?;
        let show_status = room
            .show_status
            .as_ref()
            .and_then(value_to_i32)
            .unwrap_or(0);
        Ok((room_id, show_status == 1))
    }

    async fn get_h5_enc(&self, room_id: &str) -> Result<String, Box<dyn std::error::Error>> {
        let url = format!("https://www.douyu.com/swf_api/homeH5Enc?rids={}", room_id);
        let json = self
            .client
            .get(url)
            .header("Referer", format!("https://www.douyu.com/{}", room_id))
            .send()
            .await?
            .json::<Value>()
            .await?;

        let error_code = json.get("error").and_then(value_to_i32).unwrap_or(-1);
        if error_code != 0 {
            return Err(format!("homeH5Enc error: {}", error_code).into());
        }

        let key = format!("room{}", room_id);
        let crptext = json
            .get("data")
            .and_then(|v| v.get(&key))
            .and_then(|v| v.as_str())
            .ok_or("Missing homeH5Enc data")?;
        Ok(crptext.to_string())
    }

    async fn build_sign_params(
        &self,
        room_id: &str,
    ) -> Result<String, Box<dyn std::error::Error>> {
        let crptext = self.get_h5_enc(room_id).await?;
        let ts = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as i64;
        let params = sign_worker::execute_js_sign(&crptext, room_id, &self.did, ts)
            .await
            .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
        Ok(params)
    }

    async fn get_play_qualities(
        &self,
        room_id: &str,
        sign_data: &str,
    ) -> Result<DouyuPlayInfo, Box<dyn std::error::Error>> {
        let payload = format!(
            "{}&cdn=&rate=-1&ver=Douyu_223061205&iar=1&ive=1&hevc=0&fa=0",
            sign_data
        );
        let url = format!("https://www.douyu.com/lapi/live/getH5Play/{}", room_id);
        let json = self
            .client
            .post(url)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(payload)
            .send()
            .await?
            .json::<Value>()
            .await?;

        let error_code = json.get("error").and_then(value_to_i32).unwrap_or(-1);
        if error_code != 0 {
            let msg = json
                .get("msg")
                .and_then(|v| v.as_str())
                .unwrap_or("getH5Play failed");
            return Err(format!("getH5Play error {}: {}", error_code, msg).into());
        }

        let data = json.get("data").ok_or("No data field in response")?;
        let cdns = data
            .get("cdnsWithName")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        item.get("cdn")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                    })
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();

        let mut cdns_sorted = cdns;
        cdns_sorted.sort_by(|a, b| {
            let a_is_scdn = a.starts_with("scdn");
            let b_is_scdn = b.starts_with("scdn");
            (a_is_scdn, a).cmp(&(b_is_scdn, b))
        });

        let variants = data
            .get("multirates")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        let name = item
                            .get("name")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())?;
                        let rate_value = item.get("rate").and_then(value_to_i32)?;
                        let bit_value = item.get("bit").and_then(value_to_i32);
                        Some(DouyuRateVariant {
                            name,
                            rate: rate_value,
                            bit: bit_value,
                        })
                    })
                    .collect::<Vec<DouyuRateVariant>>()
            })
            .unwrap_or_default();

        Ok(DouyuPlayInfo {
            variants,
            cdns: cdns_sorted,
        })
    }

    async fn get_play_url(
        &self,
        room_id: &str,
        sign_data: &str,
        rate: i32,
        cdn: &str,
    ) -> Result<String, Box<dyn std::error::Error>> {
        let payload = format!("{}&cdn={}&rate={}", sign_data, cdn, rate);
        let url = format!("https://www.douyu.com/lapi/live/getH5Play/{}", room_id);
        let json = self
            .client
            .post(url)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("Referer", format!("https://www.douyu.com/{}", room_id))
            .body(payload)
            .send()
            .await?
            .json::<Value>()
            .await?;

        let error_code = json.get("error").and_then(value_to_i32).unwrap_or(-1);
        if error_code != 0 {
            let msg = json
                .get("msg")
                .and_then(|v| v.as_str())
                .unwrap_or("getH5Play failed");
            return Err(format!("getH5Play error {}: {}", error_code, msg).into());
        }

        let data = json.get("data").ok_or("No data field in response")?;
        let rtmp_url = data
            .get("rtmp_url")
            .and_then(|v| v.as_str())
            .ok_or("No rtmp_url field")?;
        let rtmp_live = data
            .get("rtmp_live")
            .and_then(|v| v.as_str())
            .ok_or("No rtmp_live field")?;
        let rtmp_live = decode_html_entities(rtmp_live).to_string();
        Ok(format!("{}/{}", rtmp_url, rtmp_live))
    }

    fn select_cdn(requested: Option<&str>, available: &[String]) -> String {
        if let Some(cdn) = requested {
            let trimmed = cdn.trim();
            if !trimmed.is_empty() {
                let target = trimmed.to_ascii_lowercase();
                if let Some(hit) = available
                    .iter()
                    .find(|item| item.to_ascii_lowercase() == target)
                {
                    return hit.clone();
                }
            }
        }
        available
            .first()
            .cloned()
            .unwrap_or_else(|| normalize_douyu_cdn(requested).to_string())
    }

    pub async fn get_real_url_with_quality(
        &self,
        quality: &str,
        cdn: Option<&str>,
    ) -> Result<String, DtvError> {
        let (real_room_id, is_live) = self.fetch_room_detail()
            .await
            .map_err(|e| DtvError::api(e.to_string()))?;
        if !is_live {
            return Err(DtvError::offline("主播未开播"));
        }

        let sign_data = self.build_sign_params(&real_room_id)
            .await
            .map_err(|e| DtvError::api(e.to_string()))?;
        let play_info = self.get_play_qualities(&real_room_id, &sign_data)
            .await
            .map_err(|e| DtvError::api(e.to_string()))?;
        let selected_rate = Self::resolve_rate_for_quality(quality, &play_info.variants)
            .or_else(|| play_info.variants.iter().map(|v| v.rate).max())
            .unwrap_or(0);
        tracing::debug!(
            "[Douyu Stream URL] Requested quality '{}', resolved rate {} (variants: {:?})",
            quality, selected_rate, play_info.variants
        );
        let selected_cdn = Self::select_cdn(cdn, &play_info.cdns);
        self.get_play_url(&real_room_id, &sign_data, selected_rate, &selected_cdn)
            .await
            .map_err(|e| DtvError::api(e.to_string()))
    }

    fn resolve_rate_for_quality(quality: &str, variants: &[DouyuRateVariant]) -> Option<i32> {
        if variants.is_empty() {
            return None;
        }

        let trimmed = quality.trim();
        let ascii_lower = trimmed.to_ascii_lowercase();
        let canonical = if trimmed.contains('原') || ascii_lower == "origin" {
            "原画"
        } else if trimmed.contains('高') || ascii_lower == "high" {
            "高清"
        } else if trimmed.contains('标') || ascii_lower == "standard" {
            "标清"
        } else {
            trimmed
        };

        let find_by_keywords = |keywords: &[&str], exclude_zero: bool| -> Option<i32> {
            for keyword in keywords {
                if let Some(item) = variants.iter().find(|v| v.name.contains(keyword)) {
                    if exclude_zero && item.rate == 0 {
                        continue;
                    }
                    return Some(item.rate);
                }
            }
            None
        };

        match canonical {
            "原画" => {
                if let Some(item) = variants.iter().find(|v| v.rate == 0) {
                    return Some(item.rate);
                }
                if let Some(rate) = find_by_keywords(&["原画", "蓝光8M", "蓝光"], false) {
                    return Some(rate);
                }
                variants.iter().map(|v| v.rate).min()
            }
            "高清" => {
                if let Some(item) = variants.iter().find(|v| v.rate == 4) {
                    return Some(item.rate);
                }
                if let Some(rate) = find_by_keywords(&["蓝光", "蓝光4M"], false) {
                    return Some(rate);
                }
                if let Some(rate) = find_by_keywords(&["超清"], true) {
                    return Some(rate);
                }
                if let Some(rate) = find_by_keywords(&["高清"], true) {
                    return Some(rate);
                }
                variants
                    .iter()
                    .filter(|v| v.rate != 0)
                    .max_by_key(|v| v.bit.unwrap_or(0))
                    .map(|v| v.rate)
                    .or_else(|| {
                        variants
                            .iter()
                            .filter(|v| v.rate != 0)
                            .max_by_key(|v| v.rate)
                            .map(|v| v.rate)
                    })
            }
            "标清" => {
                if let Some(item) = variants.iter().find(|v| v.rate == 3) {
                    return Some(item.rate);
                }
                if let Some(rate) = find_by_keywords(&["超清"], true) {
                    return Some(rate);
                }
                if let Some(rate) = find_by_keywords(&["流畅"], true) {
                    return Some(rate);
                }
                if let Some(rate) = find_by_keywords(&["标清"], true) {
                    return Some(rate);
                }
                if let Some(rate) = find_by_keywords(&["普清"], true) {
                    return Some(rate);
                }
                variants
                    .iter()
                    .filter(|v| v.rate != 0)
                    .min_by_key(|v| v.bit.unwrap_or(i32::MAX))
                    .map(|v| v.rate)
                    .or_else(|| {
                        variants
                            .iter()
                            .filter(|v| v.rate != 0)
                            .min_by_key(|v| v.rate)
                            .map(|v| v.rate)
                    })
            }
            _ => {
                if let Some(rate) = find_by_keywords(&[canonical], false) {
                    return Some(rate);
                }
                None
            }
        }
    }
}

pub async fn get_stream_url_with_quality(
    room_id: &str,
    quality: &str,
    cdn: Option<&str>,
) -> Result<String, DtvError> {
    let douyu = DouYu::new(room_id).await.map_err(|e| DtvError::internal(e.to_string()))?;
    let url = douyu.get_real_url_with_quality(quality, cdn).await?;
    Ok(url)
}
