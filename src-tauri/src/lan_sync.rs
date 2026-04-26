use actix_cors::Cors;
use actix_web::dev::ServerHandle;
use actix_web::{get, web, App, HttpRequest, HttpResponse, HttpServer, Responder};
use local_ip_address::list_afinet_netifas;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const LAN_SYNC_KIND: &str = "dtv-lan-sync";
pub const LAN_SYNC_VERSION: u32 = 1;
pub const LAN_SYNC_PORT: u16 = 38999;
pub const LAN_SYNC_MDNS_SERVICE_TYPE: &str = "_dtv-lan-sync._tcp.local.";
pub const LAN_SYNC_HTTP_PATH: &str = "/dtv-sync";

fn fixed_token() -> String {
    std::env::var("DTV_LAN_SYNC_TOKEN").unwrap_or_else(|_| "dtv".to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanSyncSource {
    pub client: String,
    pub app_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanSyncPayload {
    pub kind: String,
    pub version: u32,
    pub exported_at: String,
    pub source: LanSyncSource,
    pub entries: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanSyncSummary {
  pub followed_streamers: usize,
  pub follow_folders: usize,
  pub follow_list_order: usize,
  pub custom_categories: usize,
  pub total_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanSyncManifest {
  pub kind: String,
  pub version: u32,
  pub exported_at: String,
  pub source: LanSyncSource,
  pub summary: LanSyncSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanSyncServerInfo {
  pub port: u16,
  pub hosts: Vec<String>,
  pub token: String,
}

#[derive(Default, Clone)]
pub struct LanSyncServerState(Arc<Mutex<Option<RunningLanSync>>>);

struct RunningLanSync {
    port: u16,
    hosts: Vec<String>,
    handle: ServerHandle,
    token: String,
    mdns: Option<MdnsRegistration>,
}

struct MdnsRegistration {
    daemon: ServiceDaemon,
    fullname: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanSyncDiscoveredPeer {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub token: Option<String>,
    pub base_url: String,
}

fn build_summary(payload: &LanSyncPayload) -> LanSyncSummary {
    let mut total_bytes: usize = 0;
    for (k, v) in payload.entries.iter() {
        total_bytes = total_bytes.saturating_add(k.len());
        total_bytes = total_bytes.saturating_add(v.len());
    }

    let followed_streamers = payload
        .entries
        .get("followedStreamers")
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|v| v.as_array().map(|a| a.len()))
        .unwrap_or(0);

    let follow_folders = payload
        .entries
        .get("followFolders")
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|v| v.as_array().map(|a| a.len()))
        .unwrap_or(0);

    let follow_list_order = payload
        .entries
        .get("followListOrder")
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|v| v.as_array().map(|a| a.len()))
        .unwrap_or(0);

    let custom_categories = payload
        .entries
        .get("dtv_custom_categories_v1")
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|v| v.as_array().map(|a| a.len()))
        .unwrap_or(0);

    LanSyncSummary {
        followed_streamers,
        follow_folders,
        follow_list_order,
        custom_categories,
        total_bytes,
    }
}

fn build_manifest(payload: &LanSyncPayload) -> LanSyncManifest {
    LanSyncManifest {
        kind: payload.kind.clone(),
        version: payload.version,
        exported_at: payload.exported_at.clone(),
        source: payload.source.clone(),
        summary: build_summary(payload),
    }
}

fn is_private_ipv4(ip: &Ipv4Addr) -> bool {
    // RFC1918 + loopback + link-local
    ip.is_loopback()
        || ip.is_private()
        || (ip.octets()[0] == 169 && ip.octets()[1] == 254)
}

fn is_link_local_ipv4(ip: &Ipv4Addr) -> bool {
    ip.octets()[0] == 169 && ip.octets()[1] == 254
}

fn is_benchmarking_ipv4(ip: &Ipv4Addr) -> bool {
    // RFC 2544 benchmarking range: 198.18.0.0/15 (198.18.*.* and 198.19.*.*)
    ip.octets()[0] == 198 && (ip.octets()[1] == 18 || ip.octets()[1] == 19)
}

fn is_cgnat_ipv4(ip: &Ipv4Addr) -> bool {
    // 100.64.0.0/10
    ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1])
}

fn is_shareable_lan_ipv4(ip: &Ipv4Addr) -> bool {
    // Prefer LAN-reachable addresses and hide "noise" from virtual adapters.
    if ip.is_loopback() {
        return false;
    }
    if is_link_local_ipv4(ip) {
        return false;
    }
    if is_benchmarking_ipv4(ip) {
        return false;
    }
    ip.is_private() || is_cgnat_ipv4(ip)
}

fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_private_ipv4(v4),
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unique_local() || v6.is_unicast_link_local(),
    }
}

