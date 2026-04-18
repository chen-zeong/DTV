use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, ORIGIN, REFERER, USER_AGENT,
};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct HuyaAnchorItem {
    pub room_id: String,
    pub avatar: String,
    pub user_name: String,
    pub live_status: bool,
    pub title: String,
}

#[tauri::command]
pub async fn search_huya_anchors(
    keyword: String,
    page: Option<usize>,
) -> Result<Vec<HuyaAnchorItem>, String> {
    let client = reqwest::Client::builder()
        .http1_only()
        .connect_timeout(std::time::Duration::from_secs(15))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let url = "https://search.cdn.huya.com/";
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36"));
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://www.huya.com/search/"),
    );
    headers.insert(ORIGIN, HeaderValue::from_static("https://www.huya.com"));
    headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("zh-CN,zh;q=0.9"));

    let page_num = page.unwrap_or(1);

    let resp = client
        .get(url)
        .headers(headers)
        .query(&[
            ("m", "Search"),
            ("do", "getSearchContent"),
            ("q", &keyword),
            ("uid", "0"),
            ("v", "1"),
            ("typ", "-5"),
            ("livestate", "0"),
            ("rows", "20"),
            ("start", &((page_num - 1) * 20).to_string()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;

    let text = resp.text().await.map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let mut items = vec![];
    if let Some(list) = v
        .get("response")
        .and_then(|r| r.get("1"))
        .and_then(|d| d.get("docs"))
        .and_then(|a| a.as_array())
    {
        for item in list {
            let anchor = HuyaAnchorItem {
                room_id: item
                    .get("room_id")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0)
                    .to_string(),
                avatar: item
                    .get("game_avatarUrl180")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                user_name: item
                    .get("game_nick")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                live_status: item
                    .get("gameLiveOn")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                title: item
                    .get("live_intro")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
            };
            items.push(anchor);
        }
    }
    Ok(items)
}
