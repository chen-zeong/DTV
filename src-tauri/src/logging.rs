use env_logger::Env;

pub fn init() {
    // Respect user overrides via `RUST_LOG`, but keep defaults sane:
    // - Debug build: show debug logs for local development.
    // - Release build: default to info (debug is off).
    let default_filter = if cfg!(debug_assertions) { "debug" } else { "info" };

    // Avoid panicking if init is called twice (some Tauri entrypoints may do that).
    let _ = env_logger::Builder::from_env(Env::default().default_filter_or(default_filter))
        .format_timestamp_millis()
        .try_init();
}

