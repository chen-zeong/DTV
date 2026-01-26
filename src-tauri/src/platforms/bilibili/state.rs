use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone, Debug)]
pub struct WbiKeysCache {
    pub img_key: String,
    pub sub_key: String,
    pub expires_at: Instant,
}

#[derive(Default, Clone)]
pub struct BilibiliState {
    pub w_webid: Arc<Mutex<Option<String>>>,
    pub wbi_keys: Arc<Mutex<Option<WbiKeysCache>>>,
}

impl BilibiliState {
    pub fn get_cached_wbi_keys(&self) -> Option<(String, String)> {
        let guard = self.wbi_keys.lock().ok()?;
        let cache = guard.as_ref()?;
        if Instant::now() >= cache.expires_at {
            return None;
        }
        Some((cache.img_key.clone(), cache.sub_key.clone()))
    }

    pub fn set_wbi_keys(&self, img_key: String, sub_key: String, ttl: Duration) {
        if let Ok(mut guard) = self.wbi_keys.lock() {
            *guard = Some(WbiKeysCache {
                img_key,
                sub_key,
                expires_at: Instant::now() + ttl,
            });
        }
    }
}

#[tauri::command]
pub async fn generate_bilibili_w_webid(
    state: tauri::State<'_, BilibiliState>,
) -> Result<String, String> {
    let ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
    let url = "https://live.bilibili.com/lol";
    println!("[Bilibili] Generating w_webid: GET {}", url);
    println!(
        "[Bilibili] Headers: User-Agent={}, Referer={} ",
        ua, "https://www.bilibili.com/"
    );

    let client = reqwest::Client::builder()
        .user_agent(ua)
        .no_proxy()
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;

    let resp = client
        .get(url)
        .header("Referer", "https://www.bilibili.com/")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Read text failed: {}", e))?;

    // 优先在 window._render_data_ 块中查找 access_id
    let mut access_id: Option<String> = None;
    let needle1 = "\"access_id\":\""; // "access_id":"
    let needle2 = "\"access_id\": \""; // "access_id": " (带空格)

    if let Some(block_start) = text.find("window._render_data_") {
        let block = &text[block_start..];
        if let Some(idx) = block.find(needle1) {
            let slice = &block[idx + needle1.len()..];
            if let Some(end_idx) = slice.find('"') {
                access_id = Some(slice[..end_idx].to_string());
            }
        } else if let Some(idx) = block.find(needle2) {
            let slice = &block[idx + needle2.len()..];
            if let Some(end_idx) = slice.find('"') {
                access_id = Some(slice[..end_idx].to_string());
            }
        }
    }

    // 兜底：全页搜索 access_id
    if access_id.is_none() {
        if let Some(idx) = text.find(needle1) {
            let slice = &text[idx + needle1.len()..];
            if let Some(end_idx) = slice.find('"') {
                access_id = Some(slice[..end_idx].to_string());
            }
        } else if let Some(idx) = text.find(needle2) {
            let slice = &text[idx + needle2.len()..];
            if let Some(end_idx) = slice.find('"') {
                access_id = Some(slice[..end_idx].to_string());
            }
        }
    }

    let w_webid = access_id.ok_or_else(|| "Failed to extract w_webid (access_id)".to_string())?;
    println!("[Bilibili] w_webid extracted: {}", w_webid);
    {
        let mut guard = state.w_webid.lock().unwrap();
        *guard = Some(w_webid.clone());
    }
    Ok(w_webid)
}
