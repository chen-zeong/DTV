use reqwest::header::{HeaderMap as ReqwestHeaderMap, HeaderName, HeaderValue, USER_AGENT};
use reqwest::{cookie::Jar, Client, RequestBuilder, Response};
use std::error::Error;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;

pub const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36";
// 部分平台（如抖音）接口在网络抖动时响应较慢，20s 容易触发超时。
// 这里提高默认超时时间以提升稳定性（不改变业务算法）。
const DEFAULT_TIMEOUT_SECONDS: u64 = 45;
const FOLLOW_POOL_MAX_IDLE_PER_HOST: usize = 2;
const FOLLOW_POOL_IDLE_TIMEOUT_SECONDS: u64 = 15;

#[derive(Debug, Clone)]
pub struct HttpClient {
    pub inner: Client,
    headers: ReqwestHeaderMap,
}

#[allow(dead_code)]
impl HttpClient {
    fn format_reqwest_error(e: &reqwest::Error) -> String {
        let mut out = e.to_string();
        let mut cur = e.source();
        while let Some(src) = cur {
            out.push_str(": ");
            out.push_str(&src.to_string());
            cur = src.source();
        }
        out
    }

    fn is_transient_reqwest_error(e: &reqwest::Error) -> bool {
        if e.is_timeout() || e.is_connect() || e.is_request() {
            return true;
        }
        // Some TLS stacks surface transient failures as plain strings.
        let msg = e.to_string().to_lowercase();
        msg.contains("unexpected eof")
            || msg.contains("handshake")
            || msg.contains("connection reset")
            || msg.contains("connection closed")
            || msg.contains("broken pipe")
    }

