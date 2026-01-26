DTV Roadmap (Checklist)

[x] Proxy isolation (multi-room safe)
    - StreamUrlStore: single url -> HashMap<(platform, room_id), url>
    - Proxy paths: /live/{platform}/{room_id}.flv (or .m3u8 when needed)
    - get_live_stream_v2 returns per-room proxy URL
    - Verify: fast room switching; optionally 2 players side-by-side

[x] DouyinSignedUrlBuilder hardening
    - Cache key = hash(user_agent + base_url + canonical_query)
    - Replace Mutex `<HashMap>` with bounded cache (LRU or periodic cleanup)
    - TTL configurable (env/config): 10/30/60s
    - Add metrics/log counters for cache hit/miss (debug-only)

[x] Further shrink backend command surface
    - Audit src-tauri/src/main.rs invoke_handler
    - Keep: get_live_stream_v2, proxy stop/static proxy, danmaku start/stop, list/search/cookie
    - Remove: remaining legacy per-platform stream/info commands (if unused)
    - Add compile-time check or docs to prevent re-adding legacy commands

[x] Lighter meta mode per platform
    - Douyu: meta fetch uses betard only
    - Huya: meta fetch without full stream candidate parsing
    - Douyin: meta fetch via web/enter minimal fields
    - Bilibili: meta fetch uses cached WBI keys
    - Validate: follow list refresh speed and success rates

[x] Frontend bundle size + load performance
    - Dynamic import xgplayer + flv/hls plugins on player route
    - Split danmaku overlay and heavy player plugins
    - Re-check build chunk sizes; ensure player still works on all platforms

[x] Unified logging + debug switch
    - Replace println!/eprintln! scattered logs with a single gated logger
    - Ensure signed URLs/cookies never logged in non-debug mode
    - Add debug env var (e.g., DTV_DEBUG=1) to enable verbose logs

[x] Error classification
    - Centralize offline/error mapping (platforms/common/errors.rs)
    - Replace string contains checks where possible
    - Ensure UI consistently distinguishes offline vs error
