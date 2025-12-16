use std::collections::HashMap;
use std::error::Error;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose, Engine as _};
use md5::{Digest, Md5};
use rand::Rng;
use regex::Regex;
use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, COOKIE, ORIGIN, REFERER, USER_AGENT,
};
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::platforms::common::FollowHttpClient;

const IOS_MOBILE_UA: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const DESKTOP_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0";

#[derive(Clone, Debug, Serialize)]
#[allow(non_snake_case)]
pub struct HuyaUnifiedStreamEntry {
    pub quality: String,
    pub bitRate: i32,
    pub url: String,
}

#[derive(Clone, Debug, Serialize)]
#[allow(non_snake_case)]
pub struct HuyaUnifiedResponse {
    pub title: Option<String>,
    pub nick: Option<String>,
    pub avatar: Option<String>,
    pub introduction: Option<String>,
    pub profileRoom: Option<String>,
    pub is_live: bool,
    pub flv_tx_urls: Vec<HuyaUnifiedStreamEntry>,
    pub selected_url: Option<String>,
}

fn md5_hex(input: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(input.as_bytes());
    let digest = hasher.finalize();
    format!("{:x}", digest)
}

fn current_millis() -> i64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0));
    now.as_millis() as i64
}

fn parse_query(qs: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for (k, v) in url::form_urlencoded::parse(qs.as_bytes()) {
        map.insert(k.into_owned(), v.into_owned());
    }
    map
}

fn url_decode(s: &str) -> String {
    url::form_urlencoded::parse(format!("a={}", s).as_bytes())
        .find(|(k, _)| k == "a")
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| s.to_string())
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

fn generate_web_anti_code(stream_name: &str, anti_code: &str) -> Result<String, String> {
    let sanitized = anti_code.replace("&amp;", "&");
    let trimmed = sanitized.trim_start_matches(|c| c == '?' || c == '&');
    let params = parse_query(trimmed);

    let fm_value = params
        .get("fm")
        .cloned()
        .ok_or_else(|| "missing fm in anti code".to_string())?;
    let ctype = params
        .get("ctype")
        .cloned()
        .ok_or_else(|| "missing ctype in anti code".to_string())?;
    let fs = params
        .get("fs")
        .cloned()
        .ok_or_else(|| "missing fs in anti code".to_string())?;

    let fm_decoded = url_decode(&fm_value);
    let fm_bytes = general_purpose::STANDARD
        .decode(fm_decoded.as_bytes())
        .map_err(|_| "failed to decode fm base64".to_string())?;
    let fm_plain =
        String::from_utf8(fm_bytes).map_err(|_| "failed to decode fm utf-8".to_string())?;
    let ws_prefix = fm_plain
        .split('_')
        .next()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "failed to derive wsSecret prefix".to_string())?;

    let params_t = 100_i64;
    let sdk_version = 2403051612_i64;
    let t13 = current_millis();
    let sdk_sid = t13;

    let mut rng = rand::thread_rng();
    let uid = rng.gen_range(1_400_000_000_000_i64..=1_400_009_999_999_i64);
    let seq_id = uid + sdk_sid;

    let ws_time = format!("{:x}", (t13 + 110_624) / 1000);

    let uuid_seed = (t13 % 10_000_000_000_i64) * 1_000 + rng.gen_range(0_i64..1_000_i64);
    let init_uuid = uuid_seed % 4_294_967_295_i64;

    let ws_secret_hash = md5_hex(&format!("{}|{}|{}", seq_id, ctype, params_t));
    let ws_secret_plain = format!(
        "{}_{}_{}_{}_{}",
        ws_prefix, uid, stream_name, ws_secret_hash, ws_time
    );
    let ws_secret_md5 = md5_hex(&ws_secret_plain);

    let parts = vec![
        ("wsSecret", ws_secret_md5),
        ("wsTime", ws_time),
        ("seqid", seq_id.to_string()),
        ("ctype", ctype),
        ("ver", "1".to_string()),
        ("fs", fs),
        ("uuid", init_uuid.to_string()),
        ("u", uid.to_string()),
        ("t", params_t.to_string()),
        ("sv", sdk_version.to_string()),
        ("sdk_sid", sdk_sid.to_string()),
        ("codec", "264".to_string()),
    ];

    Ok(parts
        .into_iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<String>>()
        .join("&"))
}

