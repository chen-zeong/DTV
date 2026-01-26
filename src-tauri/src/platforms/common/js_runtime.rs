use deno_core::{FastString, JsRuntime, RuntimeOptions};

#[cfg(target_os = "linux")]
use std::sync::Once;

#[cfg(target_os = "linux")]
static JS_RUNTIME_INIT: Once = Once::new();

pub fn ensure_js_runtime_platform_initialized() {
    #[cfg(target_os = "linux")]
    JS_RUNTIME_INIT.call_once(|| {
        JsRuntime::init_platform(None);
    });
}

pub fn bootstrap_basic_browser_env(
    runtime: &mut JsRuntime,
    user_agent: &str,
) -> Result<(), deno_core::error::AnyError> {
    let bootstrap_script = format!(
        r#"
        globalThis.window = globalThis;
        globalThis.self = globalThis;
        globalThis.document = {{}};
        globalThis.navigator = {{ userAgent: "{}" }};
    "#,
        user_agent.replace('"', "\\\"")
    );
    runtime.execute_script("[bootstrap]", FastString::from(bootstrap_script))?;
    Ok(())
}

pub fn new_js_runtime() -> JsRuntime {
    JsRuntime::new(RuntimeOptions::default())
}
