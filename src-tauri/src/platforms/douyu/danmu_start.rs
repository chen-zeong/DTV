use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use tauri::{Emitter, Window};
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio::time::Duration;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::{connect_async_tls_with_config, tungstenite::Message};
use url::Url;

#[allow(dead_code)]
pub struct DanmakuClient {
    room_id: String,
    window: Window,
    stop_signal_rx: oneshot::Receiver<()>,
}

#[allow(dead_code)]
impl DanmakuClient {
    pub fn new(room_id: &str, window: Window, stop_signal_rx: oneshot::Receiver<()>) -> Self {
        Self {
            room_id: room_id.to_string(),
            window,
            stop_signal_rx,
        }
    }

    fn encode_msg(&self, msg: &str) -> Vec<u8> {
        let msg_bytes = msg.as_bytes();
        let packet_len = msg_bytes.len() + 9;

        let mut result = Vec::new();
        result.extend_from_slice(&(packet_len as u32).to_le_bytes());
        result.extend_from_slice(&(packet_len as u32).to_le_bytes());
        result.extend_from_slice(&689u16.to_le_bytes());
        result.push(0);
        result.push(0);
        result.extend_from_slice(msg_bytes);
        result.push(0);

        result
    }

    pub async fn start(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let url = Url::parse("wss://danmuproxy.douyu.com:8506/")?;
        let mut request = url.into_client_request()?;
        request
            .headers_mut()
            .insert("Sec-WebSocket-Protocol", "binary".parse()?);

        let (ws_stream, _) = connect_async_tls_with_config(request, None, false, None).await?;

        let (mut write, mut read) = ws_stream.split();

        // 发送登录请求
        let login_msg = format!("type@=loginreq/roomid@={}/", self.room_id);
        let login_data = self.encode_msg(&login_msg);
        write.send(Message::Binary(login_data)).await?;

        // 发送加入房间请求
        let join_msg = format!("type@=joingroup/rid@={}/gid@=1/", self.room_id);
        let join_data = self.encode_msg(&join_msg);
        write.send(Message::Binary(join_data)).await?;

        // 创建消息通道
        let (tx, mut rx) = mpsc::channel(32);

        // 启动心跳任务
        let heartbeat_msg = "type@=mrkl/";
        let heartbeat_data = self.encode_msg(heartbeat_msg);
        let tx_clone = tx.clone();

        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(45)).await;
                if let Err(_) = tx_clone.send(Message::Binary(heartbeat_data.clone())).await {
                    break;
                }
            }
        });

        // Keep a reference to self.stop_signal_rx to move into tasks
        // We need to select between receiving a message from the websocket and the stop signal
        let mut stop_rx = std::mem::replace(&mut self.stop_signal_rx, oneshot::channel().1);

        // Message sending task
        let send_task = tokio::spawn(async move {
            while let Some(msg_to_send) = rx.recv().await {
                if let Err(_) = write.send(msg_to_send).await {
                    break;
                }
            }
        });

        let window = self.window.clone();
        let room_id_clone = self.room_id.clone();

        // Processing incoming messages
        loop {
            tokio::select! {
                _ = &mut stop_rx => {
                    eprintln!("[Douyu Danmaku {}] Stop signal received, terminating listener.", room_id_clone);
                    break;
                }
                msg_option = read.next() => {
                    match msg_option {
                        Some(Ok(Message::Binary(data))) => {
                            if data.len() < 13 {
                                continue;
                            }

                            let content = String::from_utf8_lossy(&data[12..data.len()-1]);
                            let mut result = HashMap::new();
                            for item in content.split('/') {
                                if item.is_empty() {
                                    continue;
                                }
                                if let Some((key, value)) = item.split_once("@=") {
                                    result.insert(
                                        key.to_string(),
                                        value.replace("@S", "/").replace("@A", "@")
                                    );
                                }
                            }

                            let event_name = format!("danmaku-{}", room_id_clone);

                            if result.get("type").map_or(false, |t| t == "chatmsg") {
                                let unknown = "unknown".to_string();
                                let empty = "".to_string();
                                let zero = "0".to_string();

                                let danmaku = serde_json::json!({
                                    "type": "chatmsg",
                                    "nickname": result.get("nn").unwrap_or(&unknown),
                                    "content": result.get("txt").unwrap_or(&empty),
                                    "level": result.get("level").unwrap_or(&zero),
                                    "badgeName": result.get("bnn").unwrap_or(&empty),
                                    "badgeLevel": result.get("bl").unwrap_or(&zero),
                                    "color": result.get("col").map_or(None, |c| Some(c.to_string())),
                                    "room_id": room_id_clone.clone()
                                });

                                let _ = window.emit(&event_name, danmaku);

                                // 统一向前端发送通用弹幕事件，便于跨平台 DanmuList 使用
                                let _ = window.emit(
                                    "danmaku-message",
                                    crate::platforms::common::DanmakuFrontendPayload {
                                        room_id: room_id_clone.clone(),
                                        user: result.get("nn").unwrap_or(&unknown).to_string(),
                                        content: result.get("txt").unwrap_or(&empty).to_string(),
                                        user_level: result
                                            .get("level")
                                            .unwrap_or(&zero)
                                            .parse::<i64>()
                                            .unwrap_or(0),
                                        fans_club_level: result
                                            .get("bl")
                                            .unwrap_or(&zero)
                                            .parse::<i32>()
                                            .unwrap_or(0),
                                    },
                                );
                            } else if result.get("type").map_or(false, |t| t == "uenter") {
                                let unknown = "unknown".to_string();
                                let empty = "".to_string();
                                let zero = "0".to_string();

                                let uenter_msg = serde_json::json!({
                                    "type": "uenter",
                                    "uid": result.get("uid").unwrap_or(&empty),
                                    "nickname": result.get("nn").unwrap_or(&unknown),
                                    "level": result.get("level").unwrap_or(&zero),
                                    "badgeName": result.get("bnn").unwrap_or(&empty),
                                    "badgeLevel": result.get("bl").unwrap_or(&zero),
                                    "room_id": room_id_clone.clone()
                                });
                                let _ = window.emit(&event_name, uenter_msg);
                            }
                        }
                        Some(Ok(Message::Close(_))) | Some(Err(_)) | None => {
                            eprintln!("[Douyu Danmaku {}] Websocket closed or error, terminating listener.", room_id_clone);
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }
        send_task.abort();
        eprintln!("[Douyu Danmaku {}] Listener stopped.", room_id_clone);
        Ok(())
    }
}