#[allow(dead_code)]
async fn check_live_status(
    client: &reqwest::Client,
    room_id: &str,
) -> Result<bool, Box<dyn Error + Send + Sync>> {
    let url = format!("https://m.huya.com/{}", room_id);
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.0.0 Safari/537.36"));

    let resp = client.get(&url).headers(headers).send().await?;
    let text = resp.text().await?;

    let re = Regex::new(r"window\\.HNF_GLOBAL_INIT.=.\{(.*?)\}\s*</script>").unwrap();
    if let Some(caps) = re.captures(&text) {
        let inner = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let json_str = format!("{{{}}}", inner);
        let v: Value = serde_json::from_str(&json_str)?;
        let status = v
            .get("roomInfo")
            .and_then(|x| x.get("eLiveStatus"))
            .and_then(|x| x.as_i64())
            .unwrap_or(0);
        return Ok(status == 2);
    }
    Ok(false)
}

#[derive(Clone, Debug)]
struct RoomDetail {
    status: bool,
    title: Option<String>,
    nick: Option<String>,
    avatar180: Option<String>,
}

#[derive(Clone, Debug)]
struct WebStreamCandidate {
    base_flv: String,
    cdn: String,
}

#[derive(Clone, Debug)]
struct HuyaWebStreamData {
    is_live: bool,
    candidates: Vec<WebStreamCandidate>,
}

