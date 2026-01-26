use std::env;

/// Helper to mask sensitive data like cookies or signed URLs unless DTV_DEBUG=1
pub fn mask_sensitive(data: &str) -> String {
    if env::var("DTV_DEBUG").map(|v| v == "1").unwrap_or(false) {
        data.to_string()
    } else {
        "***MASKED***".to_string()
    }
}
