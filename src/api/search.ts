import { invoke } from "@tauri-apps/api/core";

export async function searchDouyuAnchor(keyword: string): Promise<string> {
  return invoke<string>("search_anchor", { keyword });
}

export interface HuyaAnchorItem {
  room_id: string;
  avatar: string;
  user_name: string;
  live_status: boolean;
  title: string;
}

export async function searchHuyaAnchors(keyword: string, page = 1): Promise<HuyaAnchorItem[]> {
  return invoke<HuyaAnchorItem[]>("search_huya_anchors", { keyword, page });
}

export interface BilibiliSearchItem {
  room_id: string;
  title: string;
  cover: string;
  anchor: string;
  avatar: string;
  watching: string;
  area: string;
  is_live: boolean;
}

export async function searchBilibiliRooms(keyword: string, page = 1): Promise<BilibiliSearchItem[]> {
  return invoke<BilibiliSearchItem[]>("search_bilibili_rooms", { keyword, page });
}
