use crate::platforms::common::signing::hash::md5_hex;
use percent_encoding::{percent_encode, NON_ALPHANUMERIC};
use reqwest::{
    header::{HeaderMap, HeaderValue},
    redirect::Policy,
    Client,
};
use std::time::{SystemTime, UNIX_EPOCH}; // For timestamp for did // For URL encoding keyword

// Renamed from search_anchor to avoid ambiguity with Tauri command
pub async fn perform_anchor_search(keyword: &str) -> Result<String, Box<dyn std::error::Error>> {
    let mut default_headers = HeaderMap::new();
    default_headers.insert(
        "User-Agent",
        HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"),
    );

    let client = Client::builder()
        .redirect(Policy::limited(10))
        .no_proxy()
        .default_headers(default_headers)
        .build()?;

    let did = md5_hex(
        &SystemTime::now()
            .duration_since(UNIX_EPOCH)?
            .as_nanos()
            .to_string(),
    );

    let url = format!(
        "https://www.douyu.com/japi/search/api/searchUser?kw={}&page=1&pageSize=20&filterType=0",
        percent_encode(keyword.as_bytes(), NON_ALPHANUMERIC)
    );

    let text = client
        .get(url)
        .header("Referer", "https://www.douyu.com/search/")
        .header("Cookie", format!("dy_did={}; acf_did={}", did, did))
        .send()
        .await?
        .text()
        .await?;

    Ok(text)
}
