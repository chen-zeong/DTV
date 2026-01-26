use std::sync::mpsc::{self, Sender};
use std::thread;

use deno_core::FastString;
use tokio::sync::oneshot;

use crate::platforms::common::js_runtime::{
    bootstrap_basic_browser_env, ensure_js_runtime_platform_initialized, new_js_runtime,
};

struct EvalJob {
    expr: String,
    respond_to: oneshot::Sender<Result<String, String>>,
}

pub struct JsFunctionWorker {
    tx: Sender<EvalJob>,
}

impl JsFunctionWorker {
    pub fn new(
        user_agent: &'static str,
        preload_scripts: Vec<(&'static str, &'static str)>,
    ) -> Result<Self, String> {
        let (tx, rx) = mpsc::channel::<EvalJob>();

        thread::Builder::new()
            .name("js-function-worker".to_string())
            .spawn(move || {
                ensure_js_runtime_platform_initialized();
                let mut runtime = new_js_runtime();

                if let Err(e) = bootstrap_basic_browser_env(&mut runtime, user_agent) {
                    // If we can't bootstrap, fail all incoming jobs.
                    while let Ok(job) = rx.recv() {
                        let _ = job.respond_to.send(Err(format!(
                            "js runtime bootstrap failed: {}",
                            e
                        )));
                    }
                    return;
                }

                for (name, source) in preload_scripts {
                    if let Err(e) = runtime.execute_script(name, FastString::from_static(source)) {
                        while let Ok(job) = rx.recv() {
                            let _ = job.respond_to.send(Err(format!(
                                "js preload script failed ({}): {}",
                                name, e
                            )));
                        }
                        return;
                    }
                }

                while let Ok(job) = rx.recv() {
                    let result = runtime.execute_script("[js-worker-eval]", FastString::from(job.expr));
                    let response = match result {
                        Ok(v8_value) => {
                            let scope = &mut runtime.handle_scope();
                            let local_value = deno_core::v8::Local::new(scope, v8_value);
                            if local_value.is_string() {
                                Ok(local_value.to_rust_string_lossy(scope))
                            } else {
                                Err("js eval did not return a string".to_string())
                            }
                        }
                        Err(e) => Err(format!("js eval failed: {}", e)),
                    };

                    let _ = job.respond_to.send(response);
                }
            })
            .map_err(|e| format!("Failed to spawn js worker thread: {e}"))?;

        Ok(Self { tx })
    }

    pub async fn eval_string(&self, expr: String) -> Result<String, String> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(EvalJob {
                expr,
                respond_to: tx,
            })
            .map_err(|e| format!("Failed to send js job: {e}"))?;

        rx.await
            .map_err(|e| format!("Failed to receive js response: {e}"))?
    }
}
