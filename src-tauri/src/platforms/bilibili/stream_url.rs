use reqwest::header::{HeaderMap, HeaderValue, COOKIE, REFERER, USER_AGENT};
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::platforms::common::types::StreamVariant;
use crate::proxy::{start_proxy, ProxyServerHandle, get_proxy_url};
use crate::StreamUrlStore;

use crate::platforms::common::errors::DtvError;

pub async fn get_bilibili_live_stream_url_with_quality(
    app_handle: AppHandle,
    stream_url_store: State<'_, StreamUrlStore>,
    proxy_server_handle: State<'_, ProxyServerHandle>,
    payload: crate::platforms::common::GetStreamUrlPayload,
    quality: String,
    cookie: Option<String>,
) -> Result<crate::platforms::common::LiveStreamInfo, DtvError> {
    let room_id = payload.args.room_id_str.clone();
    if room_id.trim().is_empty() {
        return Ok(crate::platforms::common::LiveStreamInfo {
            title: None,
            anchor_name: None,
            avatar: None,
            stream_url: None,
            status: None,
            error_message: Some("房间ID未提供".to_string()),
            upstream_url: None,
            available_streams: None,
            normalized_room_id: None,
            web_rid: None,
        });
    }

    let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

    // Build headers
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_str(ua).unwrap());
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://live.bilibili.com/"),
    );
    if let Some(c) = cookie.as_ref() {
        let c_trimmed = c.trim();
        if !c_trimmed.is_empty() {
            match HeaderValue::from_str(c_trimmed) {
                Ok(val) => {
                    headers.insert(COOKIE, val);
                    tracing::debug!("[Bilibili] Cookie header set (content: {})", crate::platforms::common::logging::mask_sensitive(c_trimmed));
                }
                Err(err) => {
                    tracing::warn!("[Bilibili] Invalid cookie header, skipping. Error: {}", err);
                }
            }
        } else {
            tracing::debug!("[Bilibili] Cookie provided is empty after trimming, skipping insertion.");
        }
    }

    // 添加必要的 Origin，以符合部分接口对 CSRF 的检查
    headers.insert(
        reqwest::header::ORIGIN,
        HeaderValue::from_static("https://live.bilibili.com"),
    );
    let client = reqwest::Client::builder()
        .default_headers(headers)
        .no_proxy()
        .build()
        .map_err(|e| DtvError::internal(format!("Failed to build client: {}", e)))?;

    // Helper: request playinfo with optional qn
    async fn request_playinfo(
        client: &reqwest::Client,
        room_id: &str,
        qn: Option<i32>,
    ) -> Result<Value, DtvError> {
        let url = "https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo";
        let mut params = vec![
            ("room_id", room_id.to_string()),
            ("protocol", "0,1".to_string()),
            ("format", "0,1,2".to_string()),
            // 与参考 Python 版本保持一致：codec 使用 0，platform 使用 html5
            ("codec", "0".to_string()),
            ("platform", "html5".to_string()),
            ("dolby", "5".to_string()),
        ];
        if let Some(q) = qn {
            params.push(("qn", q.to_string()));
        }
        let resp = client
            .get(url)
            .query(&params)
            .send()
            .await
            .map_err(|e| DtvError::network(format!("PlayInfo request failed: {}", e)))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| DtvError::network(format!("Read text failed: {}", e)))?;
        if !status.is_success() {
            return Err(DtvError::api(format!("PlayInfo status: {} body: {}", status, text)));
        }
        serde_json::from_str::<Value>(&text)
            .map_err(|e| DtvError::api(format!("JSON parse failed: {} | body: {}", e, text)))
    }

    // 1) First request to get qn mapping
    let playinfo = request_playinfo(&client, &room_id, None).await?;
    let playurl = playinfo["data"]["playurl_info"]["playurl"].clone();

    // Build qn->desc map
    let mut qn_map: Vec<(i32, String)> = vec![];
    if let Some(arr) = playurl.get("g_qn_desc").and_then(|v| v.as_array()) {
        for item in arr {
            let qn = item.get("qn").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            let desc = item
                .get("desc")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            qn_map.push((qn, desc));
        }
    }
    // 解析 accept_qn（首个 stream/format/codec 的可选清晰度）
    let mut accept_qn: Vec<i32> = vec![];
    if let Some(streams) = playurl.get("stream").and_then(|v| v.as_array()) {
        if let Some(first_format) = streams
            .get(0)
            .and_then(|s| s.get("format"))
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.get(0))
        {
            if let Some(first_codec) = first_format
                .get("codec")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.get(0))
            {
                if let Some(arr) = first_codec.get("accept_qn").and_then(|v| v.as_array()) {
                    for q in arr {
                        if let Some(i) = q.as_i64() {
                            accept_qn.push(i as i32);
                        }
                    }
                }
            }
        }
    }
    // 调试输出：可用的 qn 列表及描述 + accept_qn
    if !qn_map.is_empty() {
        let qn_str = qn_map
            .iter()
            .map(|(q, d)| format!("{}:{}", q, d))
            .collect::<Vec<_>>()
            .join(", ");
        tracing::debug!("[Bilibili] qn_map for room {} => [{}]", room_id, qn_str);
    } else {
        tracing::debug!("[Bilibili] qn_map is empty for room {}", room_id);
    }
    if !accept_qn.is_empty() {
        let accept_str = accept_qn
            .iter()
            .map(|q| q.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        tracing::debug!("[Bilibili] accept_qn => [{}]", accept_str);
    }

    // Choose qn by desired quality text（更严格的匹配与优先规则）
    fn match_qn(qn_map: &[(i32, String)], quality: &str) -> Option<i32> {
        let q = quality.trim();
        let mut qns: Vec<i32> = qn_map.iter().map(|(qn, _)| *qn).collect();
        qns.sort();
        let has = |v: i32| qns.binary_search(&v).is_ok();

        match q {
            "原画" => {
                if has(10000) {
                    Some(10000)
                } else {
                    qns.last().copied()
                }
            }
            "高清" => {
                // 优先固定值 400；否则按描述关键字匹配（高清/超清/HD）；再兜底选择次高值
                if has(400) {
                    return Some(400);
                }
                for (qn, desc) in qn_map.iter() {
                    if desc.contains("高清") || desc.contains("超清") || desc.contains("HD") {
                        return Some(*qn);
                    }
                }
                // 兜底：选择小于最大值的次高 qn（例如只有 10000 和 250 时，选 250）
                let max = qns.last().copied();
                if let Some(m) = max {
                    qns.into_iter().rev().find(|&x| x < m)
                } else {
                    None
                }
            }
            "标清" => {
                // 优先固定值 250；否则按描述关键字匹配（标清/流畅/SD）；再兜底选择最小值
                if has(250) {
                    return Some(250);
                }
                for (qn, desc) in qn_map.iter() {
                    if desc.contains("标清") || desc.contains("流畅") || desc.contains("SD") {
                        return Some(*qn);
                    }
                }
                qns.first().copied()
            }
            _ => {
                // 未识别文案：兜底最大值
                qns.last().copied()
            }
        }
    }

    let selected_qn = match_qn(&qn_map, &quality);
    let selected_desc = selected_qn.and_then(|qn| {
        qn_map
            .iter()
            .find(|(q, _)| *q == qn)
            .map(|(_, d)| d.clone())
    });
    tracing::info!(
        "[Bilibili] selected quality '{}' -> qn={:?}, desc={:?}",
        quality, selected_qn, selected_desc
    );

    // Determine live status from room_init
    let room_init_url = format!(
        "https://api.live.bilibili.com/room/v1/Room/room_init?id={}",
        room_id
    );
    let init_resp = client
        .get(&room_init_url)
        .send()
        .await
        .map_err(|e| DtvError::network(format!("room_init failed: {}", e)))?;
    let init_text = init_resp
        .text()
        .await
        .map_err(|e| DtvError::network(format!("room_init read text failed: {}", e)))?;
    let init_json: Value = serde_json::from_str(&init_text)
        .map_err(|e| DtvError::api(format!("room_init json failed: {} | {}", e, init_text)))?;
    let live_status = init_json["data"]["live_status"].as_i64().unwrap_or(0);
    if live_status != 1 {
        return Ok(crate::platforms::common::LiveStreamInfo {
            title: init_json["data"]["title"].as_str().map(|s| s.to_string()),
            anchor_name: init_json["data"]["uname"].as_str().map(|s| s.to_string()),
            avatar: None,
            stream_url: None,
            status: Some(0),
            error_message: None,
            upstream_url: None,
            available_streams: None,
            normalized_room_id: None,
            web_rid: None,
        });
    }

    enum SelectedStream {
        Flv(String),
        Hls(String),
    }

    fn parse_stream_variants(
        playurl: &Value,
        selected_desc: &Option<String>,
        selected_qn: Option<i32>,
    ) -> (Vec<StreamVariant>, Option<String>, Vec<String>) {
        let mut variants: Vec<StreamVariant> = Vec::new();
        let mut hls_candidates: Vec<String> = Vec::new();
        let mut flv_candidate: Option<String> = None;

        if let Some(streams) = playurl.get("stream").and_then(|v| v.as_array()) {
            for stream_item in streams {
                let protocol_name = stream_item
                    .get("protocol_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if let Some(formats) = stream_item.get("format").and_then(|v| v.as_array()) {
                    for format_item in formats {
                        let format_name = format_item
                            .get("format_name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        if let Some(codecs) = format_item.get("codec").and_then(|v| v.as_array()) {
                            for codec_item in codecs {
                                let base_url = codec_item
                                    .get("base_url")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                if let Some(url_infos) =
                                    codec_item.get("url_info").and_then(|v| v.as_array())
                                {
                                    for ui in url_infos {
                                        let host =
                                            ui.get("host").and_then(|v| v.as_str()).unwrap_or("");
                                        let extra =
                                            ui.get("extra").and_then(|v| v.as_str()).unwrap_or("");
                                        let composed = format!("{}{}{}", host, base_url, extra);
                                        if composed.is_empty() {
                                            continue;
                                        }

                                        variants.push(StreamVariant {
                                            url: composed.clone(),
                                            format: Some(format_name.to_string()),
                                            desc: selected_desc.clone(),
                                            qn: selected_qn,
                                            protocol: if protocol_name.is_empty() {
                                                None
                                            } else {
                                                Some(protocol_name.clone())
                                            },
                                        });

                                        let is_hls_format = matches!(
                                            format_name,
                                            "ts" | "fmp4" | "mp4" | "m4s" | "m3u8"
                                        );
                                        let is_hls_protocol = protocol_name.contains("hls");
                                        if is_hls_format || is_hls_protocol {
                                            hls_candidates.push(composed.clone());
                                        }
                                        if format_name == "flv" && flv_candidate.is_none() {
                                            flv_candidate = Some(composed.clone());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        (variants, flv_candidate, hls_candidates)
    }

    async fn verify_hls_candidates(
        client: &reqwest::Client,
        room_id: &str,
        candidates: &[String],
    ) -> Option<String> {
        for candidate in candidates.iter().take(4) {
            match client.get(candidate).send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        tracing::debug!(
                            "[Bilibili] Verified HLS candidate for room {} -> {}",
                            room_id, candidate
                        );
                        return Some(candidate.clone());
                    } else {
                        tracing::warn!(
                            "[Bilibili] HLS candidate returned status {} for room {} -> {}",
                            resp.status(),
                            room_id,
                            candidate
                        );
                    }
                }
                Err(err) => {
                    tracing::error!(
                        "[Bilibili] Failed to probe HLS candidate for room {} -> {} ({})",
                        room_id, candidate, err
                    );
                }
            }
        }
        None
    }

    const MAX_HLS_RETRY: usize = 3;
    let mut selected_stream: Option<SelectedStream> = None;
    let mut variants_for_response: Vec<StreamVariant> = Vec::new();
    let mut fallback_hls_url: Option<String> = None;
    let mut fallback_variants: Option<Vec<StreamVariant>> = None;

    for attempt in 0..=MAX_HLS_RETRY {
        let attempt_display = attempt + 1;
        let playinfo_attempt = request_playinfo(&client, &room_id, selected_qn).await?;
        let playurl_attempt = playinfo_attempt["data"]["playurl_info"]["playurl"].clone();
        let (variants, flv_candidate, hls_candidates) =
            parse_stream_variants(&playurl_attempt, &selected_desc, selected_qn);

        variants_for_response = variants.clone();

        if let Some(flv_url) = flv_candidate {
            tracing::info!(
                "[Bilibili] Attempt {} obtained FLV stream for room {}, stop retrying",
                attempt_display, room_id
            );
            selected_stream = Some(SelectedStream::Flv(flv_url));
            break;
        }

        if hls_candidates.is_empty() {
            tracing::warn!(
                "[Bilibili] Attempt {} returned no HLS candidates for room {}",
                attempt_display, room_id
            );
            if attempt == MAX_HLS_RETRY {
                break;
            }
            continue;
        }

        let (preferred_candidates, other_candidates): (Vec<String>, Vec<String>) = hls_candidates
            .into_iter()
            .partition(|url| url.contains("d1--cn"));

        if let Some(url) = verify_hls_candidates(&client, &room_id, &preferred_candidates).await {
            tracing::info!(
                "[Bilibili] Selected HLS stream containing 'd1--cn' on attempt {} for room {}",
                attempt_display, room_id
            );
            selected_stream = Some(SelectedStream::Hls(url));
            break;
        }

        if fallback_hls_url.is_none() {
            if let Some(url) = verify_hls_candidates(&client, &room_id, &other_candidates).await {
                fallback_hls_url = Some(url.clone());
                fallback_variants = Some(variants.clone());
            }
        }

        if attempt == MAX_HLS_RETRY {
            if let Some(url) = fallback_hls_url.clone() {
                tracing::info!(
                    "[Bilibili] Using non 'd1--cn' HLS stream after {} attempts for room {}",
                    attempt_display, room_id
                );
                selected_stream = Some(SelectedStream::Hls(url));
                if let Some(fallback) = fallback_variants.clone() {
                    variants_for_response = fallback;
                }
            } else if let Some(url) =
                verify_hls_candidates(&client, &room_id, &other_candidates).await
            {
                tracing::info!(
                    "[Bilibili] Final attempt picked non 'd1--cn' HLS stream for room {}",
                    room_id
                );
                selected_stream = Some(SelectedStream::Hls(url));
                variants_for_response = variants.clone();
            }
        }
    }

    if selected_stream.is_none() {
        if let Some(url) = fallback_hls_url.clone() {
            tracing::info!(
                "[Bilibili] Falling back to cached non 'd1--cn' HLS stream for room {}",
                room_id
            );
            selected_stream = Some(SelectedStream::Hls(url));
            if let Some(fallback) = fallback_variants.clone() {
                variants_for_response = fallback;
            }
        }
    }

    let selected_stream = match selected_stream {
        Some(stream) => stream,
        None => {
            return Ok(crate::platforms::common::LiveStreamInfo {
                title: init_json["data"]["title"].as_str().map(|s| s.to_string()),
                anchor_name: init_json["data"]["uname"].as_str().map(|s| s.to_string()),
                avatar: None,
                stream_url: None,
                status: Some(2),
                error_message: Some("未找到可用的直播流地址".to_string()),
                upstream_url: None,
                available_streams: Some(variants_for_response),
                normalized_room_id: None,
                web_rid: None,
            });
        }
    };

    match selected_stream {
        SelectedStream::Flv(real_url) => {
            // FLV：写入到 Store 并启动代理
            let proxied_url = {
                {
                    let mut urls = stream_url_store.urls.lock().unwrap();
                    urls.insert(("bilibili".to_string(), room_id.clone()), real_url.clone());
                }
                match start_proxy(app_handle, proxy_server_handle, stream_url_store).await {
                    Ok(_) => Some(get_proxy_url("bilibili", &room_id).await),
                    Err(e) => {
                        tracing::error!("[Bilibili] Failed to start proxy: {}", e);
                        None
                    }
                }
            };

            let final_error_message = if proxied_url.is_none() {
                Some("代理启动失败".to_string())
            } else {
                None
            };

            Ok(crate::platforms::common::LiveStreamInfo {
                title: init_json["data"]["title"].as_str().map(|s| s.to_string()),
                anchor_name: init_json["data"]["uname"].as_str().map(|s| s.to_string()),
                avatar: None,
                stream_url: proxied_url,
                status: Some(if final_error_message.is_some() { 2 } else { 1 }),
                error_message: final_error_message,
                upstream_url: Some(real_url),
                available_streams: Some(variants_for_response.clone()),
                normalized_room_id: None,
                web_rid: None,
            })
        }
        SelectedStream::Hls(real_url) => {
            // HLS：无需本地代理，不再全局关闭代理服务器，避免影响其他直播间
            {
                let mut urls = stream_url_store.urls.lock().unwrap();
                urls.remove(&("bilibili".to_string(), room_id.clone()));
            }

            Ok(crate::platforms::common::LiveStreamInfo {
                title: init_json["data"]["title"].as_str().map(|s| s.to_string()),
                anchor_name: init_json["data"]["uname"].as_str().map(|s| s.to_string()),
                avatar: None,
                stream_url: Some(real_url.clone()),
                status: Some(1),
                error_message: None,
                upstream_url: Some(real_url),
                available_streams: Some(variants_for_response),
                normalized_room_id: None,
                web_rid: None,
            })
        }
    }
}