fn is_noise_iface_name(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    // Inspired by file-share's interface-name filtering.
    n.contains("loopback")
        || n == "lo"
        || n.contains("internal")
        || n.contains("vmware")
        || n.contains("vethernet")
        || n.contains("virtualbox")
        || n.contains("hyper-v")
        || n.contains("wsl")
        || n.contains("docker")
        || n.contains("tailscale")
        || n.contains("zerotier")
        || n.contains("tun")
        || n.contains("tap")
        || n.contains("vpn")
}

fn extract_peer_ip(req: &HttpRequest) -> Option<IpAddr> {
    req.peer_addr().map(|addr| addr.ip())
}

fn check_auth(req: &HttpRequest, token: &str, query: &HashMap<String, String>) -> Result<(), HttpResponse> {
    let peer_ip = extract_peer_ip(req);
    if let Some(ip) = peer_ip {
        if !is_private_ip(&ip) {
            return Err(HttpResponse::Forbidden().body("Forbidden: non-private network."));
        }
    } else {
        return Err(HttpResponse::Forbidden().body("Forbidden: unknown peer."));
    }

    let provided = query.get("token").map(|s| s.as_str()).unwrap_or("");
    if provided != token {
        return Err(HttpResponse::Unauthorized().body("Unauthorized."));
    }

    Ok(())
}

#[get("/dtv-sync")]
async fn dtv_sync_manifest(
    payload: web::Data<Arc<LanSyncPayload>>,
    req: HttpRequest,
    query: web::Query<HashMap<String, String>>,
    state: web::Data<Arc<Mutex<String>>>,
) -> impl Responder {
    let token = state.lock().unwrap().clone();
    let query_map = query.into_inner();
    if let Err(resp) = check_auth(&req, &token, &query_map) {
        return resp;
    }
    HttpResponse::Ok().json(build_manifest(payload.get_ref().as_ref()))
}

#[get("/dtv-sync/payload")]
async fn dtv_sync_payload(
    payload: web::Data<Arc<LanSyncPayload>>,
    req: HttpRequest,
    query: web::Query<HashMap<String, String>>,
    state: web::Data<Arc<Mutex<String>>>,
) -> impl Responder {
    let token = state.lock().unwrap().clone();
    let query_map = query.into_inner();
    if let Err(resp) = check_auth(&req, &token, &query_map) {
        return resp;
    }
    HttpResponse::Ok().json(payload.get_ref().as_ref())
}

fn build_hosts() -> Vec<String> {
    let mut hosts: Vec<String> = vec!["127.0.0.1".to_string(), "localhost".to_string()];

    if let Ok(ifaces) = list_afinet_netifas() {
        let mut strict: Vec<String> = Vec::new();
        let mut loose: Vec<String> = Vec::new();
        for (name, ip) in ifaces {
            if ip.is_ipv4() && !ip.is_loopback() {
                if let IpAddr::V4(v4) = ip {
                    if !is_link_local_ipv4(&v4) && !is_benchmarking_ipv4(&v4) {
                        loose.push(v4.to_string());
                    }
                    if is_shareable_lan_ipv4(&v4) && !is_noise_iface_name(&name) {
                        strict.push(v4.to_string());
                    }
                }
            }
        }

        // Prefer strict candidates; fallback to loose if everything got filtered out.
        if !strict.is_empty() {
            hosts.extend(strict);
        } else {
            hosts.extend(loose);
        }
    }

    hosts.sort();
    hosts.dedup();
    hosts
}

fn pick_advertise_ipv4(hosts: &[String]) -> Ipv4Addr {
    for h in hosts {
        if let Ok(ip) = h.parse::<Ipv4Addr>() {
            if is_shareable_lan_ipv4(&ip) {
                return ip;
            }
        }
    }
    Ipv4Addr::new(127, 0, 0, 1)
}

fn build_mdns_instance_name(port: u16) -> String {
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "dtv".to_string());
    let sanitized = host
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>();
    format!("dtv-sync-{}-{}", sanitized, port)
}

fn start_mdns_advertise(port: u16, hosts: &[String], token: &str) -> Option<MdnsRegistration> {
    let daemon = ServiceDaemon::new().ok()?;
    let instance = build_mdns_instance_name(port);
    let host_name = format!("{instance}.local.");
    let ip = pick_advertise_ipv4(hosts);

    let props: [(&str, &str); 4] = [
        ("kind", LAN_SYNC_KIND),
        ("ver", "1"),
        ("path", LAN_SYNC_HTTP_PATH),
        ("token", token),
    ];

    let info = ServiceInfo::new(
        LAN_SYNC_MDNS_SERVICE_TYPE,
        &instance,
        &host_name,
        IpAddr::V4(ip),
        port,
        &props[..],
    )
    .ok()?;

    let fullname = info.get_fullname().to_string();
    if daemon.register(info).is_ok() {
        Some(MdnsRegistration { daemon, fullname })
    } else {
        let _ = daemon.shutdown();
        None
    }
}

