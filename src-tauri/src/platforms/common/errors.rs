use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize, Clone)]
#[serde(tag = "type", content = "message")]
pub enum DtvError {
    #[error("Offline: {0}")]
    Offline(String),
    
    #[error("Network error: {0}")]
    Network(String),
    
    #[error("API error: {0}")]
    Api(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

impl DtvError {
    pub fn is_offline(&self) -> bool {
        matches!(self, DtvError::Offline(_))
    }

    pub fn offline(msg: impl Into<String>) -> Self {
        DtvError::Offline(msg.into())
    }

    pub fn network(msg: impl Into<String>) -> Self {
        DtvError::Network(msg.into())
    }

    pub fn api(msg: impl Into<String>) -> Self {
        DtvError::Api(msg.into())
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        DtvError::Internal(msg.into())
    }
}

pub fn classify_error_message(message: &str) -> DtvError {
    let lower = message.to_lowercase();
    let offline_keywords = [
        "主播未开播",
        "未开播",
        "房间不存在",
        "not live",
        "not found",
        "error: 1",
        "error: 102",
        "error code 1",
        "error code 102",
        "room is not live",
    ];

    if offline_keywords.iter().any(|&k| lower.contains(k)) {
        DtvError::Offline(message.to_string())
    } else if lower.contains("network") || lower.contains("timeout") || lower.contains("connection") {
        DtvError::Network(message.to_string())
    } else {
        DtvError::Api(message.to_string())
    }
}
