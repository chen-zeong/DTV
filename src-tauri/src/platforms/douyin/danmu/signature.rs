use deno_core::{FastString, JsRuntime, RuntimeOptions};
use log::{debug, error};
use md5::{Digest, Md5};
use rand::Rng;
use std::collections::HashMap;
#[cfg(target_os = "linux")]
use std::sync::Once;
use url::Url;

// Load sign.js content at compile time
const SIGN_JS_CONTENT: &str = include_str!("./sign.js");

#[cfg(target_os = "linux")]
static JS_RUNTIME_INIT: Once = Once::new();

fn ensure_js_runtime_platform_initialized() {
    #[cfg(target_os = "linux")]
    JS_RUNTIME_INIT.call_once(|| {
        JsRuntime::init_platform(None);
    });
}

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
    debug!("[Douyin Danmaku] String to MD5 for signature: {}", to_sign_str);

    // Use md_5 crate for MD5 computation
    let mut hasher = Md5::new();
    hasher.update(to_sign_str.as_bytes());
    let digest_bytes = hasher.finalize();
    let md5_param = format!("{:x}", digest_bytes);
    debug!("[Douyin Danmaku] MD5 param for signature: {}", md5_param);

    ensure_js_runtime_platform_initialized();
    let mut runtime = JsRuntime::new(RuntimeOptions::default());

    let bootstrap_script = r#"
        globalThis.window = globalThis;
        globalThis.self = globalThis;
        globalThis.document = {}; 
        globalThis.navigator = {
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        };
    "#;
    runtime
        .execute_script("[bootstrap]", FastString::from_static(bootstrap_script))
        .map_err(|e| {
            error!("[Douyin Danmaku] Error during deno_core bootstrap script: {}", e);
            e
        })?;

    // Use the embedded sign.js content
    runtime
        .execute_script("./sign.js", FastString::from_static(SIGN_JS_CONTENT))
        .map_err(|e| {
            error!("[Douyin Danmaku] Error during deno_core eval of sign.js: {}", e);
            e
        })?;

    let call_script = format!("get_sign('{}')", md5_param);
    // For dynamic strings, convert to String first, then into FastString
    let fast_call_script = FastString::from(call_script);
    let result = runtime
        .execute_script("[call_get_sign]", fast_call_script)
        .map_err(|e| {
            error!("[Douyin Danmaku] Error during deno_core call to get_sign: {}", e);
            e
        })?;

    let scope = &mut runtime.handle_scope();
    let local_value = deno_core::v8::Local::new(scope, result);

    if local_value.is_string() {
        let signature = local_value.to_rust_string_lossy(scope);
        debug!("[Douyin Danmaku] Final signature computed.");
        Ok(signature)
    } else {
        Err(
            Box::from("get_sign did not return a string value from deno_core")
                as Box<dyn std::error::Error + Send + Sync>,
        )
    }
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
