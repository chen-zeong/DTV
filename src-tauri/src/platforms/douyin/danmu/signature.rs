use rand::Rng;
use std::collections::HashMap;
use url::Url;

use crate::platforms::common::signing::hash::md5_hex;
use crate::platforms::douyin::danmu::sign_worker;

pub async fn generate_signature(
    wss_url: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let parsed_url = Url::parse(wss_url)?;
    let params_to_sign_keys = [
        "live_id",
        "aid",
        "version_code",
        "webcast_sdk_version",
        "room_id",
        "sub_room_id",
        "sub_channel_id",
        "did_rule",
        "user_unique_id",
        "device_platform",
        "device_type",
        "ac",
        "identity",
    ];
    let mut query_params_map = HashMap::new();
    for (key, value) in parsed_url.query_pairs() {
        query_params_map.insert(key.into_owned(), value.into_owned());
    }

    let mut tpl_params_vec: Vec<String> = Vec::new();
    for key_str in params_to_sign_keys {
        let value = query_params_map
            .get(key_str)
            .map(|s| s.as_str())
            .unwrap_or("");
        tpl_params_vec.push(format!("{}={}", key_str, value));
    }
    let to_sign_str = tpl_params_vec.join(",");
    let md5_param = md5_hex(&to_sign_str);

    let signature = sign_worker::get_sign(&md5_param)
        .await
        .map_err(|e| Box::from(e) as Box<dyn std::error::Error + Send + Sync>)?;
    Ok(signature)
}

pub fn generate_ms_token(length: usize) -> String {
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"; // Removed _= as they are not typical for msToken
    let mut rng = rand::thread_rng();
    (0..length)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

#[tauri::command]
pub fn generate_douyin_ms_token() -> String {
    // For now, let's assume msToken length is always 107, as used elsewhere.
    // If variable length is needed, this command could take a length parameter.
    generate_ms_token(107)
}

// Placeholder for the more complex signature generation if needed later.
// pub async fn generate_signature(wss_url: &str) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
//     // ... (implementation from demo if required)
//     unimplemented!();
// }
