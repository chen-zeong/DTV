use ::cookie::Cookie;
use serde::Serialize;
use std::collections::BTreeMap;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl};
use url::Url;

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BilibiliCookieResult {
    pub cookie: Option<String>,
    pub has_sessdata: bool,
    pub has_bili_jct: bool,
}

fn merge_bilibili_cookies(
    accumulator: &mut BTreeMap<String, String>,
    cookies: Vec<Cookie<'static>>,
) -> (bool, bool) {
    let mut has_sessdata = false;
    let mut has_bili_jct = false;

    for cookie in cookies {
        let name = cookie.name().to_string();
        let domain_matches = cookie
            .domain()
            .map(|d| d.contains("bilibili.com"))
            .unwrap_or_else(|| name.to_ascii_lowercase().contains("bili"));

        if !domain_matches {
            continue;
        }

        let value = cookie.value().to_string();
        if name.eq_ignore_ascii_case("SESSDATA") {
            has_sessdata = true;
        }
        if name.eq_ignore_ascii_case("bili_jct") {
            has_bili_jct = true;
        }

        accumulator.entry(name).or_insert(value);
    }

    (has_sessdata, has_bili_jct)
}

async fn collect_cookie_from_labels(
    app_handle: AppHandle,
    labels: Vec<String>,
    url: String,
) -> Result<BilibiliCookieResult, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<BilibiliCookieResult, String> {
        let mut collected = BTreeMap::new();
        let mut has_sessdata = false;
        let mut has_bili_jct = false;

        let parsed_url = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;

        for label in labels {
            if let Some(window) = app_handle.get_webview_window(&label) {
                if let Ok(cookies) = window.cookies_for_url(parsed_url.clone()) {
                    let (sess, jct) = merge_bilibili_cookies(&mut collected, cookies);
                    has_sessdata |= sess;
                    has_bili_jct |= jct;
                }
                if let Ok(cookies) = window.cookies() {
                    let (sess, jct) = merge_bilibili_cookies(&mut collected, cookies);
                    has_sessdata |= sess;
                    has_bili_jct |= jct;
                }
            }
        }

        let cookie = if collected.is_empty() {
            None
        } else {
            Some(
                collected
                    .into_iter()
                    .map(|(k, v)| format!("{k}={v}"))
                    .collect::<Vec<_>>()
                    .join("; "),
            )
        };

        Ok(BilibiliCookieResult {
            cookie,
            has_sessdata,
            has_bili_jct,
        })
    })
    .await
    .map_err(|e| format!("Join error: {}", e))?
}

fn dedup_labels(mut labels: Vec<String>) -> Vec<String> {
    labels.sort();
    labels.dedup();
    labels
}

#[tauri::command]
pub async fn get_bilibili_cookie(
    app_handle: AppHandle,
    labels: Option<Vec<String>>,
    url: Option<String>,
) -> Result<BilibiliCookieResult, String> {
    let url = url.unwrap_or_else(|| "https://www.bilibili.com/".to_string());
    let label_list = if let Some(list) = labels {
        if list.is_empty() {
            app_handle
                .webview_windows()
                .keys()
                .cloned()
                .collect::<Vec<_>>()
        } else {
            list
        }
    } else {
        app_handle
            .webview_windows()
            .keys()
            .cloned()
            .collect::<Vec<_>>()
    };

    if label_list.is_empty() {
        return Ok(BilibiliCookieResult::default());
    }

    let labels = dedup_labels(label_list);
    collect_cookie_from_labels(app_handle, labels, url).await
}

#[cfg(not(mobile))]
#[tauri::command]
pub async fn bootstrap_bilibili_cookie(
    app_handle: AppHandle,
) -> Result<BilibiliCookieResult, String> {
    let label = "bilibili-silent-bootstrap".to_string();
    let url = "https://www.bilibili.com/".to_string();

    if let Some(existing) = app_handle.get_webview_window(&label) {
        let _ = existing.close();
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    let parsed_url = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;

    tauri::WebviewWindowBuilder::new(
        &app_handle,
        label.clone(),
        WebviewUrl::External(parsed_url.clone()),
    )
    .visible(false)
    .resizable(false)
    .focused(false)
    .decorations(false)
    .build()
    .map_err(|e| format!("Failed to open silent window: {}", e))?;

    tokio::time::sleep(Duration::from_secs(3)).await;

    let result =
        collect_cookie_from_labels(app_handle.clone(), vec![label.clone()], url.clone()).await?;

    if let Some(window) = app_handle.get_webview_window(&label) {
        let _ = window.close();
    }

    Ok(result)
}

// Android/iOS: 没有桌面 Webview 窗口能力，直接返回默认值，避免编译错误
#[cfg(mobile)]
#[tauri::command]
pub async fn bootstrap_bilibili_cookie(
    _app_handle: AppHandle,
) -> Result<BilibiliCookieResult, String> {
    Ok(BilibiliCookieResult::default())
}