async fn fetch_room_detail(
    client: &reqwest::Client,
    room_id: &str,
) -> Result<RoomDetail, Box<dyn Error + Send + Sync>> {
    let url = format!(
        "https://mp.huya.com/cache.php?m=Live&do=profileRoom&roomid={}&showSecret=1",
        room_id
    );
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
    headers.insert(ORIGIN, HeaderValue::from_static("https://m.huya.com"));
    headers.insert(REFERER, HeaderValue::from_static("https://m.huya.com/"));
    headers.insert(USER_AGENT, HeaderValue::from_static(IOS_MOBILE_UA));

    let resp = client.get(&url).headers(headers).send().await?;
    let text = resp.text().await?;
    let v: Value = serde_json::from_str(&text)?;

    let status_code = v.get("status").and_then(|x| x.as_i64()).unwrap_or(0);
    if status_code != 200 {
        return Ok(RoomDetail {
            status: false,
            title: None,
            nick: None,
            avatar180: None,
        });
    }

    let Some(data) = v.get("data") else {
        return Ok(RoomDetail {
            status: false,
            title: None,
            nick: None,
            avatar180: None,
        });
    };

    let stream_ok = data.get("stream").is_some();

    let title = data
        .get("liveData")
        .and_then(|ld| ld.get("introduction"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let nick = data
        .get("liveData")
        .and_then(|ld| ld.get("nick"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let avatar180 = data
        .get("liveData")
        .and_then(|ld| ld.get("avatar180"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());

    Ok(RoomDetail {
        status: stream_ok,
        title,
        nick,
        avatar180,
    })
}

async fn fetch_web_stream_data(
    client: &reqwest::Client,
    room_id: &str,
) -> Result<HuyaWebStreamData, Box<dyn Error + Send + Sync>> {
    // Prefer desktop headers directly to avoid mobile UA quirks.
    fetch_web_stream_data_with_headers(client, room_id, false).await
}

async fn fetch_web_stream_data_with_headers(
    client: &reqwest::Client,
    room_id: &str,
    use_mobile_headers: bool,
) -> Result<HuyaWebStreamData, Box<dyn Error + Send + Sync>> {
    let url = format!("https://www.huya.com/{}", room_id);
    let mut headers = HeaderMap::new();
    if use_mobile_headers {
        headers.insert(USER_AGENT, HeaderValue::from_static(IOS_MOBILE_UA));
        headers.insert(
            ACCEPT,
            HeaderValue::from_static("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
        );
        headers.insert(
            REFERER,
            HeaderValue::from_static("https://m.huya.com/"),
        );
    } else {
        headers.insert(USER_AGENT, HeaderValue::from_static(DESKTOP_UA));
        headers.insert(
            ACCEPT,
            HeaderValue::from_static(
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            ),
        );
        headers.insert(
            REFERER,
            HeaderValue::from_static("https://www.huya.com/"),
        );
    }
    headers.insert(
        ACCEPT_LANGUAGE,
        HeaderValue::from_static("zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2"),
    );
    headers.insert(
        COOKIE,
        HeaderValue::from_static("huya_ua=webh5&0.1.0&websocket; game_did=zXyXVqV1NF4ZeNWg7QaOFbpIEWqcsrxkoVy; alphaValue=0.80; guid=0a7df378828609654d01a205a305fb52; __yamid_tt1=0.8936157401010706; __yamid_new=CA715E8BC9400001E5A313E028F618DE; udb_guiddata=4657813d32ce43d381ea8ff8d416a3c2; udb_deviceid=w_756598227007868928; sdid=0UnHUgv0_qmfD4KAKlwzhqQB32nywGZJYLZl_9RLv0Lbi5CGYYNiBGLrvNZVszz4FEo_unffNsxk9BdvXKO_PkvC5cOwCJ13goOiNYGClLirWVkn9LtfFJw_Qo4kgKr8OZHDqNnuwg612sGyflFn1draukOt03gk2m3pwGbiKsB143MJhMxcI458jIjiX0MYq; Hm_lvt_51700b6c722f5bb4cf39906a596ea41f=1708583696; SoundValue=0.50; sdidtest=0UnHUgv0_qmfD4KAKlwzhqQB32nywGZJYLZl_9RLv0Lbi5CGYYNiBGLrvNZVszz4FEo_unffNsxk9BdvXKO_PkvC5cOwCJ13goOiNYGClLirWVkn9LtfFJw_Qo4kgKr8OZHDqNnuwg612sGyflFn1draukOt03gk2m3pwGbiKsB143MJhMxcI458jIjiX0MYq; sdidshorttest=test; __yasmid=0.8936157401010706; _yasids=__rootsid%3DCAA3838C53600001F4EE863017406250; huyawap_rep_cnt=4; udb_passdata=3; huya_web_rep_cnt=89; huya_flash_rep_cnt=20; Hm_lpvt_51700b6c722f5bb4cf39906a596ea41f=1709548534; _rep_cnt=3; PHPSESSID=r0klm0vccf08q1das65bnd8co1; huya_hd_rep_cnt=8"),
    );

    let resp = client.get(&url).headers(headers).send().await?;
    let html = resp.text().await?;

    let re = Regex::new(r#"(?s)stream:\s*(\{"data".*?),"iWebDefaultBitRate""#)?;
    let Some(caps) = re.captures(&html) else {
        return Ok(HuyaWebStreamData {
            is_live: false,
            candidates: Vec::new(),
        });
    };
    let json_fragment = caps.get(1).map(|m| m.as_str()).unwrap_or("");
    let json_str = format!("{}{}", json_fragment, "}");
    let value: Value = serde_json::from_str(&json_str)?;

    let data_list = match value.get("data").and_then(|v| v.as_array()) {
        Some(list) if !list.is_empty() => list,
        _ => {
            return Ok(HuyaWebStreamData {
                is_live: false,
                candidates: Vec::new(),
            })
        }
    };
    let stream_info_list = match data_list[0]
        .get("gameStreamInfoList")
        .and_then(|v| v.as_array())
    {
        Some(list) if !list.is_empty() => list.clone(),
        _ => {
            return Ok(HuyaWebStreamData {
                is_live: false,
                candidates: Vec::new(),
            })
        }
    };

    let mut stream_items = stream_info_list;
    stream_items.sort_by_key(|item| {
        let cdn = item
            .get("sCdnType")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        cdn_priority(cdn)
    });

    let mut candidates: Vec<WebStreamCandidate> = Vec::new();
    for item in stream_items {
        let cdn = item
            .get("sCdnType")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let flv_url = item
            .get("sFlvUrl")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let stream_name = item
            .get("sStreamName")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let flv_suffix = item
            .get("sFlvUrlSuffix")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let anti_code = item
            .get("sFlvAntiCode")
            .and_then(|v| v.as_str())
            .unwrap_or_default();

        if flv_url.is_empty()
            || stream_name.is_empty()
            || flv_suffix.is_empty()
            || anti_code.is_empty()
        {
            continue;
        }

        let anti_params = match generate_web_anti_code(stream_name, anti_code) {
            Ok(v) => v,
            Err(err) => return Err(format!("failed to generate Huya anti code: {err}").into()),
        };

        let base_flv = enforce_https(&format!(
            "{}/{}.{}?{}",
            flv_url, stream_name, flv_suffix, anti_params
        ));
        candidates.push(WebStreamCandidate { base_flv, cdn });
    }

    let candidates = prioritize_candidates(candidates);

    Ok(HuyaWebStreamData {
        is_live: !candidates.is_empty(),
        candidates,
    })
}

fn cdn_priority(cdn: &str) -> usize {
    if cdn.eq_ignore_ascii_case("tx") {
        0
    } else if cdn.eq_ignore_ascii_case("al") {
        1
    } else if cdn.eq_ignore_ascii_case("hs") {
        2
    } else {
        3
    }
}

fn is_flv_url(url: &str) -> bool {
    url.to_ascii_lowercase().contains(".flv")
}

fn adjust_tx_stream_url(url: &str, cdn: &str) -> String {
    if cdn.eq_ignore_ascii_case("tx") {
        let replaced_ctype = url.replace("&ctype=tars_mp", "&ctype=huya_webh5");
        let replaced_fs = replaced_ctype.replace("&fs=bhct", "&fs=bgct");
        enforce_https(&replaced_fs)
    } else {
        enforce_https(url)
    }
}

fn normalize_huya_line(input: Option<&str>) -> Option<String> {
    input
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| matches!(s.as_str(), "tx" | "al" | "hs"))
}

fn prioritize_candidates(candidates: Vec<WebStreamCandidate>) -> Vec<WebStreamCandidate> {
    if candidates.is_empty() {
        return candidates;
    }

    let mut huya_domain: Vec<WebStreamCandidate> = Vec::new();
    let mut other_flv: Vec<WebStreamCandidate> = Vec::new();
    let mut remaining: Vec<WebStreamCandidate> = Vec::new();

    for candidate in candidates {
        let lower = candidate.base_flv.to_ascii_lowercase();
        let has_huya = lower.contains("huya.com");
        let flv = lower.contains(".flv");

        if has_huya && flv {
            huya_domain.push(candidate);
        } else if flv {
            other_flv.push(candidate);
        } else {
            remaining.push(candidate);
        }
    }

    if !huya_domain.is_empty() {
        let mut result = huya_domain;
        result.extend(other_flv);
        result.extend(remaining);
        return result;
    }

    if !other_flv.is_empty() {
        let mut result = other_flv;
        result.extend(remaining);
        return result;
    }

    remaining
}

fn resolve_ratio(quality: Option<&str>) -> Option<i32> {
    if let Some(q) = quality {
        let trimmed = q.trim();
        let lower = trimmed.to_ascii_lowercase();
        if trimmed.contains("标清") || lower == "sd" || lower == "ld" || lower == "2000" {
            return Some(2000);
        }
        if trimmed.contains("高清") || lower == "hd" || lower == "4000" {
            return Some(4000);
        }
        if trimmed.contains("原画") || lower == "source" || lower == "uhd" {
            return None;
        }
        return Some(4000);
    }
    None
}

fn pick_stream_url(
    candidates: &[WebStreamCandidate],
    ratio: Option<i32>,
    preferred_cdn: Option<&str>,
) -> Option<(String, usize)> {
    if candidates.is_empty() {
        return None;
    }

    let preferred_index = preferred_cdn.and_then(|target| {
        candidates
            .iter()
            .position(|c| c.cdn.eq_ignore_ascii_case(target))
    });

    let candidate_index = preferred_index.unwrap_or(0);
    let candidate = candidates.get(candidate_index)?;
    let adjusted_base = adjust_tx_stream_url(&candidate.base_flv, &candidate.cdn);
    if let Some(r) = ratio {
        if is_flv_url(&adjusted_base) {
            Some((format!("{}&ratio={}", adjusted_base, r), candidate_index))
        } else {
            Some((adjusted_base, candidate_index))
        }
    } else {
        Some((adjusted_base, candidate_index))
    }
}

fn build_flv_tx_urls(candidate: Option<&WebStreamCandidate>) -> Vec<HuyaUnifiedStreamEntry> {
    let Some(base) = candidate else {
        return Vec::new();
    };

    let mut entries = Vec::new();
    let adjusted_base = adjust_tx_stream_url(&base.base_flv, &base.cdn);
    entries.push(HuyaUnifiedStreamEntry {
        quality: "原画".to_string(),
        bitRate: 0,
        url: adjusted_base.clone(),
    });

    if is_flv_url(&adjusted_base) {
        entries.push(HuyaUnifiedStreamEntry {
            quality: "高清".to_string(),
            bitRate: 4000,
            url: format!("{}&ratio={}", adjusted_base, 4000),
        });
        entries.push(HuyaUnifiedStreamEntry {
            quality: "标清".to_string(),
            bitRate: 2000,
            url: format!("{}&ratio={}", adjusted_base, 2000),
        });
    }

    entries
}

#[tauri::command]
pub async fn get_huya_unified_cmd(
    room_id: String,
    quality: Option<String>,
    line: Option<String>,
    follow_http: State<'_, FollowHttpClient>,
) -> Result<HuyaUnifiedResponse, String> {
    let client = &follow_http.0.inner;

    let detail = fetch_room_detail(client, &room_id)
        .await
        .map_err(|e| e.to_string())?;

    let web_stream = fetch_web_stream_data(client, &room_id)
        .await
        .map_err(|e| e.to_string())?;

    let ratio = resolve_ratio(quality.as_deref());
    let preferred_line = normalize_huya_line(line.as_deref());
    let selection = pick_stream_url(&web_stream.candidates, ratio, preferred_line.as_deref());
    let (selected_url, selected_index) = match selection {
        Some(value) => value,
        None => {
            return Ok(HuyaUnifiedResponse {
                title: detail.title.clone(),
                nick: detail.nick.clone(),
                avatar: detail.avatar180.clone(),
                introduction: None,
                profileRoom: None,
                is_live: detail.status || web_stream.is_live,
                flv_tx_urls: Vec::new(),
                selected_url: None,
            });
        }
    };
    let tx_entries = build_flv_tx_urls(web_stream.candidates.get(selected_index));
    let is_live = detail.status || web_stream.is_live;
    println!(
        "[Huya] requested quality: {:?}, resolved ratio: {:?}, preferred line: {:?}, selected line: {:?}",
        quality,
        ratio,
        preferred_line,
        web_stream
            .candidates
            .get(selected_index)
            .map(|c| c.cdn.clone())
    );

    Ok(HuyaUnifiedResponse {
        title: detail.title.clone(),
        nick: detail.nick.clone(),
        avatar: detail.avatar180.clone(),
        introduction: None,
        profileRoom: None,
        is_live,
        flv_tx_urls: tx_entries,
        selected_url: Some(selected_url),
    })
}
#[allow(dead_code)]
const HEARTBEAT_BASE64: &str = "ABQdAAwsNgBM"; // same as Python
