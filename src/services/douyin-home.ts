"use client";

import { tauriInvoke } from "@/lib/tauri";
import { DouyinLiveRoom } from "@/types/douyin";
import { DanmakuListener } from "@/types/danmaku";
import { fetchDouyinStreamConfig, startDouyinDanmakuListener, stopDouyinDanmakuListener } from "@/services/douyin";

export async function fetchDouyinMsToken() {
  return tauriInvoke<string>("generate_douyin_ms_token");
}

export type DouyinPartitionRoomsResponse = {
  rooms?: Array<Record<string, unknown>>;
  has_more?: boolean;
  next_offset?: number;
};

export async function fetchDouyinPartitionRooms({
  partition,
  partitionType,
  offset,
  msToken,
}: {
  partition: string;
  partitionType: string;
  offset: number;
  msToken: string;
}) {
  return tauriInvoke<DouyinPartitionRoomsResponse>("fetch_douyin_partition_rooms", {
    partition,
    partitionType,
    offset,
    msToken,
  });
}

export async function startDouyinDanmaku(roomId: string, onMessage: DanmakuListener) {
  return startDouyinDanmakuListener(roomId, onMessage);
}

export async function stopDouyinDanmaku(roomId: string, unlisten?: () => void) {
  return stopDouyinDanmakuListener(roomId, unlisten);
}

export async function getDouyinStream(roomId: string, quality: string) {
  return fetchDouyinStreamConfig(roomId, quality);
}

export function mapDouyinRoom(rawRoom: Record<string, unknown>): DouyinLiveRoom {
  const webId = (rawRoom as { web_rid?: string }).web_rid?.toString?.() || "";
  return {
    room_id: webId || `N/A_RID_${Math.random()}`,
    title: (rawRoom as { title?: string }).title || "未知标题",
    nickname: (rawRoom as { owner_nickname?: string }).owner_nickname || "未知主播",
    avatar: (rawRoom as { avatar_url?: string }).avatar_url || "",
    room_cover:
      (rawRoom as { cover_url?: string }).cover_url || "https://via.placeholder.com/320x180.png?text=No+Image",
    viewer_count_str: (rawRoom as { user_count_str?: string }).user_count_str || "0 人",
    platform: "douyin",
    web_id: webId,
  };
}
