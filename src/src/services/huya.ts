"use client";

import { listen } from "@tauri-apps/api/event";
import { v4 as uuidv4 } from "uuid";
import { tauriInvoke } from "@/lib/tauri";
import { DanmakuListener, DanmakuMessage } from "@/types/danmaku";
import { HuyaLiveListResponse } from "@/types/huya";

export type HuyaUnifiedEntry = { quality: string; bitRate: number; url: string };

const enforceHttps = (url: string) => {
  if (!url) return url;
  if (url.startsWith("http://")) return url.replace("http://", "https://");
  return url;
};

const inferStreamType = (url: string | undefined) => {
  if (!url) return undefined;
  if (url.includes(".flv")) return "flv";
  if (url.includes(".m3u8")) return "hls";
  return undefined;
};

export async function getHuyaStreamConfig(roomId: string, quality = "原画", line?: string | null) {
  const result = await tauriInvoke<{ flv_tx_urls?: HuyaUnifiedEntry[] }>("get_huya_unified_cmd", {
    roomId,
    quality,
    line: line ?? null,
  });
  if (result && Array.isArray(result.flv_tx_urls)) {
    const pick = (entries: HuyaUnifiedEntry[], q: string) => entries.find((e) => e.quality === q)?.url;
    const streamUrl: string | undefined = pick(result.flv_tx_urls, quality) || result.flv_tx_urls[0]?.url;
    if (!streamUrl) throw new Error("主播未开播或无法获取直播流");
    const sanitized = enforceHttps(streamUrl);
    return { streamUrl: sanitized, streamType: inferStreamType(sanitized) };
  }
  throw new Error("主播未开播或获取虎牙房间详情失败");
}

export async function startHuyaDanmakuListener(roomId: string, onMessage: DanmakuListener) {
  await tauriInvoke("start_huya_danmaku_listener", { payload: { args: { room_id_str: roomId } } });
  const unlisten = await listen<{ room_id: string; user: string; content: string; user_level: number; fans_club_level: number }>(
    "danmaku-message",
    (event) => {
      const p = event.payload;
      if (!p || p.room_id !== roomId) return;
      const msg: DanmakuMessage = {
        id: uuidv4(),
        nickname: p.user || "未知用户",
        content: p.content,
        level: String(p.user_level ?? 0),
        badgeLevel: p.fans_club_level != null ? String(p.fans_club_level) : undefined,
        roomId: roomId,
      };
      onMessage(msg);
    }
  );
  return unlisten;
}

export async function stopHuyaDanmakuListener(roomId: string, unlisten?: () => void) {
  if (unlisten) {
    try {
      unlisten();
    } catch (error) {
      console.warn("[huya] unlisten error", error);
    }
  }
  try {
    await tauriInvoke("stop_huya_danmaku_listener", { roomId });
  } catch (error) {
    console.warn("[huya] stop danmaku failed (ignored)", error);
  }
}

export async function fetchHuyaLiveList(iGid: string, pageNo: number, pageSize: number) {
  return tauriInvoke<HuyaLiveListResponse>("fetch_huya_live_list", {
    iGid,
    iPageNo: pageNo,
    iPageSize: pageSize,
  });
}
