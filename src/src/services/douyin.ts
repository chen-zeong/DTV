"use client";

import { listen } from "@tauri-apps/api/event";
import { v4 as uuidv4 } from "uuid";
import { tauriInvoke } from "@/lib/tauri";
import { DanmakuListener, DanmakuMessage } from "@/types/danmaku";
import { LiveStreamInfo, Platform } from "@/types/platform";

type RustGetStreamUrlPayload = { args: { room_id_str: string }; platform: Platform };

const enforceHttps = (url: string): string => {
  if (!url) return url;
  if (url.startsWith("https://")) return url;
  if (url.startsWith("http://")) return `https://${url.slice("http://".length)}`;
  return url;
};

const normalizeQuality = (input: string): string => {
  const upper = input.trim().toUpperCase();
  if (upper === "OD" || upper === "原画") return "OD";
  if (upper === "BD" || upper === "高清") return "BD";
  if (upper === "UHD" || upper === "标清") return "UHD";
  return "OD";
};

export async function fetchDouyinStreamConfig(roomId: string, quality = "原画") {
  if (!roomId) {
    return { streamUrl: null, streamType: undefined, title: null, anchorName: null, avatar: null, isLive: false, initialError: "房间ID未提供" };
  }

  try {
    const payloadData = { args: { room_id_str: roomId } };
    const backendQuality = normalizeQuality(quality);
    const result = await tauriInvoke<LiveStreamInfo>("get_douyin_live_stream_url_with_quality", {
      payload: payloadData,
      quality: backendQuality,
    });

    if (result.error_message) {
      return {
        streamUrl: null,
        streamType: undefined,
        title: result.title,
        anchorName: result.anchor_name,
        avatar: result.avatar,
        isLive: result.status === 2,
        initialError: result.error_message,
      };
    }

    const streamAvailable = result.status === 2 && !!result.stream_url;
    const rawStreamUrl = result.stream_url ?? null;
    const sanitizedStreamUrl = streamAvailable && rawStreamUrl ? enforceHttps(rawStreamUrl) : null;

    let streamType: string | undefined;
    if (sanitizedStreamUrl) {
      if (sanitizedStreamUrl.includes(".flv")) streamType = "flv";
      else if (sanitizedStreamUrl.includes(".m3u8")) streamType = "hls";
      else streamType = "flv";
    }

    let uiMessage: string | null = null;
    if (!streamAvailable) {
      uiMessage = result.status !== 2 ? `主播 ${result.anchor_name || ""} 未开播。` : "主播在线，但获取直播流失败。";
    }

    return {
      streamUrl: sanitizedStreamUrl,
      streamType,
      title: result.title,
      anchorName: result.anchor_name,
      avatar: result.avatar,
      isLive: streamAvailable,
      initialError: uiMessage,
    };
  } catch (error) {
    const e = error as Error;
    return {
      streamUrl: null,
      streamType: undefined,
      title: null,
      anchorName: null,
      avatar: null,
      isLive: false,
      initialError: e.message || "获取直播信息失败: 未知错误",
    };
  }
}

export async function startDouyinDanmakuListener(roomId: string, onMessage: DanmakuListener) {
  const rustPayload: RustGetStreamUrlPayload = { args: { room_id_str: roomId }, platform: Platform.DOUYIN };
  await tauriInvoke("start_douyin_danmu_listener", { payload: rustPayload });
  const unlisten = await listen<{ room_id?: string; user: string; content: string; user_level: number; fans_club_level: number }>(
    "danmaku-message",
    (event) => {
      const p = event.payload;
      if (!p) return;
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

export async function stopDouyinDanmakuListener(roomId: string, unlisten?: () => void) {
  if (unlisten) {
    try {
      unlisten();
    } catch (error) {
      console.warn("[douyin] unlisten failed (ignored)", error);
    }
  }
  try {
    const rustPayload: RustGetStreamUrlPayload = { args: { room_id_str: "stop_listening" }, platform: Platform.DOUYIN };
    await tauriInvoke("start_douyin_danmu_listener", { payload: rustPayload });
  } catch (error) {
    console.warn("[douyin] stop danmaku failed (ignored)", error);
  }
}
