use tauri::{command, AppHandle, State};

use crate::platforms::common::types::StreamVariant;
use crate::platforms::common::{
    infer_stream_type, truncate_variants, GetLiveStreamRequest, LiveStatus, LiveStreamResponse,
    LiveStreamMode, Playback, RoomMeta,
};
use crate::platforms::common::{FollowHttpClient, GetStreamUrlPayload};
use crate::platforms::common::types_rust::SupportedPlatformRust;
use crate::proxy::{start_proxy, ProxyServerHandle, get_proxy_url};
use crate::StreamUrlStore;
use crate::platforms::bilibili::state::BilibiliState;

use crate::platforms::common::errors::classify_error_message;

fn normalize_douyin_quality(input: Option<&str>) -> String {
    let raw = input.unwrap_or("OD").trim();
    let upper = raw.to_uppercase();
    if upper == "OD" || raw.contains("原画") {
        return "OD".to_string();
    }
    if upper == "BD" || raw.contains("高清") {
        return "BD".to_string();
    }
    if upper == "UHD" || raw.contains("标清") {
        return "UHD".to_string();
    }
    "OD".to_string()
}

fn map_variants_debug(
    debug_enabled: bool,
    variants: Option<Vec<StreamVariant>>,
) -> Option<Vec<StreamVariant>> {
    if !debug_enabled {
        return None;
    }
    variants.map(truncate_variants)
}

fn map_upstream_debug(debug_enabled: bool, upstream: Option<String>) -> Option<String> {
    if !debug_enabled {
        return None;
    }
    upstream
}

