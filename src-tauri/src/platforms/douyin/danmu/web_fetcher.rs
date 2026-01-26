use crate::platforms::common::http_client::HttpClient;
use crate::platforms::douyin::web_api::{
    fetch_room_data, normalize_douyin_live_id, DouyinRoomData, DEFAULT_USER_AGENT,
};
use serde_json::{self, Value};
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, REFERER, USER_AGENT};

#[derive(Debug, Clone)]
#[allow(dead_code)]
struct ResolvedRoomInfo {
    pub web_rid: Option<String>,
    pub room_id: String,
    pub nickname: String,
    pub room_name: String,
    pub avatar_url: String,
    pub status: i32,
}

pub struct DouyinLiveWebFetcher {
    pub live_id: String,
    pub room_id: Option<String>,
    resolved_info: Option<ResolvedRoomInfo>,
    pub user_agent: String,
    pub http_client: HttpClient,
    pub(crate) _ws_stream: Option<Arc<Mutex<WebSocketStream<MaybeTlsStream<TcpStream>>>>>,
    // 新增字段：用于 WebSocket 和签名所需
    pub dy_cookie: Option<String>,
    pub user_unique_id: Option<String>,
}

impl DouyinLiveWebFetcher {
    pub fn new(live_id: &str) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        // 使用直连HTTP客户端，绕过所有代理设置
        let http_client = HttpClient::new_direct_connection()
            .map_err(|e| format!("Failed to create direct connection HttpClient: {}", e))?;
        let normalized_live_id = normalize_douyin_live_id(live_id);

