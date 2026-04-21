use std::collections::HashMap;
use std::collections::BTreeMap;
use std::error::Error;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose, Engine as _};
use bytes04::Bytes;
use md5::{Digest, Md5};
use rand::Rng;
use regex::Regex;
use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, ORIGIN, REFERER, USER_AGENT,
};
use serde::Serialize;
use serde_json::Value;
use tauri::State;
use tars_stream::prelude::*;

use crate::platforms::common::FollowHttpClient;

const DESKTOP_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0";
// Align with pure_live-master (HuyaSite.HYSDK_UA)
const HUYA_HYSDK_UA: &str =
    "HYSDK(Windows,30000002)_APP(pc_exe&7080000&official)_SDK(trans&2.34.0.5795)";
const HUYA_WUP_ORIGIN: &str = "https://m.huya.com/";
const HUYA_WUP_REFERER: &str = "https://m.huya.com/";

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

fn url_encode_component(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>()
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

fn rotl32_by8_in_i64(value: i64) -> i64 {
    let low = (value as u64 & 0xFFFF_FFFF) as u32;
    let rotated = low.rotate_left(8) as i64;
    let high = value & !0xFFFF_FFFFi64;
    high | rotated
}

// Align with pure_live-master: build anticode using wsTime/fm/etc from upstream token.
fn build_huya_anti_code(
    stream_name: &str,
    presenter_uid: i64,
    anti_code: &str,
) -> Result<String, String> {
    let sanitized = anti_code.replace("&amp;", "&");
    let trimmed = sanitized.trim_start_matches(|c| c == '?' || c == '&');
    let params = parse_query(trimmed);

    let Some(fm_raw) = params.get("fm").cloned() else {
        // Upstream already returned a usable query string
        return Ok(trimmed.to_string());
    };

    let ctype = params
        .get("ctype")
        .cloned()
        .unwrap_or_else(|| "huya_pc_exe".to_string());

    let platform_id: i64 = params
        .get("t")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    let is_wap = platform_id == 103;

    let calc_start_time = current_millis();
    let seq_id = presenter_uid + calc_start_time;
    let secret_hash = md5_hex(&format!("{seq_id}|{ctype}|{platform_id}"));

    let convert_uid = rotl32_by8_in_i64(presenter_uid);
    let calc_uid = if is_wap { presenter_uid } else { convert_uid };

    let fm_decoded = url_decode(&fm_raw);
    let fm_bytes = general_purpose::STANDARD
        .decode(fm_decoded.as_bytes())
        .map_err(|_| "failed to decode fm base64".to_string())?;
    let fm_plain =
        String::from_utf8(fm_bytes).map_err(|_| "failed to decode fm utf-8".to_string())?;
    let secret_prefix = fm_plain
        .split('_')
        .next()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "failed to derive wsSecret prefix".to_string())?;

    let ws_time = params
        .get("wsTime")
        .cloned()
        .ok_or_else(|| "missing wsTime in anti code".to_string())?;

    let secret_str = format!(
        "{secret_prefix}_{calc_uid}_{stream_name}_{secret_hash}_{ws_time}"
    );
    let ws_secret = md5_hex(&secret_str);

    let fs = params
        .get("fs")
        .cloned()
        .ok_or_else(|| "missing fs in anti code".to_string())?;

    let ws_time_int = i64::from_str_radix(ws_time.trim(), 16).unwrap_or(0);
    let mut rng = rand::thread_rng();
    let ct = (((ws_time_int as f64) + rng.gen::<f64>()) * 1000.0) as i64;
    let uuid = ((((ct % 10_000_000_000i64) as f64) + rng.gen::<f64>()) * 1000.0
        % (0xFFFF_FFFFu64 as f64)) as u32;

    let mut parts = Vec::<(String, String)>::new();
    parts.push(("wsSecret".to_string(), ws_secret));
    parts.push(("wsTime".to_string(), ws_time));
    parts.push(("seqid".to_string(), seq_id.to_string()));
    parts.push(("ctype".to_string(), ctype));
    parts.push(("ver".to_string(), "1".to_string()));
    parts.push(("fs".to_string(), fs));
    // Keep fm encoded like pure_live-master does.
    parts.push(("fm".to_string(), url_encode_component(&fm_raw)));
    parts.push(("t".to_string(), platform_id.to_string()));

    if is_wap {
        parts.push(("uid".to_string(), presenter_uid.to_string()));
        parts.push(("uuid".to_string(), uuid.to_string()));
    } else {
        parts.push(("u".to_string(), convert_uid.to_string()));
    }

    Ok(parts
        .into_iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&"))
}

#[derive(Clone, Debug, Default)]
struct HuyaUserId {
    l_uid: i64,
    s_guid: String,
    s_token: String,
    s_huya_ua: String,
    s_cookie: String,
    i_token_type: i32,
    s_device_info: String,
    s_qimei: String,
}

impl ClassName for HuyaUserId {
    fn _class_name() -> String {
        "HuyaUserId".to_string()
    }
}

impl StructToTars for HuyaUserId {
    fn _encode_to(&self, encoder: &mut TarsEncoder) -> Result<(), EncodeErr> {
        encoder.write_int64(0, self.l_uid)?;
        encoder.write_string(1, &self.s_guid)?;
        encoder.write_string(2, &self.s_token)?;
        encoder.write_string(3, &self.s_huya_ua)?;
        encoder.write_string(4, &self.s_cookie)?;
        encoder.write_int32(5, self.i_token_type)?;
        encoder.write_string(6, &self.s_device_info)?;
        encoder.write_string(7, &self.s_qimei)?;
        Ok(())
    }
}

impl StructFromTars for HuyaUserId {
    fn _decode_from(decoder: &mut TarsDecoder) -> Result<Self, DecodeErr> {
        Ok(HuyaUserId {
            l_uid: decoder.read_int64(0, false, 0)?,
            s_guid: decoder.read_string(1, false, "".to_string())?,
            s_token: decoder.read_string(2, false, "".to_string())?,
            s_huya_ua: decoder.read_string(3, false, "".to_string())?,
            s_cookie: decoder.read_string(4, false, "".to_string())?,
            i_token_type: decoder.read_int32(5, false, 0)?,
            s_device_info: decoder.read_string(6, false, "".to_string())?,
            s_qimei: decoder.read_string(7, false, "".to_string())?,
        })
    }
}

impl EncodeTars for HuyaUserId {
    fn _encode(&self, encoder: &mut TarsEncoder, tag: u8) -> Result<(), EncodeErr> {
        encoder.write_struct(tag, self)
    }
}

impl DecodeTars for HuyaUserId {
    fn _decode(decoder: &mut TarsDecoder, tag: u8) -> Result<Self, DecodeErr> {
        decoder.read_struct(tag, true, HuyaUserId::default())
    }
}

#[derive(Clone, Debug, Default)]
struct GetCdnTokenExReq {
    s_flv_url: String,    // tag 0
    s_stream_name: String, // tag 1
    i_loop_time: i32,     // tag 2
    t_id: HuyaUserId,     // tag 3
    i_app_id: i32,        // tag 4
}

impl ClassName for GetCdnTokenExReq {
    fn _class_name() -> String {
        "GetCdnTokenExReq".to_string()
    }
}

impl StructToTars for GetCdnTokenExReq {
    fn _encode_to(&self, encoder: &mut TarsEncoder) -> Result<(), EncodeErr> {
        encoder.write_string(0, &self.s_flv_url)?;
        encoder.write_string(1, &self.s_stream_name)?;
        encoder.write_int32(2, self.i_loop_time)?;
        encoder.write_struct(3, &self.t_id)?;
        encoder.write_int32(4, self.i_app_id)?;
        Ok(())
    }
}

impl StructFromTars for GetCdnTokenExReq {
    fn _decode_from(decoder: &mut TarsDecoder) -> Result<Self, DecodeErr> {
        Ok(GetCdnTokenExReq {
            s_flv_url: decoder.read_string(0, false, "".to_string())?,
            s_stream_name: decoder.read_string(1, false, "".to_string())?,
            i_loop_time: decoder.read_int32(2, false, 0)?,
            t_id: decoder.read_struct(3, false, HuyaUserId::default())?,
            i_app_id: decoder.read_int32(4, false, 66)?,
        })
    }
}

impl EncodeTars for GetCdnTokenExReq {
    fn _encode(&self, encoder: &mut TarsEncoder, tag: u8) -> Result<(), EncodeErr> {
        encoder.write_struct(tag, self)
    }
}

impl DecodeTars for GetCdnTokenExReq {
    fn _decode(decoder: &mut TarsDecoder, tag: u8) -> Result<Self, DecodeErr> {
        decoder.read_struct(tag, true, GetCdnTokenExReq::default())
    }
}

#[derive(Clone, Debug, Default)]
struct GetCdnTokenExResp {
    s_flv_token: String, // tag 0
    i_expire_time: i32,  // tag 1
}

impl ClassName for GetCdnTokenExResp {
    fn _class_name() -> String {
        "GetCdnTokenExResp".to_string()
    }
}

impl StructFromTars for GetCdnTokenExResp {
    fn _decode_from(decoder: &mut TarsDecoder) -> Result<Self, DecodeErr> {
        Ok(GetCdnTokenExResp {
            s_flv_token: decoder.read_string(0, false, "".to_string())?,
            i_expire_time: decoder.read_int32(1, false, 0)?,
        })
    }
}

impl StructToTars for GetCdnTokenExResp {
    fn _encode_to(&self, encoder: &mut TarsEncoder) -> Result<(), EncodeErr> {
        encoder.write_string(0, &self.s_flv_token)?;
        encoder.write_int32(1, self.i_expire_time)?;
        Ok(())
    }
}

impl EncodeTars for GetCdnTokenExResp {
    fn _encode(&self, encoder: &mut TarsEncoder, tag: u8) -> Result<(), EncodeErr> {
        encoder.write_struct(tag, self)
    }
}

impl DecodeTars for GetCdnTokenExResp {
    fn _decode(decoder: &mut TarsDecoder, tag: u8) -> Result<Self, DecodeErr> {
        decoder.read_struct(tag, true, GetCdnTokenExResp::default())
    }
}

fn encode_tars_request_packet(
    request_id: i32,
    servant: &str,
    func: &str,
    tup_payload: Bytes,
) -> Result<Vec<u8>, String> {
    let mut encoder = TarsEncoder::new();
    encoder
        .write_int16(1, 3)
        .map_err(|e| e.to_string())?; // TUPVERSION
    encoder
        .write_int8(2, 0)
        .map_err(|e| e.to_string())?; // cPacketType
    encoder
        .write_int32(3, 0)
        .map_err(|e| e.to_string())?; // iMessageType
    encoder
        .write_int32(4, request_id)
        .map_err(|e| e.to_string())?;
    encoder
        .write_string(5, &servant.to_string())
        .map_err(|e| e.to_string())?;
    encoder
        .write_string(6, &func.to_string())
        .map_err(|e| e.to_string())?;
    encoder
        .write_bytes(7, &tup_payload)
        .map_err(|e| e.to_string())?;
    encoder
        .write_int32(8, 0)
        .map_err(|e| e.to_string())?; // timeout

    let empty: BTreeMap<String, String> = BTreeMap::new();
    encoder
        .write_map(9, &empty)
        .map_err(|e| e.to_string())?;
    encoder
        .write_map(10, &empty)
        .map_err(|e| e.to_string())?;

    let body = encoder.to_bytes();
    let total_len = (body.len() + 4) as u32;
    let mut out = Vec::with_capacity(body.len() + 4);
    out.extend_from_slice(&total_len.to_be_bytes());
    out.extend_from_slice(&body);
    Ok(out)
}

fn decode_tars_response_packet_payload(payload: &[u8]) -> Result<(i32, Bytes, String), String> {
    // 1) Try standard Tars ResponsePacket layout:
    // iVersion(1), cPacketType(2), iRequestId(3), iMessageType(4), iRet(5), sBuffer(6), status(7), sResultDesc(8)
    {
        let mut decoder = TarsDecoder::from(payload);
        if decoder.read_int16(1, false, 0).is_ok() {
            let _ = decoder.read_int8(2, false, 0);
            let _ = decoder.read_int32(3, false, 0);
            let _ = decoder.read_int32(4, false, 0);
            if let Ok(ret) = decoder.read_int32(5, false, -1) {
                if let Ok(s_buffer) = decoder.read_bytes(6, false, Bytes::new()) {
                    let _status: BTreeMap<String, String> =
                        decoder.read_map(7, false, BTreeMap::new()).unwrap_or_default();
                    let result_desc = decoder
                        .read_string(8, false, "".to_string())
                        .unwrap_or_default();
                    return Ok((ret, s_buffer, result_desc));
                }
            }
        }
    }

    // 2) Huya WUP endpoint may respond with a "request-like" packet layout:
    // iVersion(1), cPacketType(2), iMessageType(3), iRequestId(4), sServantName(5), sFuncName(6),
    // sBuffer(7), iTimeout(8), context(9), status(10)
    let mut decoder = TarsDecoder::from(payload);
    let _ver = decoder.read_int16(1, false, 0).map_err(|e| e.to_string())?;
    let _packet_type = decoder.read_int8(2, false, 0).map_err(|e| e.to_string())?;
    let _message_type = decoder.read_int32(3, false, 0).map_err(|e| e.to_string())?;
    let _request_id = decoder.read_int32(4, false, 0).map_err(|e| e.to_string())?;
    let _servant = decoder
        .read_string(5, false, "".to_string())
        .map_err(|e| e.to_string())?;
    let _func = decoder
        .read_string(6, false, "".to_string())
        .map_err(|e| e.to_string())?;
    let s_buffer = decoder
        .read_bytes(7, false, Bytes::new())
        .map_err(|e| e.to_string())?;
    let _timeout = decoder.read_int32(8, false, 0).unwrap_or(0);
    let _context: BTreeMap<String, String> =
        decoder.read_map(9, false, BTreeMap::new()).unwrap_or_default();
    let _status: BTreeMap<String, String> =
        decoder.read_map(10, false, BTreeMap::new()).unwrap_or_default();

    Ok((0, s_buffer, "".to_string()))
}

fn decode_tars_response_packet(buf: &[u8]) -> Result<(i32, Bytes, String), String> {
    // Prefer standard Tars framing: 4-byte length prefix (network byte order).
    if buf.len() >= 4 {
        let declared = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
        if declared >= 4 && declared <= buf.len() {
            if let Ok(v) = decode_tars_response_packet_payload(&buf[4..declared]) {
                return Ok(v);
            }
        }
    }

    // Fallback: some endpoints may return the ResponsePacket payload without the 4-byte length prefix.
    decode_tars_response_packet_payload(buf)
}

async fn huya_get_cdn_token_info_ex(
    client: &reqwest::Client,
    flv_url: &str,
    stream_name: &str,
) -> Result<String, String> {
    // Encode request UniAttribute payload (tReq) as a simple map: map<string, bytes>
    let req = GetCdnTokenExReq {
        s_flv_url: flv_url.to_string(),
        s_stream_name: stream_name.to_string(),
        i_loop_time: 0,
        t_id: HuyaUserId {
            s_huya_ua: "pc_exe&7060000&official".to_string(),
            ..Default::default()
        },
        i_app_id: 66,
    };
    let mut req_map: BTreeMap<String, Bytes> = BTreeMap::new();
    let req_bytes = TarsEncoder::individual_encode(&req).map_err(|e| e.to_string())?;
    req_map.insert("tReq".to_string(), req_bytes);
    let tup_payload = TarsEncoder::individual_encode(&req_map).map_err(|e| e.to_string())?;

    let request_bytes = encode_tars_request_packet(1, "liveui", "getCdnTokenInfoEx", tup_payload)?;

    let resp = client
        .post("http://wup.huya.com")
        .header(USER_AGENT, HUYA_HYSDK_UA)
        .header(ORIGIN, HUYA_WUP_ORIGIN)
        .header(REFERER, HUYA_WUP_REFERER)
        .header(ACCEPT, "*/*")
        .header("Content-Type", "application/octet-stream")
        .body(request_bytes)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    let ct = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let snippet = String::from_utf8_lossy(&bytes[..bytes.len().min(200)]).to_string();
        return Err(format!(
            "Huya WUP http error: status={} content-type={} body_prefix={}",
            status.as_u16(),
            ct,
            snippet
        ));
    }

    let (ret, s_buffer, desc) = decode_tars_response_packet(bytes.as_ref()).map_err(|e| {
        let hex_prefix = bytes
            .iter()
            .take(96)
            .map(|b| format!("{:02x}", b))
            .collect::<Vec<_>>()
            .join("");
        format!(
            "Huya WUP decode packet failed: {} (content-type={}, body_hex_prefix={})",
            e, ct, hex_prefix
        )
    })?;
    if ret != 0 {
        return Err(if desc.is_empty() {
            format!("Huya WUP returned ret={ret}")
        } else {
            format!("Huya WUP returned ret={ret}: {desc}")
        });
    }

    // Decode response UniAttribute. Huya may return simple or complex map layouts; accept both.
    // 1) Try simple: map<string, bytes>
    if let Ok(simple) = TarsDecoder::individual_decode::<BTreeMap<String, Bytes>>(&s_buffer) {
        if let Some(v) = simple.get("tRsp") {
            if let Ok(rsp) = TarsDecoder::individual_decode::<GetCdnTokenExResp>(v) {
                if !rsp.s_flv_token.trim().is_empty() {
                    return Ok(rsp.s_flv_token);
                }
            }
        }
    }

    // 2) Try complex: map<string, map<string, bytes>>
    let complex: BTreeMap<String, BTreeMap<String, Bytes>> =
        TarsDecoder::individual_decode(&s_buffer).map_err(|e| e.to_string())?;
    let inner = complex
        .get("tRsp")
        .ok_or_else(|| "Huya WUP response missing tRsp".to_string())?;

    // Prefer matching class name; otherwise try decode from any inner payload.
    if let Some(v) = inner.get("GetCdnTokenExResp") {
        let rsp: GetCdnTokenExResp = TarsDecoder::individual_decode(v).map_err(|e| e.to_string())?;
        if rsp.s_flv_token.trim().is_empty() {
            return Err("Huya WUP returned empty token".to_string());
        }
        return Ok(rsp.s_flv_token);
    }

    for (_k, v) in inner {
        if let Ok(rsp) = TarsDecoder::individual_decode::<GetCdnTokenExResp>(v) {
            if !rsp.s_flv_token.trim().is_empty() {
                return Ok(rsp.s_flv_token);
            }
        }
    }

    Err("Huya WUP returned no decodable token".to_string())
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
    flv_url: String,
    stream_name: String,
    presenter_uid: i64,
    cdn: String,
}

