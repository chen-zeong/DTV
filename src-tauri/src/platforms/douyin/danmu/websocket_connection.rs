use chrono::Utc;
use futures_util::{stream::SplitStream, SinkExt, StreamExt};
use log::{debug, warn};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::mpsc::{self, Sender};
use tokio::sync::watch;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::Message as WsMessage;
use tokio_tungstenite::tungstenite::Error as TungsteniteError;
use tokio_tungstenite::{connect_async, MaybeTlsStream};
use urlencoding;
// use url::Url; // REMOVED AGAIN
// use rand::Rng; // REMOVED AGAIN

// Adjusted imports to use `super` for sibling modules within `danmu`
use super::gen::PushFrame; // Removed ::douyin
use super::signature; // For generate_signature
use super::web_fetcher::DouyinLiveWebFetcher;
use prost::Message as ProstMessage; // For encoding heartbeat

// Define a type alias for the WebSocket stream for brevity
pub type WsStream = tokio_tungstenite::WebSocketStream<MaybeTlsStream<TcpStream>>;

const DEFAULT_DOUYIN_WS_HOSTS: &[&str] = &[
    // Prefer hosts observed stable in other projects (pure_live uses webcast3-ws-web-lq + webcast5-ws-web-lf).
    "webcast3-ws-web-lq.douyin.com",
    "webcast5-ws-web-lf.douyin.com",
    "webcast5-ws-web-hl.douyin.com",
    "webcast3-ws-web-hl.douyin.com",
    "webcast3-ws-web-lf.douyin.com",
];

fn build_wss_query(cursor: &str, internal_ext: &str, user_unique_id: &str, room_id: &str) -> String {
    format!(
        "webcast/im/push/v2/?app_name=douyin_web&version_code=180800&webcast_sdk_version=1.0.14-beta.0&update_version_code=1.0.14-beta.0&compress=gzip&device_platform=web&cookie_enabled=true&screen_width=1536&screen_height=864&browser_language=zh-CN&browser_platform=Win32&browser_name=Mozilla&browser_version=5.0%20(Windows%20NT%2010.0;%20Win64;%20x64)%20AppleWebKit/537.36%20(KHTML,%20like%20Gecko)%20Chrome/126.0.0.0%20Safari/537.36&browser_online=true&tz_name=Asia/Shanghai&cursor={}&internal_ext={}&host=https://live.douyin.com&aid=6383&live_id=1&did_rule=3&endpoint=live_pc&support_wrds=1&user_unique_id={}&im_path=/webcast/im/fetch/&identity=audience&need_persist_msg_count=15&insert_task_id=&live_reason=&room_id={}&heartbeatDuration=0",
        cursor, internal_ext, user_unique_id, room_id
    )
}

fn douyin_ws_hosts() -> Vec<String> {
    let env_hosts = std::env::var("DTV_DOUYIN_WS_HOSTS").ok();
    if let Some(raw) = env_hosts {
        let hosts: Vec<String> = raw
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();
        if !hosts.is_empty() {
            return hosts;
        }
    }

    DEFAULT_DOUYIN_WS_HOSTS
        .iter()
        .map(|s| s.to_string())
        .collect()
}

fn log_handshake_http_error(host: &str, err: &TungsteniteError) {
    match err {
        TungsteniteError::Http(resp) => {
            let status = resp.status();
            let server = resp
                .headers()
                .get("server")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            let via = resp
                .headers()
                .get("via")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            warn!(
                "[Douyin Danmaku] WebSocket handshake HTTP error from host {}: status={} server='{}' via='{}'",
                host, status, server, via
            );
        }
        _ => {
            warn!(
                "[Douyin Danmaku] WebSocket connect error on host {}: {}",
                host, err
            );
        }
    }
}