    pub fn new() -> Result<Self, String> {
        let mut default_headers = ReqwestHeaderMap::new();
        default_headers.insert(
            USER_AGENT,
            HeaderValue::from_str(DEFAULT_USER_AGENT)
                .map_err(|e| format!("Invalid default user agent: {}", e))?,
        );

        let cookie_jar = Arc::new(Jar::default());

        let client_builder = Client::builder()
            // Some platforms' HTTPS endpoints occasionally fail ALPN/HTTP2 negotiation in certain
            // network environments; HTTP/1.1 is more compatible and is enough for these APIs.
            .http1_only()
            .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECONDS))
            .connect_timeout(Duration::from_secs(15))
            .cookie_provider(cookie_jar);

        let inner_client = client_builder
            .build()
            .map_err(|e| format!("Failed to build reqwest client: {}", e))?;

        Ok(HttpClient {
            inner: inner_client,
            headers: default_headers,
        })
    }

    /// 创建一个绕过所有代理的直连HTTP客户端
    /// 这个客户端将忽略系统代理设置，直接连接到目标服务器
    pub fn new_direct_connection() -> Result<Self, String> {
        let mut default_headers = ReqwestHeaderMap::new();
        default_headers.insert(
            USER_AGENT,
            HeaderValue::from_str(DEFAULT_USER_AGENT)
                .map_err(|e| format!("Invalid default user agent: {}", e))?,
        );

        let cookie_jar = Arc::new(Jar::default());

        let client_builder = Client::builder()
            .http1_only()
            .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECONDS))
            .connect_timeout(Duration::from_secs(15))
            .cookie_provider(cookie_jar)
            .no_proxy(); // 关键：禁用所有代理设置

        let inner_client = client_builder
            .build()
            .map_err(|e| format!("Failed to build direct connection reqwest client: {}", e))?;

        Ok(HttpClient {
            inner: inner_client,
            headers: default_headers,
        })
    }

    /// 直连 + 限制连接池规模，用于关注刷新等低并发任务
    pub fn new_direct_limited(max_idle_per_host: usize) -> Result<Self, String> {
        let mut default_headers = ReqwestHeaderMap::new();
        default_headers.insert(
            USER_AGENT,
            HeaderValue::from_str(DEFAULT_USER_AGENT)
                .map_err(|e| format!("Invalid default user agent: {}", e))?,
        );

        let cookie_jar = Arc::new(Jar::default());

        let client_builder = Client::builder()
            .http1_only()
            .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECONDS))
            .connect_timeout(Duration::from_secs(15))
            .cookie_provider(cookie_jar)
            .no_proxy()
            .pool_max_idle_per_host(max_idle_per_host)
            .pool_idle_timeout(Duration::from_secs(FOLLOW_POOL_IDLE_TIMEOUT_SECONDS));

        let inner_client = client_builder
            .build()
            .map_err(|e| format!("Failed to build direct connection reqwest client: {}", e))?;

        Ok(HttpClient {
            inner: inner_client,
            headers: default_headers,
        })
    }

    // Method to add or update a header for subsequent requests made with this client instance
    pub fn insert_header(&mut self, name: HeaderName, value: &str) -> Result<(), String> {
        let header_value = HeaderValue::from_str(value)
            .map_err(|e| format!("Failed to create header value for {}: {}", name, e))?;
        self.headers.insert(name.clone(), header_value);
        Ok(())
    }

    async fn send_request(&self, request_builder: RequestBuilder) -> Result<Response, String> {
        self.send_request_raw(request_builder)
            .await
            .map_err(|e| {
                let msg = Self::format_reqwest_error(&e);
                println!("[HTTP_CLIENT ERROR] HTTP request failed: {}", msg);
                format!("HTTP request execution failed: {}", msg)
            })
    }

    async fn send_request_raw(&self, request_builder: RequestBuilder) -> Result<Response, reqwest::Error> {
        request_builder.headers(self.headers.clone()).send().await
    }

    pub async fn get(&self, url: &str) -> Result<Response, String> {
        // Retry once for transient handshake/connect issues (common on Huya/Douyin/Bilibili in some networks)
        let mut last_err: Option<String> = None;
        for attempt in 0..2 {
            match self.send_request_raw(self.inner.get(url)).await {
                Ok(resp) => return Ok(resp),
                Err(e) => {
                    let msg = Self::format_reqwest_error(&e);
                    last_err = Some(format!("HTTP request execution failed: {}", msg));
                    if attempt == 0 && Self::is_transient_reqwest_error(&e) {
                        sleep(Duration::from_millis(180)).await;
                        continue;
                    }
                    break;
                }
            }
        }
        Err(last_err.unwrap_or_else(|| "HTTP request execution failed: unknown error".to_string()))
    }

    pub async fn get_text(&self, url: &str) -> Result<String, String> {
        let response = self.get(url).await?;
        let status = response.status();
        let response_text = response
            .text()
            .await
            .map_err(|e| format!("Failed to read response body from {}: {}", url, e))?;
        if !status.is_success() {
            return Err(format!(
                "GET {} failed with status {}: {}",
                url, status, response_text
            ));
        }
        Ok(response_text)
    }

    pub async fn get_json<T: serde::de::DeserializeOwned>(&self, url: &str) -> Result<T, String> {
        let response = self.get(url).await?;
        let status = response.status();
        if !status.is_success() {
            let err_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read error body".to_string());
            return Err(format!(
                "GET JSON {} failed with status {}: {}",
                url, status, err_text
            ));
        }
        let json_response = response
            .json::<T>()
            .await
            .map_err(|e| format!("aFailed to parse JSON response from {}: {}", url, e))?;
        Ok(json_response)
    }

    pub async fn post_form(&self, url: &str, form_data: &str) -> Result<Response, String> {
        let response = self
            .send_request(
                self.inner
                    .post(url)
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .body(form_data.to_string()),
            )
            .await?;
        Ok(response)
    }

    pub async fn post_form_json<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        form_data: &str,
    ) -> Result<T, String> {
        let response = self.post_form(url, form_data).await?;
        let status = response.status();
        if !status.is_success() {
            let err_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read error body".to_string());
            return Err(format!(
                "POST FORM {} failed with status {}: {}",
                url, status, err_text
            ));
        }
        let json_response = response
            .json::<T>()
            .await
            .map_err(|e| format!("bFailed to parse JSON response from {}: {}", url, e))?;
        Ok(json_response)
    }

    pub async fn get_json_with_headers<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        headers: Option<ReqwestHeaderMap>,
    ) -> Result<T, String> {
        let mut request_builder = self.inner.get(url);

        if let Some(additional_headers) = headers {
            request_builder = request_builder.headers(additional_headers);
        }

        let response = self.send_request(request_builder).await?;
        let status = response.status();
        if !status.is_success() {
            let err_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read error body".to_string());
            return Err(format!(
                "GET JSON {} failed with status {}: {}",
                url, status, err_text
            ));
        }
        let json_response = response
            .json::<T>()
            .await
            .map_err(|e| format!("cFailed to parse JSON response from {}: {}", url, e))?;
        Ok(json_response)
    }

    pub async fn get_with_cookies(&self, url: &str) -> Result<Response, String> {
        let request_builder = self.inner.get(url).headers(self.headers.clone());
        self.send_request(request_builder).await
    }

    pub async fn get_text_with_headers(
        &self,
        url: &str,
        headers: Option<ReqwestHeaderMap>,
    ) -> Result<String, String> {
        let mut request_builder = self.inner.get(url).headers(self.headers.clone());

        if let Some(additional_headers) = headers {
            request_builder = request_builder.headers(additional_headers);
        }

        let response = self.send_request(request_builder).await?;
        let status = response.status();
        if !status.is_success() {
            let err_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read error body".to_string());
            return Err(format!(
                "GET {} failed with status {}: {}",
                url, status, err_text
            ));
        }
        let text_response = response
            .text()
            .await
            .map_err(|e| format!("Failed to read text response from {}: {}", url, e))?;
        Ok(text_response)
    }

    /// 获取当前设置的headers信息用于调试
    pub fn get_debug_headers(&self) -> String {
        let mut debug_info = String::new();
        for (name, value) in &self.headers {
            if let Ok(value_str) = value.to_str() {
                debug_info.push_str(&format!("  {}: {}\n", name, value_str));
            } else {
                debug_info.push_str(&format!("  {}: [non-UTF8 value]\n", name));
            }
        }
        debug_info
    }

    /// 获取当前cookies信息用于调试
    pub fn get_debug_cookies(&self, _url: &str) -> String {
        // 由于reqwest::Client的cookie_store方法在当前版本中不可用
        // 我们返回一个提示信息，表明cookies是通过headers设置的
        "Cookies are set via headers (check Headers section above for Cookie header)".to_string()
    }
}

/// 专用于关注刷新等低并发任务的 HTTP 客户端包装
#[derive(Debug, Clone)]
pub struct FollowHttpClient(pub HttpClient);

impl FollowHttpClient {
    pub fn new() -> Result<Self, String> {
        Ok(Self(HttpClient::new_direct_limited(
            FOLLOW_POOL_MAX_IDLE_PER_HOST,
        )?))
    }
}
