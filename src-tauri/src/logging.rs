use env_logger::Env;

pub fn init() {
    // Respect user overrides via `RUST_LOG`, but keep defaults sane:
    // - Debug build: show debug logs for our crates, keep dependency noise low.
    // - Release build: default to info (debug is off).
    let default_filter = if cfg!(debug_assertions) {
        // Avoid extremely chatty dependency logs like:
        // `DEBUG hyper::proto::h1::decode ...`
        "info,dtv=debug,dtv_lib=debug"
    } else {
        "info"
    };

    // Avoid panicking if init is called twice (some Tauri entrypoints may do that).
    let mut builder = env_logger::Builder::from_env(Env::default().default_filter_or(default_filter));

    // Keep common HTTP stack crates quiet unless explicitly enabled.
    // These can otherwise flood the terminal in debug builds.
    builder
        .filter_module("hyper", log::LevelFilter::Info)
        .filter_module("h2", log::LevelFilter::Info)
        .filter_module("reqwest", log::LevelFilter::Info);

    let _ = builder
        .format_timestamp_millis()
        .try_init();
}