#[derive(Clone, Debug)]
struct HuyaWebStreamData {
    is_live: bool,
    candidates: Vec<WebStreamCandidate>,
}

async fn fetch_profile_room(
    client: &reqwest::Client,
    room_id: &str,
) -> Result<Value, Box<dyn Error + Send + Sync>> {
    let url = format!(
        "https://mp.huya.com/cache.php?m=Live&do=profileRoom&roomid={}&showSecret=1",
        room_id
    );
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
    headers.insert(ORIGIN, HeaderValue::from_static("https://www.huya.com"));
    headers.insert(REFERER, HeaderValue::from_static("https://www.huya.com/"));
    headers.insert(USER_AGENT, HeaderValue::from_static(DESKTOP_UA));

    let resp = client.get(&url).headers(headers).send().await?;
    let text = resp.text().await?;
    let v: Value = serde_json::from_str(&text)?;

    let status_code = v.get("status").and_then(|x| x.as_i64()).unwrap_or(0);
    if status_code != 200 {
        return Ok(v);
    }

    Ok(v)
}

fn parse_i64_lossy(v: Option<&Value>) -> i64 {
    match v {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(Value::String(s)) => s.parse::<i64>().unwrap_or(0),
        _ => 0,
    }
}

fn extract_room_detail(profile: &Value) -> RoomDetail {
    let status_code = profile.get("status").and_then(|x| x.as_i64()).unwrap_or(0);
    if status_code != 200 {
        return RoomDetail {
            status: false,
            title: None,
            nick: None,
            avatar180: None,
        };
    }

    let data = profile.get("data").unwrap_or(&Value::Null);
    let stream_ok = data.get("stream").is_some();

    let title = data
        .get("liveData")
        .and_then(|ld| ld.get("introduction"))
        .and_then(|x| x.as_str())
        .or_else(|| {
            data.get("liveData")
                .and_then(|ld| ld.get("roomName"))
                .and_then(|x| x.as_str())
        })
        .map(|s| s.to_string());

    let nick = data
        .get("profileInfo")
        .and_then(|ld| ld.get("nick"))
        .and_then(|x| x.as_str())
        .or_else(|| {
            data.get("liveData")
                .and_then(|ld| ld.get("nick"))
                .and_then(|x| x.as_str())
        })
        .map(|s| s.to_string());

    let avatar180 = data
        .get("profileInfo")
        .and_then(|ld| ld.get("avatar180"))
        .and_then(|x| x.as_str())
        .or_else(|| {
            data.get("liveData")
                .and_then(|ld| ld.get("avatar180"))
                .and_then(|x| x.as_str())
        })
        .map(|s| s.to_string());

    RoomDetail {
        status: stream_ok,
        title,
        nick,
        avatar180,
    }
}

