"use client";

import { listen } from "@tauri-apps/api/event";
import { v4 as uuidv4 } from "uuid";
import { tauriInvoke } from "@/lib/tauri";
import { DanmakuListener, DanmakuMessage } from "@/types/danmaku";
import { BiliLiveListResponse } from "@/types/bilibili";

type BilibiliStreamerPayload = {
  payload: Record<string, unknown>;
  cookie?: string | null;
};

export async function fetchBilibiliStreamerInfo(payload: BilibiliStreamerPayload): Promise<unknown> {
  return tauriInvoke<unknown>("fetch_bilibili_streamer_info", payload);
}

export async function getBilibiliStreamWithQuality(payload: Record<string, unknown>): Promise<unknown> {
  return tauriInvoke<unknown>("get_bilibili_live_stream_url_with_quality", payload);
}

export async function startBilibiliDanmakuListener(roomId: string, onMessage: DanmakuListener) {
  await tauriInvoke("start_bilibili_danmaku_listener", { roomId });
  const eventName = "danmaku-message";
  const unlisten = await listen<{ room_id?: string; user: string; content: string; user_level: number; fans_club_level: number }>(
    eventName,
    (event) => {
      const p = event.payload;
      if (!p) return;
      if (p.room_id && p.room_id !== roomId) return;
      const msg: DanmakuMessage = {
        id: uuidv4(),
        nickname: p.user || "未知用户",
        content: p.content || "",
        level: String(p.user_level || 0),
        badgeLevel: p.fans_club_level > 0 ? String(p.fans_club_level) : undefined,
        roomId: p.room_id || roomId,
      };
      onMessage(msg);
    }
  );
  return unlisten;
}

export async function stopBilibiliDanmakuListener(roomId: string, unlisten?: () => void) {
  if (unlisten) {
    try {
      unlisten();
    } catch (error) {
      console.warn("[bilibili] unlisten failed (ignored)", error);
    }
  }
  try {
    await tauriInvoke("stop_bilibili_danmaku_listener", { roomId });
  } catch (error) {
    console.warn("[bilibili] stop danmaku failed (ignored)", error);
  }
}

export async function fetchBilibiliLiveList(params: Record<string, unknown>) {
  return tauriInvoke<BiliLiveListResponse>("fetch_bilibili_live_list", params);
}
