import { invoke } from "@tauri-apps/api/core";

export async function startStaticProxyServer(): Promise<string> {
  return invoke<string>("start_static_proxy_server");
}

export async function stopProxy(): Promise<void> {
  return invoke<void>("stop_proxy");
}