async fn stop_running(running: RunningLanSync) {
    running.handle.stop(true).await;
    if let Some(mdns) = running.mdns {
        let _ = mdns.daemon.unregister(&mdns.fullname);
        let _ = mdns.daemon.shutdown();
    }
}

#[tauri::command]
pub async fn lan_sync_start_server(
    payload: LanSyncPayload,
    state: tauri::State<'_, LanSyncServerState>,
) -> Result<LanSyncServerInfo, String> {
    if payload.kind != LAN_SYNC_KIND {
        return Err("Invalid payload kind.".to_string());
    }
    if payload.version != LAN_SYNC_VERSION {
        return Err(format!("Unsupported payload version: {}", payload.version));
    }

    let previous = state.0.lock().unwrap().take();
    if let Some(prev) = previous {
        stop_running(prev).await;
    }

    let port = LAN_SYNC_PORT;
    let token = fixed_token();
    let bind_once = || TcpListener::bind(("0.0.0.0", port));
    let listener = match bind_once() {
        Ok(l) => l,
        Err(e) => {
            // 如果是我们自己的旧实例没停干净，先再停一次再重试；否则仍然返回错误
            if e.kind() == std::io::ErrorKind::AddrInUse {
                let previous = state.0.lock().unwrap().take();
                if let Some(prev) = previous {
                    stop_running(prev).await;
                }
                bind_once().map_err(|e2| format!("Port {} is already in use: {}", port, e2))?
            } else {
                return Err(format!("Failed to bind port {}: {}", port, e));
            }
        }
    };

    let payload = Arc::new(payload);
    let payload_data = payload.clone();
    let token_state = Arc::new(Mutex::new(token.clone()));

    let server = HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(86400);

        App::new()
            .wrap(cors)
            .app_data(web::Data::new(payload_data.clone()))
            .app_data(web::Data::new(token_state.clone()))
            .service(dtv_sync_manifest)
            .service(dtv_sync_payload)
    })
    .listen(listener)
    .map_err(|e| format!("Failed to start server: {}", e))?
    .run();

    let handle = server.handle();
    tokio::spawn(server);

    let hosts = build_hosts();
    let mdns = start_mdns_advertise(port, &hosts, &token);

    *state.0.lock().unwrap() = Some(RunningLanSync {
        port,
        hosts: hosts.clone(),
        handle,
        token: token.clone(),
        mdns,
    });

    Ok(LanSyncServerInfo { port, hosts, token })
}

#[tauri::command]
pub async fn lan_sync_stop_server(state: tauri::State<'_, LanSyncServerState>) -> Result<(), String> {
    let running = state.0.lock().unwrap().take();
    if let Some(running) = running {
        stop_running(running).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn lan_sync_status(
    state: tauri::State<'_, LanSyncServerState>,
) -> Result<Option<LanSyncServerInfo>, String> {
    let guard = state.0.lock().unwrap();
    Ok(guard.as_ref().map(|r| LanSyncServerInfo {
        port: r.port,
        hosts: r.hosts.clone(),
        token: r.token.clone(),
    }))
}

#[tauri::command]
pub async fn lan_sync_token() -> Result<String, String> {
    Ok(fixed_token())
}

#[tauri::command]
pub async fn lan_sync_discover(timeout_ms: Option<u64>) -> Result<Vec<LanSyncDiscoveredPeer>, String> {
    let timeout_ms = timeout_ms.unwrap_or(1200).clamp(300, 5000);
    let daemon = ServiceDaemon::new().map_err(|e| format!("mDNS init failed: {e}"))?;
    let receiver = daemon
        .browse(LAN_SYNC_MDNS_SERVICE_TYPE)
        .map_err(|e| format!("mDNS browse failed: {e}"))?;

    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let mut found: HashMap<String, LanSyncDiscoveredPeer> = HashMap::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining.min(Duration::from_millis(250))) else {
            continue;
        };

        if let ServiceEvent::ServiceResolved(info) = event {
            let port = info.get_port();
            let fullname = info.get_fullname();
            let name = fullname.split('.').next().unwrap_or(fullname).to_string();
            let token = info.get_property("token").map(|s| s.to_string());

            let mut host_ip: Option<String> = None;
            for ip in info.get_addresses() {
                if matches!(ip, IpAddr::V4(v4) if !v4.is_loopback() && is_private_ipv4(v4)) {
                    host_ip = Some(ip.to_string());
                    break;
                }
            }
            if host_ip.is_none() {
                host_ip = info.get_addresses().iter().next().map(|ip| ip.to_string());
            }
            let Some(host) = host_ip else { continue };

            let base_url = format!("http://{host}:{port}");
            found.insert(
                name.clone(),
                LanSyncDiscoveredPeer {
                    name,
                    host,
                    port,
                    token,
                    base_url,
                },
            );
        }
    }

    let _ = daemon.shutdown();

    let mut peers: Vec<LanSyncDiscoveredPeer> = found.into_values().collect();
    peers.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(peers)
}
