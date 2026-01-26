use reqwest::header::{HeaderMap, HeaderValue, COOKIE, REFERER, USER_AGENT};

pub fn headers_with_user_agent_and_referer(
    user_agent: &str,
    referer: &str,
) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_str(user_agent).map_err(|e| format!("Invalid User-Agent: {e}"))?,
    );
    headers.insert(
        REFERER,
        HeaderValue::from_str(referer).map_err(|e| format!("Invalid Referer: {e}"))?,
    );
    Ok(headers)
}

pub fn insert_cookie(headers: &mut HeaderMap, cookie: Option<&str>) -> Result<(), String> {
    let Some(cookie) = cookie else { return Ok(()); };
    let trimmed = cookie.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    headers.insert(
        COOKIE,
        HeaderValue::from_str(trimmed).map_err(|e| format!("Invalid Cookie: {e}"))?,
    );
    Ok(())
}