// This function will establish the connection and spawn send/heartbeat tasks.
// It returns the read half of the stream and the sender for the outgoing message channel.
pub async fn connect_and_manage_websocket(
    fetcher: &DouyinLiveWebFetcher, // Read-only, used for UA
    room_id: &str,
    cookie_header: &str,
    user_unique_id: &str,
) -> Result<(SplitStream<WsStream>, Sender<WsMessage>, watch::Sender<bool>), Box<dyn std::error::Error + Send + Sync>> {
    let ws_cookie_header = cookie_header.to_string();
    let current_timestamp_ms = Utc::now().timestamp_millis();
    let first_req_ms = current_timestamp_ms - 100;
    let cursor = format!(
        "d-1_u-1_fh-7392091211001140287_t-{}_r-1",
        current_timestamp_ms
    );
    let internal_ext_original = format!(
        "internal_src:dim|wss_push_room_id:{}|wss_push_did:{}|first_req_ms:{}|fetch_time:{}|seq:1|wss_info:0-{}-0-0|wrds_v:7392094459690748497",
        room_id, user_unique_id, first_req_ms, current_timestamp_ms, current_timestamp_ms
    ).replace("\n", "").replace(" ", "");

    let hosts = douyin_ws_hosts();

    // Compute signature once; it depends on a subset of query params, not on the WS host.
    let signature_url_for_md5 = format!(
        "wss://{}/{}",
        hosts
            .get(0)
            .map(|s| s.as_str())
            .unwrap_or("webcast5-ws-web-hl.douyin.com"),
        build_wss_query(&cursor, &internal_ext_original, user_unique_id, room_id)
    );
    let signature = signature::generate_signature(&signature_url_for_md5).await?;
    let internal_ext_encoded = urlencoding::encode(&internal_ext_original);

    let mut last_err: Option<Box<dyn std::error::Error + Send + Sync>> = None;
    let mut last_host: Option<String> = None;
    let mut last_http_status: Option<u16> = None;

    let user_agent = fetcher.user_agent.clone();
    let mut connected: Option<tokio_tungstenite::WebSocketStream<MaybeTlsStream<TcpStream>>> = None;

    for host in hosts {
        last_host = Some(host.clone());
        let final_wss_url_str = format!(
            "wss://{}/{}&signature={}",
            host,
            build_wss_query(&cursor, &internal_ext_encoded, user_unique_id, room_id),
            &signature
        );

        let mut client_request = match final_wss_url_str.into_client_request() {
            Ok(req) => req,
            Err(e) => {
                last_err = Some(Box::new(e));
                continue;
            }
        };

        let headers = client_request.headers_mut();
        headers.insert("accept", "application/json, text/plain, */*".parse()?);
        headers.insert("accept-language", "zh-CN,zh;q=0.9,en;q=0.8".parse()?);
        headers.insert("cache-control", "no-cache".parse()?);
        headers.insert("pragma", "no-cache".parse()?);
        headers.insert(
            "sec-websocket-extensions",
            "permessage-deflate; client_max_window_bits".parse()?,
        );
        headers.insert("sec-websocket-version", "13".parse()?);
        headers.insert("origin", "https://live.douyin.com".parse()?);
        headers.insert("user-agent", user_agent.parse()?);
        headers.insert("Cookie", ws_cookie_header.parse()?);

        debug!("[Douyin Danmaku] Trying WebSocket host: {}", host);
        match timeout(Duration::from_secs(12), connect_async(client_request)).await {
            Ok(Ok((ws_stream, _response))) => {
                debug!("[Douyin Danmaku] WebSocket connected via host: {}", host);
                connected = Some(ws_stream);
                break;
            }
            Ok(Err(e)) => {
                if let TungsteniteError::Http(resp) = &e {
                    last_http_status = Some(resp.status().as_u16());
                }
                log_handshake_http_error(&host, &e);
                last_err = Some(Box::new(e));
                continue;
            }
            Err(e) => {
                warn!(
                    "[Douyin Danmaku] WebSocket connect timeout on host {}: {}",
                    host, e
                );
                last_err = Some(Box::new(e));
                continue;
            }
        }
    }

    let ws_stream = if let Some(s) = connected {
        s
    } else {
        let host = last_host.unwrap_or_else(|| "<none>".to_string());
        let status_part = last_http_status
            .map(|s| format!("http_status={s}"))
            .unwrap_or_else(|| "http_status=<none>".to_string());
        return Err(format!(
            "All Douyin WebSocket hosts failed (last_host={}, {}): {}",
            host, status_part,
            last_err
                .map(|e| e.to_string())
                .unwrap_or_else(|| "unknown error".to_string())
        )
        .into());
    };

    let (mut write, read) = ws_stream.split(); // read will be returned

    // Channel for sending messages to the WebSocket Sink
    let (tx, mut rx) = mpsc::channel::<WsMessage>(32);

    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

    // Spawn task for sending heartbeats and other messages from the channel
    tokio::spawn(async move {
        let heartbeat_msg_proto = PushFrame {
            payload_type: "hb".to_string(),
            log_id: 0,
            payload: vec![],
            ..Default::default()
        };
        let mut heartbeat_buf = Vec::new();
        heartbeat_msg_proto.encode(&mut heartbeat_buf).unwrap(); // Assuming encode is from ProstMessage trait
        let ws_ping_msg = WsMessage::Ping(heartbeat_buf);

        let mut ticker = tokio::time::interval(Duration::from_secs(5));

        loop {
            tokio::select! {
                _ = shutdown_rx.changed() => {
                    if *shutdown_rx.borrow() {
                        break;
                    }
                }
                _ = ticker.tick() => {
                    if let Err(e) = write.send(ws_ping_msg.clone()).await {
                        warn!("[Douyin Danmaku] Heartbeat send error: {}", e);
                        break;
                    }
                }
                msg_opt = rx.recv() => {
                    match msg_opt {
                        Some(msg_to_send) => {
                            if let Err(e) = write.send(msg_to_send).await {
                                warn!("[Douyin Danmaku] Send error: {}", e);
                                // Potentially break or signal error if a crucial message (like ACK) fails
                                if matches!(e, tokio_tungstenite::tungstenite::Error::ConnectionClosed |
                                               tokio_tungstenite::tungstenite::Error::AlreadyClosed) {
                                    break; // Stop if connection is closed
                                }
                            }
                        }
                        None => break,
                    }
                }
                else => {
                    // Channel closed, no more messages to send from other tasks
                    break;
                }
            }
        }
        debug!("[Douyin Danmaku] WebSocket send/heartbeat task ended.");
    });

    Ok((read, tx, shutdown_tx)) // Return the read stream and the sender for other tasks to send messages
}