#[command]
pub async fn get_live_stream_v2(
    app_handle: AppHandle,
    stream_url_store: State<'_, StreamUrlStore>,
    proxy_server_handle: State<'_, ProxyServerHandle>,
    follow_http: State<'_, FollowHttpClient>,
    bilibili_state: State<'_, BilibiliState>,
    request: GetLiveStreamRequest,
) -> Result<LiveStreamResponse, String> {
    let debug_enabled = request.debug_enabled();
    let mode = request.mode();
    let room_id = request.room_id.trim().to_string();
    if room_id.is_empty() {
        return Ok(LiveStreamResponse {
            status: LiveStatus::Error,
            room: RoomMeta {
                platform: request.platform.clone(),
                room_id,
                normalized_room_id: None,
                web_rid: None,
                title: None,
                anchor_name: None,
                avatar: None,
            },
            playback: None,
            error: Some("room_id cannot be empty".to_string()),
        });
    }

    match request.platform {
        SupportedPlatformRust::Douyu => {
            let room_id = room_id.clone();

            if mode == LiveStreamMode::Meta {
                let info = crate::platforms::douyu::fetch_douyu_room_info(room_id.clone(), follow_http)
                    .await;

                let info = match info {
                    Ok(i) => i,
                    Err(dtv_err) => {
                        let status = if dtv_err.is_offline() {
                            LiveStatus::Offline
                        } else {
                            LiveStatus::Error
                        };
                        return Ok(LiveStreamResponse {
                            status,
                            room: RoomMeta {
                                platform: SupportedPlatformRust::Douyu,
                                room_id,
                                normalized_room_id: None,
                                web_rid: None,
                                title: None,
                                anchor_name: None,
                                avatar: None,
                            },
                            playback: None,
                            error: if status == LiveStatus::Error { Some(dtv_err.to_string()) } else { None },
                        });
                    }
                };

                let status_value = info.show_status.unwrap_or(0);
                let is_live = status_value == 1;

                return Ok(LiveStreamResponse {
                    status: if is_live { LiveStatus::Live } else { LiveStatus::Offline },
                    room: RoomMeta {
                        platform: SupportedPlatformRust::Douyu,
                        room_id: info.room_id,
                        normalized_room_id: None,
                        web_rid: None,
                        title: info.room_name,
                        anchor_name: info.nickname,
                        avatar: info.avatar_url,
                    },
                    playback: None,
                    error: None,
                });
            }

            let quality = request
                .quality
                .clone()
                .unwrap_or_else(|| "原画".to_string());
            let line = request.line.clone();

            let upstream = match crate::platforms::douyu::get_stream_url_with_quality(
                &room_id,
                &quality,
                line.as_deref(),
            )
            .await
            {
                Ok(url) => url,
                Err(dtv_err) => {
                    let status = if dtv_err.is_offline() {
                        LiveStatus::Offline
                    } else {
                        LiveStatus::Error
                    };
                    return Ok(LiveStreamResponse {
                        status,
                        room: RoomMeta {
                            platform: SupportedPlatformRust::Douyu,
                            room_id,
                            normalized_room_id: None,
                            web_rid: None,
                            title: None,
                            anchor_name: None,
                            avatar: None,
                        },
                        playback: None,
                        error: if status == LiveStatus::Error {
                            Some(dtv_err.to_string())
                        } else {
                            None
                        },
                    });
                }
            };

            {
                let mut urls = stream_url_store
                    .urls
                    .lock()
                    .map_err(|_| "Failed to lock StreamUrlStore".to_string())?;
                urls.insert(("douyu".to_string(), room_id.clone()), upstream.clone());
            }
            start_proxy(
                app_handle.clone(),
                proxy_server_handle.clone(),
                stream_url_store.clone(),
            )
            .await?;
            
            let proxy_url = get_proxy_url("douyu", &room_id).await;

            Ok(LiveStreamResponse {
                status: LiveStatus::Live,
                room: RoomMeta {
                    platform: SupportedPlatformRust::Douyu,
                    room_id,
                    normalized_room_id: None,
                    web_rid: None,
                    title: None,
                    anchor_name: None,
                    avatar: None,
                },
                playback: Some(Playback {
                    url: proxy_url,
                    stream_type: infer_stream_type(&upstream),
                    upstream_url: map_upstream_debug(debug_enabled, Some(upstream)),
                    variants: None,
                }),
                error: None,
            })
        }
        SupportedPlatformRust::Huya => {
            let room_id = room_id.clone();
            if mode == LiveStreamMode::Meta {
                let detail = crate::platforms::huya::stream_url::fetch_room_detail(&follow_http.0.inner, &room_id)
                    .await;
                
                let detail = match detail {
                    Ok(d) => d,
                    Err(e) => {
                        let msg = e.to_string();
                        let dtv_err = classify_error_message(&msg);
                        let status = if dtv_err.is_offline() {
                            LiveStatus::Offline
                        } else {
                            LiveStatus::Error
                        };
                        return Ok(LiveStreamResponse {
                            status,
                            room: RoomMeta {
                                platform: SupportedPlatformRust::Huya,
                                room_id,
                                normalized_room_id: None,
                                web_rid: None,
                                title: None,
                                anchor_name: None,
                                avatar: None,
                            },
                            playback: None,
                            error: if status == LiveStatus::Error { Some(msg) } else { None },
                        });
                    }
                };

                return Ok(LiveStreamResponse {
                    status: if detail.status {
                        LiveStatus::Live
                    } else {
                        LiveStatus::Offline
                    },
                    room: RoomMeta {
                        platform: SupportedPlatformRust::Huya,
                        room_id,
                        normalized_room_id: None,
                        web_rid: None,
                        title: detail.title,
                        anchor_name: detail.nick,
                        avatar: detail.avatar180,
                    },
                    playback: None,
                    error: None,
                });
            }

            let quality = request
                .quality
                .clone()
                .unwrap_or_else(|| "原画".to_string());
            let resp = crate::platforms::huya::stream_url::get_huya_unified_cmd(
                room_id.clone(),
                Some(quality.clone()),
                request.line.clone(),
                follow_http,
            )
            .await;

            let resp = match resp {
                Ok(r) => r,
                Err(dtv_err) => {
                    let status = if dtv_err.is_offline() {
                        LiveStatus::Offline
                    } else {
                        LiveStatus::Error
                    };
                    return Ok(LiveStreamResponse {
                        status,
                        room: RoomMeta {
                            platform: SupportedPlatformRust::Huya,
                            room_id,
                            normalized_room_id: None,
                            web_rid: None,
                            title: None,
                            anchor_name: None,
                            avatar: None,
                        },
                        playback: None,
                        error: if status == LiveStatus::Error { Some(dtv_err.to_string()) } else { None },
                    });
                }
            };

            let selected_url = resp.selected_url.clone();
            let is_live = resp.is_live;

            if !is_live || selected_url.as_deref().unwrap_or("").is_empty() {
                return Ok(LiveStreamResponse {
                    status: LiveStatus::Offline,
                    room: RoomMeta {
                        platform: SupportedPlatformRust::Huya,
                        room_id,
                        normalized_room_id: None,
                        web_rid: None,
                        title: resp.title,
                        anchor_name: resp.nick,
                        avatar: resp.avatar,
                    },
                    playback: None,
                    error: None,
                });
            }

            let url = selected_url.unwrap();
            let variants = resp
                .flv_tx_urls
                .iter()
                .map(|entry| StreamVariant {
                    url: entry.url.clone(),
                    format: Some("flv".to_string()),
                    desc: Some(entry.quality.clone()),
                    qn: None,
                    protocol: entry.url.split(':').next().map(|s| s.to_string()),
                })
                .collect::<Vec<_>>();

            {
                let mut urls = stream_url_store
                    .urls
                    .lock()
                    .map_err(|_| "Failed to lock StreamUrlStore".to_string())?;
                urls.insert(("huya".to_string(), room_id.clone()), url.clone());
            }
            start_proxy(
                app_handle.clone(),
                proxy_server_handle.clone(),
                stream_url_store.clone(),
            )
            .await?;

            let proxy_url = get_proxy_url("huya", &room_id).await;

            Ok(LiveStreamResponse {
                status: LiveStatus::Live,
                room: RoomMeta {
                    platform: SupportedPlatformRust::Huya,
                    room_id,
                    normalized_room_id: None,
                    web_rid: None,
                    title: resp.title,
                    anchor_name: resp.nick,
                    avatar: resp.avatar,
                },
                playback: Some(Playback {
                    url: proxy_url,
                    stream_type: infer_stream_type(&url),
                    upstream_url: map_upstream_debug(debug_enabled, Some(url.clone())),
                    variants: map_variants_debug(debug_enabled, Some(variants)),
                }),
                error: None,
            })
        }
        SupportedPlatformRust::Douyin => {
            let room_id = room_id.clone();

            if mode == LiveStreamMode::Meta {
                let payload = GetStreamUrlPayload {
                    args: crate::platforms::common::types::GetStreamUrlArgs {
                        room_id_str: room_id.clone(),
                    },
                };
                let info = crate::platforms::douyin::douyin_streamer_info::fetch_douyin_streamer_info(
                    payload,
                    follow_http,
                )
                .await;

                let info = match info {
                    Ok(i) => i,
                    Err(dtv_err) => {
                        let status = if dtv_err.is_offline() {
                            LiveStatus::Offline
                        } else {
                            LiveStatus::Error
                        };
                        return Ok(LiveStreamResponse {
                            status,
                            room: RoomMeta {
                                platform: SupportedPlatformRust::Douyin,
                                room_id,
                                normalized_room_id: None,
                                web_rid: None,
                                title: None,
                                anchor_name: None,
                                avatar: None,
                            },
                            playback: None,
                            error: if status == LiveStatus::Error { Some(dtv_err.to_string()) } else { None },
                        });
                    }
                };

                if let Some(err) = info.error_message {
                    let dtv_err = classify_error_message(&err);
                    let status = if dtv_err.is_offline() {
                        LiveStatus::Offline
                    } else {
                        LiveStatus::Error
                    };
                    return Ok(LiveStreamResponse {
                        status,
                        room: RoomMeta {
                            platform: SupportedPlatformRust::Douyin,
                            room_id,
                            normalized_room_id: info.normalized_room_id,
                            web_rid: info.web_rid,
                            title: info.title,
                            anchor_name: info.anchor_name,
                            avatar: info.avatar,
                        },
                        playback: None,
                        error: if status == LiveStatus::Error { Some(err) } else { None },
                    });
                }

                let is_live = info.status.unwrap_or_default() == 2;
                return Ok(LiveStreamResponse {
                    status: if is_live { LiveStatus::Live } else { LiveStatus::Offline },
                    room: RoomMeta {
                        platform: SupportedPlatformRust::Douyin,
                        room_id,
                        normalized_room_id: info.normalized_room_id,
                        web_rid: info.web_rid,
                        title: info.title,
                        anchor_name: info.anchor_name,
                        avatar: info.avatar,
                    },
                    playback: None,
                    error: None,
                });
            }

            let quality = normalize_douyin_quality(request.quality.as_deref());
            let payload = GetStreamUrlPayload {
                args: crate::platforms::common::types::GetStreamUrlArgs {
                    room_id_str: room_id.clone(),
                },
            };
            let info = crate::platforms::douyin::douyin_streamer_detail::get_douyin_live_stream_url_with_quality(
                app_handle.clone(),
                stream_url_store.clone(),
                proxy_server_handle.clone(),
                payload,
                quality,
            )
            .await;

            let info = match info {
                Ok(i) => i,
                Err(dtv_err) => {
                    let status = if dtv_err.is_offline() {
                        LiveStatus::Offline
                    } else {
                        LiveStatus::Error
                    };
                    return Ok(LiveStreamResponse {
                        status,
                        room: RoomMeta {
                            platform: SupportedPlatformRust::Douyin,
                            room_id,
                            normalized_room_id: None,
                            web_rid: None,
                            title: None,
                            anchor_name: None,
                            avatar: None,
                        },
                        playback: None,
                        error: if status == LiveStatus::Error { Some(dtv_err.to_string()) } else { None },
                    });
                }
            };

            if let Some(err) = info.error_message.clone() {
                return Ok(LiveStreamResponse {
                    status: LiveStatus::Error,
                    room: RoomMeta {
                        platform: SupportedPlatformRust::Douyin,
                        room_id,
                        normalized_room_id: info.normalized_room_id,
                        web_rid: info.web_rid,
                        title: info.title,
                        anchor_name: info.anchor_name,
                        avatar: info.avatar,
                    },
                    playback: None,
                    error: Some(err),
                });
            }

            let is_live = info.status.unwrap_or_default() == 2;
            if !is_live {
                return Ok(LiveStreamResponse {
                    status: LiveStatus::Offline,
                    room: RoomMeta {
                        platform: SupportedPlatformRust::Douyin,
                        room_id,
                        normalized_room_id: info.normalized_room_id,
                        web_rid: info.web_rid,
                        title: info.title,
                        anchor_name: info.anchor_name,
                        avatar: info.avatar,
                    },
                    playback: None,
                    error: None,
                });
            }

            let Some(url) = info.stream_url.clone() else {
                return Ok(LiveStreamResponse {
                    status: LiveStatus::Error,
                    room: RoomMeta {
                        platform: SupportedPlatformRust::Douyin,
                        room_id,
                        normalized_room_id: info.normalized_room_id,
                        web_rid: info.web_rid,
                        title: info.title,
                        anchor_name: info.anchor_name,
                        avatar: info.avatar,
                    },
                    playback: None,
                    error: Some("stream_url is empty".to_string()),
                });
            };

            let mut final_url = url.clone();
            if let Some(playback_url) = info.stream_url.clone() {
                {
                    let mut urls = stream_url_store
                        .urls
                        .lock()
                        .map_err(|_| "Failed to lock StreamUrlStore".to_string())?;
                    urls.insert(("douyin".to_string(), room_id.clone()), playback_url.clone());
                }
                
                start_proxy(
                    app_handle.clone(),
                    proxy_server_handle.clone(),
                    stream_url_store.clone(),
                )
                .await?;
                
                final_url = get_proxy_url("douyin", &room_id).await;
            }

            Ok(LiveStreamResponse {
                status: LiveStatus::Live,
                room: RoomMeta {
                    platform: SupportedPlatformRust::Douyin,
                    room_id,
                    normalized_room_id: info.normalized_room_id,
                    web_rid: info.web_rid,
                    title: info.title,
                    anchor_name: info.anchor_name,
                    avatar: info.avatar,
                },
                playback: Some(Playback {
                    url: final_url,
                    stream_type: infer_stream_type(&url),
                    upstream_url: map_upstream_debug(debug_enabled, info.upstream_url),
                    variants: map_variants_debug(debug_enabled, info.available_streams),
                }),
                error: None,
            })
        }
        SupportedPlatformRust::Bilibili => {
            let room_id = room_id.clone();

            if mode == LiveStreamMode::Meta {
                let payload = GetStreamUrlPayload {
                    args: crate::platforms::common::types::GetStreamUrlArgs {
                        room_id_str: room_id.clone(),
                    },
                };
                let info = crate::platforms::bilibili::streamer_info::fetch_bilibili_streamer_info(
                    payload,
                    request.cookie.clone(),
                    follow_http,
                    bilibili_state,
                )
                .await;

                let info = match info {
                    Ok(i) => i,
                    Err(dtv_err) => {
                        let status = if dtv_err.is_offline() {
                            LiveStatus::Offline
                        } else {
                            LiveStatus::Error
                        };
                        return Ok(LiveStreamResponse {
                            status,
                            room: RoomMeta {
                                platform: SupportedPlatformRust::Bilibili,
                                room_id,
                                normalized_room_id: None,
                                web_rid: None,
                                title: None,
                                anchor_name: None,
                                avatar: None,
                            },
                            playback: None,
                            error: if status == LiveStatus::Error { Some(dtv_err.to_string()) } else { None },
                        });
                    }
                };

                if let Some(err) = info.error_message {
                    let dtv_err = classify_error_message(&err);
                    let status = if dtv_err.is_offline() {
                        LiveStatus::Offline
                    } else {
                        LiveStatus::Error
                    };
                    return Ok(LiveStreamResponse {
                        status,
                        room: RoomMeta {
                            platform: SupportedPlatformRust::Bilibili,
                            room_id,
                            normalized_room_id: info.normalized_room_id,
                            web_rid: info.web_rid,
                            title: info.title,
                            anchor_name: info.anchor_name,
                            avatar: info.avatar,
                        },
                        playback: None,
                        error: if status == LiveStatus::Error { Some(err) } else { None },
                    });
                }

                let is_live = info.status.unwrap_or_default() == 1;
                return Ok(LiveStreamResponse {
                    status: if is_live { LiveStatus::Live } else { LiveStatus::Offline },
                    room: RoomMeta {
                        platform: SupportedPlatformRust::Bilibili,
                        room_id,
                        normalized_room_id: info.normalized_room_id,
                        web_rid: info.web_rid,
                        title: info.title,
                        anchor_name: info.anchor_name,
                        avatar: info.avatar,
                    },
                    playback: None,
                    error: None,
                });
            }

            let quality = request
                .quality
                .clone()
                .unwrap_or_else(|| "原画".to_string());
            let payload = GetStreamUrlPayload {
                args: crate::platforms::common::types::GetStreamUrlArgs {
                    room_id_str: room_id.clone(),
                },
            };

            let info = crate::platforms::bilibili::stream_url::get_bilibili_live_stream_url_with_quality(
                app_handle.clone(),
                stream_url_store.clone(),
                proxy_server_handle.clone(),
                payload,
                quality,
                request.cookie.clone(),
            )
            .await;

            let info = match info {
                Ok(i) => i,
                Err(dtv_err) => {
                    let status = if dtv_err.is_offline() {
                        LiveStatus::Offline
                    } else {
                        LiveStatus::Error
                    };
                    return Ok(LiveStreamResponse {
                        status,
                        room: RoomMeta {
                            platform: SupportedPlatformRust::Bilibili,
                            room_id,
                            normalized_room_id: None,
                            web_rid: None,
                            title: None,
                            anchor_name: None,
                            avatar: None,
                        },
                        playback: None,
                        error: if status == LiveStatus::Error {
                            Some(dtv_err.to_string())
                        } else {
                            None
                        },
                    });
                }
            };

            if let Some(err) = info.error_message.clone() {
                let dtv_err = classify_error_message(&err);
                let status = if dtv_err.is_offline() {
                    LiveStatus::Offline
                } else {
                    LiveStatus::Error
                };
                return Ok(LiveStreamResponse {
                    status,
                    room: RoomMeta {
                        platform: SupportedPlatformRust::Bilibili,
                        room_id,
                        normalized_room_id: info.normalized_room_id,
                        web_rid: info.web_rid,
                        title: info.title,
                        anchor_name: info.anchor_name,
                        avatar: info.avatar,
                    },
                    playback: None,
                    error: if status == LiveStatus::Error {
                        Some(err)
                    } else {
                        None
                    },
                });
            }

            let Some(url) = info.stream_url.clone() else {
                return Ok(LiveStreamResponse {
                    status: LiveStatus::Offline,
                    room: RoomMeta {
                        platform: SupportedPlatformRust::Bilibili,
                        room_id,
                        normalized_room_id: info.normalized_room_id,
                        web_rid: info.web_rid,
                        title: info.title,
                        anchor_name: info.anchor_name,
                        avatar: info.avatar,
                    },
                    playback: None,
                    error: None,
                });
            };

            Ok(LiveStreamResponse {
                status: LiveStatus::Live,
                room: RoomMeta {
                    platform: SupportedPlatformRust::Bilibili,
                    room_id,
                    normalized_room_id: info.normalized_room_id,
                    web_rid: info.web_rid,
                    title: info.title,
                    anchor_name: info.anchor_name,
                    avatar: info.avatar,
                },
                playback: Some(Playback {
                    url: url.clone(),
                    stream_type: infer_stream_type(&url),
                    upstream_url: map_upstream_debug(debug_enabled, info.upstream_url),
                    variants: map_variants_debug(debug_enabled, info.available_streams),
                }),
                error: None,
            })
        }
    }
}
