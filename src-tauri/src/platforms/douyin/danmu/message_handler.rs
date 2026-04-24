use flate2::read::GzDecoder;
use futures_util::{stream::SplitStream, StreamExt};
use log::{debug, warn};
use prost::Message as ProstMessage; // For decode/encode
use std::io::Read;
use tauri::Emitter;
use tokio::sync::mpsc::Sender;
use tokio_tungstenite::tungstenite::protocol::Message as WsMessage; // Import the Emitter trait for app_handle.emit()

use crate::platforms::douyin::danmu::gen::{PushFrame, Response}; // Removed ::douyin
use crate::platforms::douyin::danmu::message_parsers;
use crate::platforms::douyin::danmu::websocket_connection::WsStream; // Corrected path // Corrected path

// This function will handle the message receiving loop and parsing
pub async fn handle_received_messages(
    mut read_stream: SplitStream<WsStream>,
    ack_tx: Sender<WsMessage>,
    app_handle: tauri::AppHandle, // Added AppHandle
    room_id: String,              // Added room_id parameter
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    debug!("[Douyin Danmaku] Message handler started for room_id: {}", room_id);
    while let Some(message_result) = read_stream.next().await {
        match message_result {
            Ok(ws_msg) => {
                if let WsMessage::Binary(bin_data) = ws_msg {
                    match PushFrame::decode(bin_data.as_slice()) {
                        Ok(push_frame) => {
                            if push_frame.payload_type == "msg" && !push_frame.payload.is_empty() {
                                let mut gz = GzDecoder::new(push_frame.payload.as_slice());
                                let mut decompressed_payload = Vec::new();
                                if let Err(e) = gz.read_to_end(&mut decompressed_payload) {
                                    warn!("[Douyin Danmaku] Gzip decompression error: {}", e);
                                    continue;
                                }
                                match Response::decode(decompressed_payload.as_slice()) {
                                    Ok(response) => {
                                        if response.need_ack {
                                            let ack_payload_bytes =
                                                response.internal_ext.encode_to_vec();
                                            let ack_push_frame = PushFrame {
                                                log_id: push_frame.log_id,
                                                payload_type: "ack".to_string(),
                                                payload: ack_payload_bytes,
                                                ..Default::default()
                                            };
                                            let mut ack_buf = Vec::new();
                                            if ack_push_frame.encode(&mut ack_buf).is_ok() {
                                                if ack_tx
                                                    .send(WsMessage::Binary(ack_buf))
                                                    .await
                                                    .is_err()
                                                {
                                                    warn!("[Douyin Danmaku] Failed to send ACK message via channel");
                                                }
                                            } else {
                                                warn!("[Douyin Danmaku] Failed to encode ACK PushFrame for channel");
                                            }
                                        }
                                        for msg in response.messages_list {
                                            // println!("  -> Method: {}, Payload Length: {}", msg.method, msg.payload.len());
                                            let mut danmaku_to_send = None;
                                            if msg.method == "WebcastChatMessage" {
                                                match message_parsers::parse_chat_message(
                                                    &msg.payload,
                                                    &room_id,
                                                ) {
                                                    Ok(Some(chat_payload)) => {
                                                        danmaku_to_send = Some(chat_payload);
                                                    }
                                                    Ok(None) => { /* Not a message to display or ignored */
                                                    }
                                                    Err(_e) => { /* Error already logged in parser */
                                                    }
                                                }
                                            }
                                            // Add other message types here if needed, similar to ChatMessage
                                            // else if msg.method == "WebcastMemberMessage" { ... }

                                            if let Some(payload) = danmaku_to_send {
                                                // Use app_handle.emit for Tauri v2 style global event emitting
                                                if let Err(e) = app_handle
                                                    .emit("danmaku-message", payload.clone())
                                                {
                                                    // payload needs to be Clone for emit
                                                    warn!("[Douyin Danmaku] Failed to emit danmaku event: {}", e);
                                                }
                                            }
                                        }
                                    }
                                    Err(e) => warn!("[Douyin Danmaku] Failed to parse Response: {}", e),
                                }
                            } else if push_frame.payload_type == "ack" {
                                // Optional: log received ACKs from server
                                // println!("[Douyin Danmaku] Received ACK from server for log_id: {}", push_frame.log_id);
                            } else if push_frame.payload_type == "hb" {
                                // Optional: log received server heartbeats
                                // println!("[Douyin Danmaku] Received Heartbeat from server.");
                            }
                        }
                        Err(e) => warn!("[Douyin Danmaku] Failed to parse PushFrame: {}", e),
                    }
                } else if let WsMessage::Ping(ping_data) = ws_msg {
                    if ack_tx.send(WsMessage::Pong(ping_data)).await.is_err() {
                        warn!("[Douyin Danmaku] Failed to send PONG from message_handler");
                    }
                } else if let WsMessage::Close(close_frame) = ws_msg {
                    debug!("[Douyin Danmaku] WebSocket closed by server: {:?}", close_frame);
                    break;
                }
            }
            Err(e) => {
                warn!(
                    "[Douyin Danmaku] WebSocket receive error in message_handler: {}",
                    e
                );
                break;
            }
        }
    }
    debug!("[Douyin Danmaku] Message handler finished.");
    Ok(())
}
