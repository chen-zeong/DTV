use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteVersionInfo {
    pub version: String,
    pub title: Option<String>,
    pub notes: Option<Vec<String>>,
    pub url: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VersionCheckResponse {
    pub local_version: String,
    pub remote: Option<RemoteVersionInfo>,
    pub has_update: bool,
}

fn parse_semver_parts(v: &str) -> [i32; 3] {
    let cleaned = v.trim().trim_start_matches(['v', 'V']);
    let mut out = [0_i32; 3];
    for (idx, part) in cleaned.split('.').take(3).enumerate() {
        out[idx] = part.parse::<i32>().unwrap_or(0);
    }
    out
}

fn is_remote_newer(remote: &str, local: &str) -> bool {
    let r = parse_semver_parts(remote);
    let l = parse_semver_parts(local);
    r > l
}

#[tauri::command]
pub async fn check_version_cmd(
    app_handle: tauri::AppHandle,
    client: State<'_, reqwest::Client>,
) -> Result<VersionCheckResponse, String> {
    let local_version = app_handle.package_info().version.to_string();

    // Not critical: if it fails, do not retry and do not error.
    let remote: Option<RemoteVersionInfo> = match client
        .get("https://dtv-version.c-zeong.workers.dev/")
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => match resp.json::<RemoteVersionInfo>().await {
            Ok(v) if !v.version.trim().is_empty() => Some(v),
            _ => None,
        },
        _ => None,
    };

    let has_update = remote
        .as_ref()
        .map(|r| is_remote_newer(&r.version, &local_version))
        .unwrap_or(false);

    Ok(VersionCheckResponse {
        local_version,
        remote,
        has_update,
    })
}

