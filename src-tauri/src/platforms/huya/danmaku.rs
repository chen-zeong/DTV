use futures_util::{SinkExt, StreamExt};
use log::info;
use tars_stream::prelude::*;
use tauri::Emitter;
use tokio::sync::mpsc as tokio_mpsc;
use tokio::time::{sleep, Duration};
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};

const WS_URL: &str = "wss://cdnws.api.huya.com";
// 恢复 HEARTBEAT 常量（被误删），供心跳发送使用
const HEARTBEAT: &'static [u8] = b"\x00\x03\x1d\x00\x00\x69\x00\x00\x00\x69\x10\x03\x2c\x3c\x4c\x56\x08\x6f\x6e\x6c\x69\x6e\x65\x75\x69\x66\x0f\x4f\x6e\x55\x73\x65\x72\x48\x65\x61\x72\x74\x42\x65\x61\x74\x7d\x00\x00\x3c\x08\x00\x01\x06\x04\x74\x52\x65\x71\x1d\x00\x00\x2f\x0a\x0a\x0c\x16\x00\x26\x00\x36\x07\x61\x64\x72\x5f\x77\x61\x70\x46\x00\x0b\x12\x03\xae\xf0\x0f\x22\x03\xae\xf0\x0f\x3c\x42\x6d\x52\x02\x60\x5c\x60\x01\x7c\x82\x00\x0b\xb0\x1f\x9c\xac\x0b\x8c\x98\x0c\xa8\x0c";
// const HEARTBEAT_BASE64: &str = "ABQdAAwsNgBM"; // same as Python
#[allow(dead_code)]
const HEARTBEAT_BASE64: &str = "ABQdAAwsNgBM"; // same as Python

// Minimal JCE/TARS codec for required Huya structures

