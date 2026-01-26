use std::sync::OnceLock;

use crate::platforms::common::js_function_worker::JsFunctionWorker;

const SIGN_JS_CONTENT: &str = include_str!("./sign.js");
const SIGN_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

static SIGNER: OnceLock<Result<JsFunctionWorker, String>> = OnceLock::new();

fn get_worker() -> Result<&'static JsFunctionWorker, String> {
    let result = SIGNER.get_or_init(|| {
        JsFunctionWorker::new(SIGN_UA, vec![("./sign.js", SIGN_JS_CONTENT)])
    });
    result.as_ref().map_err(|e| e.clone())
}

pub async fn get_sign(md5_param: &str) -> Result<String, String> {
    let worker = get_worker()?;
    // md5_param is hex, safe to embed in single quotes.
    worker.eval_string(format!("get_sign('{}')", md5_param)).await
}