fn extract_stream_candidates(profile: &Value) -> Result<Vec<WebStreamCandidate>, String> {
    let status_code = profile.get("status").and_then(|x| x.as_i64()).unwrap_or(0);
    if status_code != 200 {
        return Ok(Vec::new());
    }
    let data = profile.get("data").ok_or_else(|| "missing data".to_string())?;

    let base_list = data
        .get("stream")
        .and_then(|x| x.get("baseSteamInfoList"))
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();

    let fallback_presenter_uid = base_list
        .get(0)
        .map(|x| parse_i64_lossy(x.get("lChannelId")))
        .unwrap_or(0);

    let mut items = Vec::<(usize, WebStreamCandidate)>::new();
    for item in base_list {
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
        let presenter_uid = {
            let v = parse_i64_lossy(item.get("lChannelId"));
            if v != 0 { v } else { fallback_presenter_uid }
        };

        if cdn.is_empty() || flv_url.is_empty() || stream_name.is_empty() || presenter_uid == 0 {
            continue;
        }

        let prio = cdn_priority(&cdn);
        items.push((
            prio,
            WebStreamCandidate {
                flv_url: flv_url.trim_end_matches('/').to_string(),
                stream_name: stream_name.to_string(),
                presenter_uid,
                cdn,
            },
        ));
    }

    items.sort_by_key(|(prio, _)| *prio);
    let candidates = items.into_iter().map(|(_, c)| c).collect::<Vec<_>>();

    Ok(prioritize_candidates(candidates))
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
        let lower = candidate.flv_url.to_ascii_lowercase();
        let has_huya = lower.contains("huya.com");
        let flv = true;

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

fn extract_available_bitrates(profile: &Value) -> Vec<i32> {
    let Some(data) = profile.get("data") else {
        return Vec::new();
    };

    // Prefer liveData.bitRateInfo (stringified JSON), else fall back to stream.flv.rateArray
    let mut out: Vec<i32> = Vec::new();

    if let Some(s) = data
        .get("liveData")
        .and_then(|x| x.get("bitRateInfo"))
        .and_then(|x| x.as_str())
    {
        if let Ok(v) = serde_json::from_str::<Value>(s) {
            if let Some(arr) = v.as_array() {
                for item in arr {
                    if let Some(br) = item.get("iBitRate").and_then(|x| x.as_i64()) {
                        if br > 0 {
                            out.push(br as i32);
                        }
                    }
                }
            }
        }
    }

    if out.is_empty() {
        if let Some(arr) = data
            .get("stream")
            .and_then(|x| x.get("flv"))
            .and_then(|x| x.get("rateArray"))
            .and_then(|x| x.as_array())
        {
            for item in arr {
                if let Some(br) = item.get("iBitRate").and_then(|x| x.as_i64()) {
                    if br > 0 {
                        out.push(br as i32);
                    }
                }
            }
        }
    }

    out.sort_unstable();
    out.dedup();
    out
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
    // URL is built later (needs WUP token); keep index selection behavior.
    let fake_url = if let Some(r) = ratio { format!("ratio={r}") } else { "ratio=0".to_string() };
    Some((fake_url, candidate_index))
}

fn build_flv_tx_urls(base_url: &str, hd: i32, sd: i32) -> Vec<HuyaUnifiedStreamEntry> {
    let mut entries = Vec::new();
    entries.push(HuyaUnifiedStreamEntry {
        quality: "原画".to_string(),
        bitRate: 0,
        url: base_url.to_string(),
    });

    entries.push(HuyaUnifiedStreamEntry {
        quality: "高清".to_string(),
        bitRate: hd,
        url: format!("{}&ratio={}", base_url, hd),
    });
    entries.push(HuyaUnifiedStreamEntry {
        quality: "标清".to_string(),
        bitRate: sd,
        url: format!("{}&ratio={}", base_url, sd),
    });

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

    let profile = fetch_profile_room(client, &room_id)
        .await
        .map_err(|e| e.to_string())?;
    let detail = extract_room_detail(&profile);
    let candidates = extract_stream_candidates(&profile)?;
    let web_stream = HuyaWebStreamData {
        is_live: !candidates.is_empty(),
        candidates,
    };

    let available = extract_available_bitrates(&profile);
    let hd = available.last().copied().unwrap_or(4000);
    let sd = available.first().copied().unwrap_or(2000);

    let ratio = match quality.as_deref().map(|s| s.trim()).unwrap_or("") {
        q if q.contains("标清") => Some(sd),
        q if q.contains("高清") => Some(hd),
        q if q.contains("原画") => None,
        _ => resolve_ratio(quality.as_deref()),
    };
    let preferred_line = normalize_huya_line(line.as_deref());
    let selection = pick_stream_url(&web_stream.candidates, ratio, preferred_line.as_deref());
    let selected_index = match selection {
        Some((_, idx)) => idx,
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

    let Some(selected_candidate) = web_stream.candidates.get(selected_index) else {
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
    };

    // pure_live-master: token = getCdnTokenInfoEx(streamName, flvUrl) -> buildAntiCode(token)
    let token = huya_get_cdn_token_info_ex(
        client,
        &selected_candidate.flv_url,
        &selected_candidate.stream_name,
    )
    .await?;
    let anti = build_huya_anti_code(
        &selected_candidate.stream_name,
        selected_candidate.presenter_uid,
        &token,
    )?;

    let base_url = enforce_https(&format!(
        "{}/{}.flv?{}&codec=264",
        selected_candidate.flv_url.trim_end_matches('/'),
        selected_candidate.stream_name,
        anti
    ));

    let selected_url = match ratio {
        Some(r) => format!("{}&ratio={}", base_url, r),
        None => base_url.clone(),
    };

    let tx_entries = build_flv_tx_urls(&base_url, hd, sd);
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
