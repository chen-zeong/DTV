"use client";

import { Platform, LiveStreamInfo } from "@/types/platform";
import { DanmakuListener } from "@/types/danmaku";
import {
  getDouyuStreamConfig,
  startDouyuDanmakuListener,
  stopDouyuDanmaku,
  stopDouyuProxy,
} from "@/services/douyu";
import { getHuyaStreamConfig, startHuyaDanmakuListener, stopHuyaDanmakuListener } from "@/services/huya";
import { fetchDouyinStreamConfig, startDouyinDanmakuListener, stopDouyinDanmakuListener } from "@/services/douyin";
import { startBilibiliDanmakuListener, stopBilibiliDanmakuListener } from "@/services/bilibili";
import { tauriInvoke } from "@/lib/tauri";

export type StreamConfig = {
  streamUrl: string | null;
  streamType?: string;
  title?: string | null;
  anchorName?: string | null;
  avatar?: string | null;
  viewer?: string | number;
};

export async function getBilibiliStreamConfig(roomId: string, quality = "原画", cookie?: string): Promise<StreamConfig> {
  if (!roomId) throw new Error("房间ID未提供");
  const payloadData = { args: { room_id_str: roomId } };
  const effectiveCookie =
    cookie ??
    (typeof localStorage !== "undefined" ? (localStorage.getItem("bilibili_cookie") || undefined) : undefined);

  const result = await tauriInvoke<LiveStreamInfo>("get_bilibili_live_stream_url_with_quality", {
    payload: payloadData,
    quality,
    cookie: effectiveCookie || null,
  });

  if (result.error_message) {
    const msg = result.error_message.trim();
    if (msg.includes("未开播")) throw new Error(msg);
    throw new Error("主播未开播或无法获取直播流");
  }

  if (typeof result.status !== "undefined" && result.status !== 1) {
    throw new Error("主播未开播");
  }
  if (!result.stream_url) {
    throw new Error("主播未开播或无法获取直播流");
  }

  const urlLower = result.stream_url.toLowerCase();
  let streamType: string | undefined;
  if (urlLower.startsWith("http://127.0.0.1") || urlLower.includes("/live.flv") || urlLower.includes(".flv")) {
    streamType = "flv";
  } else if (urlLower.includes(".m3u8")) {
    streamType = "hls";
  } else {
    streamType = "flv";
  }

  return {
    streamUrl: result.stream_url,
    streamType,
    title: result.title,
    anchorName: result.anchor_name,
    avatar: result.avatar,
  };
}

export async function getStreamConfig(
  platform: Platform,
  roomId: string,
  quality: string = "原画",
  line?: string | null,
  cookie?: string
): Promise<StreamConfig> {
  switch (platform) {
    case Platform.DOUYU:
      return getDouyuStreamConfig(roomId, quality, line);
    case Platform.HUYA:
      return getHuyaStreamConfig(roomId, quality, line);
    case Platform.DOUYIN:
      return fetchDouyinStreamConfig(roomId, quality);
    case Platform.BILIBILI:
      return getBilibiliStreamConfig(roomId, quality, cookie);
    default:
      throw new Error("不支持的平台");
  }
}

export async function startDanmaku(platform: Platform, roomId: string, onMessage: DanmakuListener) {
  switch (platform) {
    case Platform.DOUYU:
      return startDouyuDanmakuListener(roomId, onMessage);
    case Platform.HUYA:
      return startHuyaDanmakuListener(roomId, onMessage);
    case Platform.DOUYIN:
      return startDouyinDanmakuListener(roomId, onMessage);
    case Platform.BILIBILI:
      return startBilibiliDanmakuListener(roomId, onMessage);
    default:
      return undefined;
  }
}

export async function stopDanmaku(platform: Platform, roomId: string, unlisten?: () => void) {
  const safeUnlisten = () => {
    if (!unlisten) return;
    try {
      unlisten();
    } catch (error) {
      console.warn("[danmaku] unlisten failed (ignored)", error);
    }
  };

  switch (platform) {
    case Platform.DOUYU:
      await stopDouyuDanmaku(roomId, safeUnlisten);
      await stopDouyuProxy();
      break;
    case Platform.HUYA:
      await stopHuyaDanmakuListener(roomId, safeUnlisten);
      break;
    case Platform.DOUYIN:
      await stopDouyinDanmakuListener(roomId, safeUnlisten);
      break;
    case Platform.BILIBILI:
      await stopBilibiliDanmakuListener(roomId, safeUnlisten);
      break;
    default:
      break;
  }
}
