use std::sync::OnceLock;

use crate::platforms::common::js_function_worker::JsFunctionWorker;

const DOUYU_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";
const CRYPTO_JS: &str = include_str!("cryptojs.min.js");

static SIGNER: OnceLock<Result<JsFunctionWorker, String>> = OnceLock::new();

fn get_worker() -> Result<&'static JsFunctionWorker, String> {
    let result = SIGNER.get_or_init(|| {
        JsFunctionWorker::new(DOUYU_UA, vec![("cryptojs.min.js", CRYPTO_JS)])
    });
    result.as_ref().map_err(|e| e.clone())
}

pub async fn execute_js_sign(
    script: &str,
    rid: &str,
    did: &str,
    ts: i64,
) -> Result<String, String> {
    let worker = get_worker()?;

    let rid_js = serde_json::to_string(rid).map_err(|e| e.to_string())?;
    let did_js = serde_json::to_string(did).map_err(|e| e.to_string())?;
    let script_js = serde_json::to_string(script).map_err(|e| e.to_string())?;

    // Evaluate the per-room script in an isolated scope and then call ub98484234.
    let expr = format!(
        "(function(){{ eval({}); return ub98484234({}, {}, {}); }})()",
        script_js, rid_js, did_js, ts
    );

    worker.eval_string(expr).await
}
