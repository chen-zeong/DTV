import { invoke } from "@tauri-apps/api/core";

export interface BilibiliCookieResult {
  cookie: string | null;
  hasSessdata: boolean;
  hasBiliJct: boolean;
}

export async function getBilibiliCookie(labels?: string[]): Promise<BilibiliCookieResult> {
  return invoke<BilibiliCookieResult>("get_bilibili_cookie", { labels });
}

export async function bootstrapBilibiliCookie(): Promise<BilibiliCookieResult> {
  return invoke<BilibiliCookieResult>("bootstrap_bilibili_cookie");
}

export async function generateBilibiliWWebid(): Promise<string> {
  return invoke<string>("generate_bilibili_w_webid");
}

export async function generateDouyinMsToken(): Promise<string> {
  return invoke<string>("generate_douyin_ms_token");
}
