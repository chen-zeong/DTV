use std::collections::HashMap;
use std::sync::{Mutex, atomic::{AtomicU64, Ordering}};
use std::time::{Duration, Instant};
use std::sync::OnceLock;
use std::env;

use urlencoding::encode;
use md5::{Md5, Digest};

use crate::platforms::common::signing::query::join_kv_pairs_urlencoded_sorted;
use crate::platforms::douyin::a_bogus::generate_a_bogus;

pub struct DouyinSignedUrlBuilder {
    cache: Mutex<HashMap<String, (Instant, String)>>,
    ttl: Duration,
    hit_count: AtomicU64,
    miss_count: AtomicU64,
}

static GLOBAL: OnceLock<DouyinSignedUrlBuilder> = OnceLock::new();

pub fn global_builder() -> &'static DouyinSignedUrlBuilder {
    GLOBAL.get_or_init(|| {
        let ttl_secs = env::var("DTV_DOUYIN_SIGN_TTL")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(30);
        DouyinSignedUrlBuilder::new(Duration::from_secs(ttl_secs))
    })
}

impl DouyinSignedUrlBuilder {
    pub fn new(ttl: Duration) -> Self {
        Self {
            cache: Mutex::new(HashMap::new()),
            ttl,
            hit_count: AtomicU64::new(0),
            miss_count: AtomicU64::new(0),
        }
    }

    pub fn build_signed_url(
        &self,
        base_url: &str,
        params: Vec<(String, String)>,
        user_agent: &str,
    ) -> Result<String, String> {
        // Canonicalize query: sort by key and url-encode each component.
        let query = join_kv_pairs_urlencoded_sorted(params);

        // Cache key = hash(user_agent + base_url + canonical_query)
        let mut hasher = Md5::new();
        hasher.update(user_agent);
        hasher.update(base_url);
        hasher.update(&query);
        let key = format!("{:x}", hasher.finalize());

        let now = Instant::now();
        if let Ok(mut cache) = self.cache.lock() {
            if let Some((expires_at, cached)) = cache.get(&key) {
                if *expires_at > now {
                    self.hit_count.fetch_add(1, Ordering::Relaxed);
                    let current_hits = self.hit_count.load(Ordering::Relaxed);
                    if current_hits % 10 == 0 {
                        tracing::debug!(
                            "[DouyinSign] Cache Hit! Total hits: {}, misses: {}",
                            current_hits,
                            self.miss_count.load(Ordering::Relaxed)
                        );
                    }
                    return Ok(format!("{}?{}&a_bogus={}", base_url, query, cached));
                }
            }

            self.miss_count.fetch_add(1, Ordering::Relaxed);
            let sign = generate_a_bogus(&query, user_agent);
            let encoded = encode(&sign).to_string();
            
            // Bounded cache: if too many entries, clear expired ones or just truncate
            if cache.len() >= 1024 {
                cache.retain(|_, (exp, _)| *exp > now);
                // If still too many, just clear all to stay bounded
                if cache.len() >= 1024 {
                    cache.clear();
                }
            }
            
            cache.insert(key, (now + self.ttl, encoded.clone()));
            return Ok(format!("{}?{}&a_bogus={}", base_url, query, encoded));
        }

        // If cache lock is poisoned, still proceed without caching.
        let sign = generate_a_bogus(&query, user_agent);
        Ok(format!("{}?{}&a_bogus={}", base_url, query, encode(&sign)))
    }
}