        Ok(DouyinLiveWebFetcher {
            live_id: normalized_live_id,
            room_id: None,
            resolved_info: None,
            user_agent: DEFAULT_USER_AGENT.to_string(),
            http_client,
            _ws_stream: None,
            dy_cookie: None,
            user_unique_id: None,
        })
    }

    async fn resolve_room_info(
        &mut self,
    ) -> Result<ResolvedRoomInfo, Box<dyn std::error::Error + Send + Sync>> {
        if let Some(info) = &self.resolved_info {
            return Ok(info.clone());
        }

        let live_id = self.live_id.clone();
        let cookies = self.dy_cookie.as_deref();
        // 直接使用和 douyin_rust 相同的接口 + a_bogus，避免 HTML 解析失败。
        match fetch_room_data(&self.http_client, &live_id, cookies, false).await {
            Ok(DouyinRoomData { room }) => {
                let room_id = room
                    .get("id_str")
                    .and_then(|v| v.as_str())
                    .or_else(|| room.get("id").and_then(|v| v.as_str()))
                    .unwrap_or(&live_id)
                    .to_string();
                let status = room.get("status").and_then(|v| v.as_i64()).unwrap_or(-1) as i32;
                let room_name = room
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let owner = room.get("owner").cloned().unwrap_or_else(|| Value::Null);
                let anchor = room.get("anchor").cloned().unwrap_or_else(|| Value::Null);
                let nickname = owner
                    .get("nickname")
                    .and_then(|v| v.as_str())
                    .or_else(|| anchor.get("nickname").and_then(|v| v.as_str()))
                    .unwrap_or("")
                    .to_string();
                let avatar_url = owner
                    .get("avatar_thumb")
                    .or_else(|| anchor.get("avatar_thumb"))
                    .and_then(|a| a.get("url_list"))
                    .and_then(|ul| ul.get(0))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let web_rid_val = owner
                    .get("web_rid")
                    .and_then(|v| v.as_str())
                    .or_else(|| anchor.get("web_rid").and_then(|v| v.as_str()))
                    .unwrap_or(&live_id)
                    .to_string();

                let info = ResolvedRoomInfo {
                    web_rid: Some(web_rid_val),
                    room_id: room_id.clone(),
                    nickname,
                    room_name,
                    avatar_url,
                    status,
                };
                self.room_id = Some(room_id);
                self.resolved_info = Some(info.clone());
                Ok(info)
            }
            Err(api_err) => Err(Box::new(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("Failed to resolve via web enter API: {}", api_err),
            ))),
        }
    }

    pub async fn collect_cookies_and_ids(
        &mut self,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Ensure room_id has been resolved before collecting cookies
        self.resolve_room_info().await?;

        let homepage_url = "https://live.douyin.com/";

        // 先通过 HEAD 请求收集初始 Cookie
        let head_resp = self
            .http_client
            .inner
            .head(homepage_url)
            .header("User-Agent", &self.user_agent)
            .header("Referer", "https://live.douyin.com")
            .header("Authority", "live.douyin.com")
            .send()
            .await?;

        let mut dy_cookie = String::new();
        for val in head_resp.headers().get_all("set-cookie").iter() {
            if let Ok(s) = val.to_str() {
                let first = s.split(';').next().unwrap_or("");
                if first.contains("ttwid")
                    || first.contains("__ac_nonce")
                    || first.contains("msToken")
                    || first.contains("s_v_web_id")
                    || first.contains("tt_scid")
                {
                    dy_cookie.push_str(first);
                    dy_cookie.push(';');
                }
            }
        }

        // 再通过 GET 请求补全 Cookie
        let get_resp = self
            .http_client
            .inner
            .get(homepage_url)
            .header("User-Agent", &self.user_agent)
            .header("Referer", "https://live.douyin.com")
            .send()
            .await?;

        for val in get_resp.headers().get_all("set-cookie").iter() {
            if let Ok(s) = val.to_str() {
                let first = s.split(';').next().unwrap_or("");
                if first.contains("ttwid")
                    || first.contains("__ac_nonce")
                    || first.contains("msToken")
                    || first.contains("s_v_web_id")
                    || first.contains("tt_scid")
                {
                    if !dy_cookie.contains(first) {
                        dy_cookie.push_str(first);
                        dy_cookie.push(';');
                    }
                }
            }
        }

        // 从 Cookie 中提取 user_unique_id（优先使用 s_v_web_id），失败则回退到 ttwid，最后生成一个临时值
        let mut user_unique_id = String::new();
        for kv in dy_cookie.split(';') {
            let kv = kv.trim();
            if let Some(v) = kv.strip_prefix("s_v_web_id=") {
                user_unique_id = v.to_string();
                break;
            }
        }
        if user_unique_id.is_empty() {
            for kv in dy_cookie.split(';') {
                let kv = kv.trim();
                if let Some(v) = kv.strip_prefix("ttwid=") {
                    user_unique_id = v.to_string();
                    break;
                }
            }
        }
        if user_unique_id.is_empty() {
            // 生成一个简单的基于当前时间戳的 ID，避免为空导致签名/连接失败
            let millis = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            user_unique_id = format!("{}", millis);
        }

        // 设置 room_id：如果尚未设置，且传入的 live_id 是纯数字，则直接视为 room_id
        self.dy_cookie = Some(dy_cookie);
        self.user_unique_id = Some(user_unique_id);
        Ok(())
    }

    pub async fn fetch_room_details(
        &mut self,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // 仅收集 Cookie 与识别 user_unique_id，不再解析房间 HTML。
        self.collect_cookies_and_ids().await?;
        Ok(())
    }

    pub async fn get_room_id(
        &mut self,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        if let Some(room_id) = &self.room_id {
            return Ok(room_id.clone());
        }
        // Ensure identifiers resolved
        self.resolve_room_info().await?;
        self.room_id
            .clone()
            .ok_or_else(|| "room_id not set after cookie collection".into())
    }

    pub async fn get_user_unique_id(
        &mut self,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        if let Some(uid) = &self.user_unique_id {
            return Ok(uid.clone());
        }
        self.collect_cookies_and_ids().await?;
        self.user_unique_id
            .clone()
            .ok_or_else(|| "user_unique_id not set after cookie collection".into())
    }

    pub async fn get_dy_cookie(
        &mut self,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        if let Some(cookie) = &self.dy_cookie {
            return Ok(cookie.clone());
        }
        self.collect_cookies_and_ids().await?;
        self.dy_cookie
            .clone()
            .ok_or_else(|| "cookie not set after cookie collection".into())
    }

    #[allow(dead_code)]
    pub async fn get_room_status(
        &mut self,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Ensure we have room_id and cookies collected
        let room_id_val = self.get_room_id().await?;
        let dy_cookie = self.get_dy_cookie().await?;
        let user_unique_id = self.get_user_unique_id().await?;

        // Parse msToken from collected cookie string (format: "key=value; key2=value2; ...")
        let ms_token = dy_cookie
            .split(';')
            .filter_map(|kv| {
                let kv = kv.trim();
                if kv.starts_with("msToken=") {
                    Some(kv.trim_start_matches("msToken=").to_string())
                } else {
                    None
                }
            })
            .next()
            .unwrap_or_default();

        // Build minimal and consistent URL using new scheme
        let base_url = "https://live.douyin.com/webcast/room/web/enter/?aid=6383&app_name=douyin_web&live_id=1&device_platform=web&language=zh-CN&cookie_enabled=true";
        let url = if ms_token.is_empty() {
            // Fallback: omit msToken if not present (server may read from Cookie)
            format!(
                "{}&room_id={}&user_unique_id={}",
                base_url, room_id_val, user_unique_id
            )
        } else {
            format!(
                "{}&room_id={}&msToken={}&user_unique_id={}",
                base_url, room_id_val, ms_token, user_unique_id
            )
        };

        // Prepare per-request headers: Accept, Accept-Language, Referer, User-Agent, Cookie
        // Update default User-Agent to the one stored in fetcher to avoid override by HttpClient::send_request
        if let Err(e) = self.http_client.insert_header(USER_AGENT, &self.user_agent) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("Failed to set USER_AGENT header: {}", e),
            )
            .into());
        }

        let mut headers = HeaderMap::new();
        headers.insert(ACCEPT, HeaderValue::from_static("application/json, text/plain, */*"));
        headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("zh-CN,zh;q=0.9"));
        headers.insert(
            REFERER,
            HeaderValue::from_str(&format!("https://live.douyin.com/{}", self.live_id))
                .unwrap_or_else(|_| HeaderValue::from_static("https://live.douyin.com")),
        );
        headers.insert(
            reqwest::header::HeaderName::from_static("cookie"),
            HeaderValue::from_str(&dy_cookie).map_err(|e| {
                std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("Invalid Cookie header: {}", e),
                )
            })?,
        );

        let data: serde_json::Value = match self
            .http_client
            .get_json_with_headers(&url, Some(headers))
            .await
        {
            Ok(v) => v,
            Err(e) => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("Failed to get room status: {}", e),
                )
                .into())
            }
        };

        // Parse and log basic room and owner info
        if let Some(room_data_top) = data.get("data") {
            if let Some(room_info) = room_data_top.get("room") {
                let room_status_val = room_info.get("status").and_then(|s| s.as_i64());
                if let Some(user_data) = room_info.get("owner") {
                    let user_id = user_data.get("id_str").and_then(|s| s.as_str());
                    let nickname = user_data.get("nickname").and_then(|s| s.as_str());

                    if let (Some(status), Some(id), Some(nick)) =
                        (room_status_val, user_id, nickname)
                    {
                        let status_text = if status == 0 {
                            "正在直播"
                        } else {
                            "已结束"
                        };
                        println!("【{}】[{}]直播间：{}.", nick, id, status_text);
                    } else {
                        println!("【X】无法解析直播间信息的部分字段 (status, id, nick)");
                    }
                } else {
                    println!("【X】未找到用户信息 (owner data in room_data.room)");
                }
            } else {
                println!("【X】未找到房间信息 (room object in room_data_top)");
            }
        } else {
            println!("【X】未找到顶层房间数据 (data object in response)");
        }
        Ok(())
    }

    // fetch_room_details moved earlier to only collect cookies and HTML IDs; old implementation removed.

    // pub async fn connect_websocket_placeholder(&mut self, _room_id_param: &str, _ttwid_param: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    //     println!("Connect_websocket logic will be moved elsewhere.");
    //     Ok(())
    // }
}