async fn fetch_huya_ids(room_id: &str) -> Result<(i64, i64), String> {
    let url = format!(
        "https://mp.huya.com/cache.php?m=Live&do=profileRoom&roomid={}&showSecret=1",
        room_id
    );
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(url)
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36")
        .header("Accept", "*/*")
        .header("Origin", "https://www.huya.com")
        .header("Referer", "https://www.huya.com/")
        .send().await.map_err(|e| e.to_string())?;
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;

    let status = v.get("status").and_then(|x| x.as_i64()).unwrap_or(0);
    if status != 200 {
        return Err("房间未开播或无流信息，无法获取弹幕参数".to_string());
    }

    let data = v.get("data").ok_or_else(|| "缺少data".to_string())?;
    let ayyuid = data
        .get("profileInfo")
        .and_then(|x| x.get("yyid"))
        .and_then(|x| x.as_i64())
        .unwrap_or(0);

    let base_list = data
        .get("stream")
        .and_then(|x| x.get("baseSteamInfoList"))
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();

    let top_sid = if let Some(first) = base_list.get(0) {
        first
            .get("lChannelId")
            .and_then(|x| x.as_i64())
            .unwrap_or(0)
    } else {
        0
    };

    if top_sid == 0 {
        return Err("未找到频道ID，房间可能未开播".to_string());
    }

    println!(
        "[Huya Danmaku] fetch_huya_ids: room_id={} yyid={} topSid={}",
        room_id, ayyuid, top_sid
    );
    Ok((ayyuid, top_sid))
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct HuyaJoinParams {
    pub yyid: i64,
    pub top_sid: i64,
}

pub async fn fetch_huya_join_params(room_id: String) -> Result<HuyaJoinParams, String> {
    match fetch_huya_ids(&room_id).await {
        Ok((ayyuid, top_sid)) => Ok(HuyaJoinParams {
            yyid: ayyuid,
            top_sid,
        }),
        Err(e) => Err(e),
    }
}

pub async fn start_huya_danmaku_listener(
    payload: crate::platforms::common::GetStreamUrlPayload,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::platforms::common::HuyaDanmakuState>,
) -> Result<(), String> {
    let room_id_or_url = payload.args.room_id_str.clone();
    println!(
        "[Huya Danmaku] start listener room_id_or_url={}",
        room_id_or_url
    );
    info!(
        "[Huya Danmaku] start listener room_id_or_url={}",
        room_id_or_url
    );

    // 停止已有监听
    let previous_tx = {
        let mut lock = state.inner().0.lock().unwrap();
        lock.take()
    };
    if let Some(tx) = previous_tx {
        if tx.send(()).await.is_err() {
            eprintln!("[Huya Danmaku] 旧任务关闭失败，可能已退出。");
        }
    }

    // 创建新的关闭通道并保存到 State
    let (tx_shutdown, mut rx_shutdown) = tokio_mpsc::channel::<()>(1);
    {
        let mut lock = state.inner().0.lock().unwrap();
        *lock = Some(tx_shutdown);
    }

    let app_handle_clone = app_handle.clone();
    let room_id_clone = room_id_or_url.clone();

    tokio::spawn(async move {
        println!(
            "[Huya Danmaku] spawned worker for room_id={}",
            room_id_clone
        );
        info!(
            "[Huya Danmaku] spawned worker for room_id={}",
            room_id_clone
        );
        // 1) 获取 ws 与注册数据（与根目录 huya.rs 同步）
        let (ws_url, reg_data) = match get_ws_info_tars(&room_id_clone).await {
            Ok(v) => v,
            Err(e) => {
                let _ = app_handle_clone.emit(
                    "danmaku-message",
                    crate::platforms::common::DanmakuFrontendPayload {
                        room_id: room_id_clone.clone(),
                        user: "系统".to_string(),
                        content: format!("Huya房间信息获取失败: {}", e),
                        user_level: 0,
                        fans_club_level: 0,
                    },
                );
                return;
            }
        };

        println!(
            "[Huya Danmaku] ws_url={} reg_len={}",
            ws_url,
            reg_data.len()
        );
        info!(
            "[Huya Danmaku] ws_url={} reg_len={}",
            ws_url,
            reg_data.len()
        );

        // 2) 连接 WebSocket
        println!("[Huya Danmaku] connecting to {}", ws_url);
        info!("[Huya Danmaku] connecting to {}", ws_url);
        let (ws_stream, _) = match connect_async(&ws_url).await {
            Ok(v) => v,
            Err(e) => {
                let _ = app_handle_clone.emit(
                    "danmaku-message",
                    crate::platforms::common::DanmakuFrontendPayload {
                        room_id: room_id_clone.clone(),
                        user: "系统".to_string(),
                        content: format!("Huya弹幕连接失败: {}", e),
                        user_level: 0,
                        fans_club_level: 0,
                    },
                );
                return;
            }
        };

        let (mut ws_write, mut ws_read) = ws_stream.split();
        if let Err(e) = ws_write.send(WsMessage::Binary(reg_data)).await {
            let _ = app_handle_clone.emit(
                "danmaku-message",
                crate::platforms::common::DanmakuFrontendPayload {
                    room_id: room_id_clone.clone(),
                    user: "系统".to_string(),
                    content: format!("Huya注册数据发送失败: {}", e),
                    user_level: 0,
                    fans_club_level: 0,
                },
            );
            return;
        }

        // 3) 心跳与接收
        let hb_task = async {
            let mut hb_seq = 0usize;
            while let Ok(_) = ws_write.send(WsMessage::Binary(HEARTBEAT.into())).await {
                hb_seq += 1;
                println!("[Huya Danmaku] heartbeat sent #{}", hb_seq);
                info!("[Huya Danmaku] heartbeat sent #{}", hb_seq);
                sleep(Duration::from_secs(20)).await;
            }
            Err::<(), anyhow::Error>(anyhow::anyhow!("Huya心跳发送失败"))
        };

        let recv_task = async {
            while let Some(m) = ws_read.next().await {
                let m = match m {
                    Ok(x) => x,
                    Err(e) => return Err(anyhow::anyhow!(e)),
                };
                match m {
                    WsMessage::Binary(bin) => {
                        let (top_cmd, nested_cmd) = peek_cmds(&bin);
                        println!(
                            "[Huya Danmaku] WS msg: len={} top_cmd={:?} nested_cmd={:?}",
                            bin.len(),
                            top_cmd,
                            nested_cmd
                        );
                        info!(
                            "[Huya Danmaku] WS msg: len={} top_cmd={:?} nested_cmd={:?}",
                            bin.len(),
                            top_cmd,
                            nested_cmd
                        );
                        match decode_msg_tars(&bin)? {
                            Some((nick, text)) => {
                                println!("[Huya Danmaku] decoded chat: {} -> {}", nick, text);
                                info!("[Huya Danmaku] decoded chat: {} -> {}", nick, text);
                                let _ = app_handle_clone.emit(
                                    "danmaku-message",
                                    crate::platforms::common::DanmakuFrontendPayload {
                                        room_id: room_id_clone.clone(),
                                        user: nick,
                                        content: text,
                                        user_level: 0,
                                        fans_club_level: 0,
                                    },
                                );
                            }
                            None => {
                                if top_cmd == Some(7) {
                                    println!(
                                        "[Huya Danmaku] non-chat or empty msg, nested={:?}",
                                        nested_cmd
                                    );
                                    info!(
                                        "[Huya Danmaku] non-chat or empty msg, nested={:?}",
                                        nested_cmd
                                    );
                                }
                            }
                        }
                    }
                    other => {
                        println!("[Huya Danmaku] non-binary ws message: {:?}", other);
                        info!("[Huya Danmaku] non-binary ws message: {:?}", other);
                    }
                }
            }
            anyhow::Ok(())
        };

        tokio::select! {
            _ = rx_shutdown.recv() => {
                // 主动关闭
            }
            it = hb_task => {
                if let Err(e) = it { eprintln!("[Huya Danmaku] {}", e); }
            }
            it = recv_task => {
                if let Err(e) = it { eprintln!("[Huya Danmaku] 接收失败: {}", e); }
            }
        }
    });

    Ok(())
}

pub async fn stop_huya_danmaku_listener(
    room_id: String,
    state: tauri::State<'_, crate::platforms::common::HuyaDanmakuState>,
) -> Result<(), String> {
    println!(
        "[Huya Danmaku] stop_huya_danmaku_listener called for room_id={}",
        room_id
    );

    // 取出当前监听的停止信号发送器
    let tx = {
        let mut lock = state.inner().0.lock().unwrap();
        lock.take()
    };

    if let Some(tx) = tx {
        if let Err(_) = tx.send(()).await {
            println!("[Huya Danmaku] 停止信号发送失败，监听器可能已经退出");
        } else {
            println!("[Huya Danmaku] 停止信号已发送给 room_id={}", room_id);
        }
    } else {
        println!("[Huya Danmaku] 没有找到活跃的监听器需要停止");
    }

    Ok(())
}

// 采用 tars_stream 的实现（参考 all_in_one.rs），保留 Tauri 命令，对旧 jce 逻辑停用

struct HuyaUser {
    _uid: i64,
    _imid: i64,
    name: String,
    _gender: i32,
}

struct HuyaDanmakuFmt {
    color: i32,
}

impl StructFromTars for HuyaUser {
    fn _decode_from(decoder: &mut TarsDecoder) -> Result<Self, DecodeErr> {
        let uid = decoder.read_int64(0, false, -1)?;
        let imid = decoder.read_int64(1, false, -1)?;
        let name = decoder.read_string(2, false, "".to_string())?;
        let gender = decoder.read_int32(3, false, -1)?;
        Ok(HuyaUser {
            _uid: uid,
            _imid: imid,
            name,
            _gender: gender,
        })
    }
}

impl StructFromTars for HuyaDanmakuFmt {
    fn _decode_from(decoder: &mut TarsDecoder) -> Result<Self, DecodeErr> {
        let color = decoder.read_int32(0, false, 16777215)?;
        Ok(HuyaDanmakuFmt { color })
    }
}

fn peek_cmds(data: &[u8]) -> (Option<i32>, Option<i64>) {
    let mut ios = TarsDecoder::from(data);
    let top_cmd = ios.read_int32(0, false, -1).ok();
    let nested_cmd = ios
        .read_bytes(1, false, Default::default())
        .ok()
        .and_then(|b1| {
            let mut inner = TarsDecoder::from(b1.as_ref());
            inner.read_int32(1, false, -1).ok().map(|v| v as i64)
        });
    (top_cmd, nested_cmd)
}

fn find_uid_in_json(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::Object(map) => {
            for (k, val) in map {
                let key = k.to_lowercase();
                if key == "ayyuid" || key == "yyuid" || key == "lp" || key == "uid" {
                    match val {
                        serde_json::Value::String(s) => {
                            if !s.is_empty() {
                                return Some(s.clone());
                            }
                        }
                        serde_json::Value::Number(n) => return Some(n.to_string()),
                        _ => {}
                    }
                }
                if let Some(found) = find_uid_in_json(val) {
                    return Some(found);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                if let Some(found) = find_uid_in_json(item) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

fn gen_ua() -> String {
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".to_string()
}

async fn get_ws_info_tars(room_id_or_url: &str) -> Result<(String, Vec<u8>), String> {
    let url = if room_id_or_url.starts_with("http") {
        reqwest::Url::parse(room_id_or_url).map_err(|e| e.to_string())?
    } else {
        reqwest::Url::parse(&format!("https://www.huya.com/{}", room_id_or_url))
            .map_err(|e| e.to_string())?
    };
    let rid = url
        .path_segments()
        .and_then(|s| s.last())
        .ok_or_else(|| "房间ID解析失败".to_string())?;
    println!("[Huya Danmaku] get_ws_info_tars rid={}", rid);
    info!("[Huya Danmaku] get_ws_info_tars rid={}", rid);

    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let resp_text = client
        .get(format!("https://www.huya.com/{}", rid))
        .header("User-Agent", gen_ua())
        .header("Referer", "https://www.huya.com/")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    println!("[Huya Danmaku] fetched room page len={}", resp_text.len());
    info!("[Huya Danmaku] fetched room page len={}", resp_text.len());

    // 先尝试 TT_PROFILE_INFO 提取 lp
    let mut ayyuid = {
        let re_prof = regex::Regex::new(r#"var\s+TT_PROFILE_INFO\s*=\s*(\{[\s\S]*?\});"#)
            .map_err(|e| e.to_string())?;
        if let Some(cap) = re_prof.captures(&resp_text) {
            if let Ok(j) = serde_json::from_str::<serde_json::Value>(&cap[1]) {
                j.pointer("/lp")
                    .map(|v| v.to_string().replace('"', ""))
                    .unwrap_or_default()
            } else {
                String::new()
            }
        } else {
            String::new()
        }
    };
    if ayyuid.is_empty() {
        // 直接匹配 lp
        let re_lp =
            regex::Regex::new(r#"\\\"lp\\\"\s*:\s*\\\"?(\d+)\\\"?"#).map_err(|e| e.to_string())?;
        if let Some(cap) = re_lp.captures(&resp_text) {
            ayyuid = cap.get(1).unwrap().as_str().to_string();
        }
    }
    if ayyuid.is_empty() {
        // 匹配 ayyuid / yyuid
        let re_ayyuid = regex::Regex::new(r#"\\\"ayyuid\\\"\s*:\s*\\\"?(\d+)\\\"?"#)
            .map_err(|e| e.to_string())?;
        let re_yyuid = regex::Regex::new(r#"\\\"yyuid\\\"\s*:\s*\\\"?(\d+)\\\"?"#)
            .map_err(|e| e.to_string())?;
        if let Some(cap) = re_ayyuid.captures(&resp_text) {
            ayyuid = cap.get(1).unwrap().as_str().to_string();
        } else if let Some(cap) = re_yyuid.captures(&resp_text) {
            ayyuid = cap.get(1).unwrap().as_str().to_string();
        }
    }
    if ayyuid.is_empty() {
        // 回退：调用 mp.huya.com
        let url_api = format!(
            "https://mp.huya.com/cache.php?m=Live&do=profileRoom&roomid={}",
            rid
        );
        let text = client
            .get(&url_api)
            .header("User-Agent", gen_ua())
            .send()
            .await
            .map_err(|e| e.to_string())?
            .text()
            .await
            .map_err(|e| e.to_string())?;
        if let Ok(j) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(found) = find_uid_in_json(&j) {
                ayyuid = found;
            }
        }
    }
    if ayyuid.is_empty() {
        ayyuid = rid.to_string();
    }
    println!("[Huya Danmaku] final ayyuid={}", ayyuid);
    info!("[Huya Danmaku] final ayyuid={}", ayyuid);

    let mut topics = Vec::new();
    topics.push(format!("live:{}", ayyuid));
    topics.push(format!("chat:{}", ayyuid));
    println!("[Huya Danmaku] topics={:?}", topics);
    info!("[Huya Danmaku] topics={:?}", topics);

    let mut oos = TarsEncoder::new();
    oos.write_list(0, &topics).map_err(|e| e.to_string())?;
    oos.write_string(1, &"".to_owned())
        .map_err(|e| e.to_string())?;

    let mut wscmd = TarsEncoder::new();
    wscmd.write_int32(0, 16).map_err(|e| e.to_string())?;
    wscmd
        .write_bytes(1, &oos.to_bytes())
        .map_err(|e| e.to_string())?;
    let b = wscmd.to_bytes();
    println!("[Huya Danmaku] reg payload built, len={}", b.len());
    info!("[Huya Danmaku] reg payload built, len={}", b.len());

    Ok((WS_URL.to_owned(), b.as_ref().to_vec()))
}

fn decode_msg_tars(data: &[u8]) -> anyhow::Result<Option<(String, String)>> {
    let mut ret: Option<(String, String)> = None;
    let mut ios = TarsDecoder::from(data);
    let top = ios.read_int32(0, false, -1)?;
    if top != 7 {
        println!("[Huya Danmaku] ignore msg: top_cmd={}", top);
        info!("[Huya Danmaku] ignore msg: top_cmd={}", top);
        return Ok(ret);
    }
    let b1 = ios.read_bytes(1, false, Default::default())?;
    let mut inner = TarsDecoder::from(b1.as_ref());
    let nested = inner.read_int32(1, false, -1).unwrap_or(-1);
    let b2 = inner.read_bytes(2, false, Default::default())?;
    println!("[Huya Danmaku] nested={} payload_len={}", nested, b2.len());
    info!("[Huya Danmaku] nested={} payload_len={}", nested, b2.len());
    let mut payload = TarsDecoder::from(b2.as_ref());

    if nested == 1400 {
        let user = payload
            .read_struct(
                0,
                false,
                HuyaUser {
                    _uid: -1,
                    _imid: -1,
                    name: "".to_owned(),
                    _gender: 1,
                },
            )
            .unwrap_or(HuyaUser {
                _uid: -1,
                _imid: -1,
                name: "".to_owned(),
                _gender: 1,
            });
        let text = payload
            .read_string(3, false, "".to_owned())
            .unwrap_or_default();
        let fmt = payload
            .read_struct(6, false, HuyaDanmakuFmt { color: 16777215 })
            .unwrap_or(HuyaDanmakuFmt { color: 16777215 });
        if !text.is_empty() {
            let nick = if !user.name.is_empty() {
                user.name
            } else {
                "匿名".to_string()
            };
            let _color_hex = format!("{:06x}", if fmt.color <= 0 { 16777215 } else { fmt.color });
            println!(
                "[Huya Danmaku] decoded nested=1400 nick={} text={}",
                nick, text
            );
            info!(
                "[Huya Danmaku] decoded nested=1400 nick={} text={}",
                nick, text
            );
            ret = Some((nick, text));
        } else {
            println!("[Huya Danmaku] empty text in nested=1400");
            info!("[Huya Danmaku] empty text in nested=1400");
        }
    } else {
        println!("[Huya Danmaku] non-chat nested={}, skip", nested);
        info!("[Huya Danmaku] non-chat nested={}, skip", nested);
    }
    Ok(ret)
}
