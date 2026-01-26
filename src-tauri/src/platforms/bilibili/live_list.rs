use crate::platforms::common::signing::hash::md5_hex;
use crate::platforms::common::signing::query::join_kv_pairs;

// 引入 generate_bilibili_w_webid 以便在缺失时后端自动初始化
use crate::platforms::bilibili::state::{generate_bilibili_w_webid, BilibiliState};

#[tauri::command]
pub async fn fetch_bilibili_live_list(
    area_id: String,
    parent_area_id: String,
    page: u32,
    state: tauri::State<'_, BilibiliState>,
) -> Result<String, String> {
    use std::time::{SystemTime, UNIX_EPOCH};

    // 每次请求前都刷新一次 w_webid，避免使用过期的 ID
    let w_webid = match generate_bilibili_w_webid(state.clone()).await {
        Ok(id) => {
            println!("[Bilibili] Refreshed w_webid: {}", id);
            id
        }
        Err(e) => {
            eprintln!("[Bilibili] Failed to refresh w_webid, will fallback to cached value if available: {}", e);
            let fallback = { state.w_webid.lock().unwrap().clone() };
            match fallback {
                Some(id) => {
                    println!(
                        "[Bilibili] Using cached w_webid due to refresh failure: {}",
                        id
                    );
                    id
                }
                None => return Err(format!("w_webid 获取失败: {}", e)),
            }
        }
    };

    let wts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64;
    let pairs = vec![
        ("area_id", area_id.clone()),
        ("page", page.to_string()),
        ("parent_area_id", parent_area_id.clone()),
        ("platform", "web".to_string()),
        ("sort_type", "".to_string()),
        ("vajra_business_key", "".to_string()),
        ("w_webid", w_webid.clone()),
        ("web_location", "444.253".to_string()),
        ("wts", wts.to_string()),
    ];
    let secret = "ea1db124af3c7062474693fa704f4ff8";
    let sign_string = format!(
        "{}{}",
        join_kv_pairs(pairs.iter().map(|(k, v)| (*k, v.as_str()))),
        secret
    );
    let w_rid = md5_hex(&sign_string);

    let mut params: Vec<(String, String)> =
        pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
    params.push(("w_rid".to_string(), w_rid));

    let ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
    let url = "https://api.live.bilibili.com/xlive/web-interface/v1/second/getList";
    let query_str = join_kv_pairs(params.iter().map(|(k, v)| (k.as_str(), v.as_str())));
    let full_url = format!("{}?{}", url, query_str);

    println!("[Bilibili] Fetch live list: w_webid={}, area_id={}, parent_area_id={}, page={}, wts={}, w_rid={}", w_webid, area_id, parent_area_id, page, wts, &params.iter().find(|(k,_)| k=="w_rid").map(|(_,v)| v.clone()).unwrap_or_default());
    println!("[Bilibili] GET {}", full_url);
    println!(
        "[Bilibili] Headers: User-Agent={}, Referer={}, Cookie={}",
        ua, "https://www.bilibili.com/", "buvid3=i;"
    );

    let client = reqwest::Client::builder()
        .user_agent(ua)
        .no_proxy()
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;

    let resp = client
        .get(url)
        .header("Referer", "https://www.bilibili.com/")
        .header("Cookie", "buvid3=i;")
        .query(&params)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("API status: {}", resp.status()));
    }
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Read text failed: {}", e))?;
    Ok(text)
}
