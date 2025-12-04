"use client";

import { listen } from "@tauri-apps/api/event";
import { v4 as uuidv4 } from "uuid";
import { tauriInvoke } from "@/lib/tauri";
import { DanmakuListener, DanmakuMessage } from "@/types/danmaku";
import { DouyuCategoryResponse, DouyuLiveListResponse } from "@/types/douyu";

type UnifiedRustDanmakuPayload = {
  room_id?: string;
  user: string;
  content: string;
  user_level: number;
  fans_club_level: number;
};

let douyuProxyActive = false;

const enforceHttps = (url: string): string => {
  if (!url) return url;
  if (url.startsWith("https://")) return url;
  if (url.startsWith("http://")) return `https://${url.slice("http://".length)}`;
  return url;
};

export async function getDouyuStreamConfig(roomId: string, quality = "原画", line?: string | null): Promise<{
  streamUrl: string;
  streamType?: string;
}> {
  const MAX_ATTEMPTS = 2;
  let finalStreamUrl: string | null = null;
  let streamType: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const streamUrl = await tauriInvoke<string>("get_stream_url_with_quality_cmd", {
        roomId,
        quality,
        line: line ?? null,
      });
      if (streamUrl) {
        finalStreamUrl = enforceHttps(streamUrl);
        streamType = "flv";
        break;
      }
      throw new Error("斗鱼直播流地址获取为空。");
    } catch (error) {
      const e = error as Error;
      const offlineMsgs = ["主播未开播", "房间不存在", "error: 1", "error: 102", "error code 1", "error code 102"];
      const msg = e?.message?.toLowerCase?.() || "";
      const isOffline = offlineMsgs.some((m) => msg.includes(m.toLowerCase()));
      if (isOffline) throw e;
      if (attempt === MAX_ATTEMPTS) throw new Error(`获取斗鱼直播流失败 (${MAX_ATTEMPTS} 次): ${e.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  if (!finalStreamUrl) throw new Error("未能获取有效的斗鱼直播流地址。");

  await tauriInvoke("set_stream_url_cmd", { url: finalStreamUrl });
  const proxyUrl = await tauriInvoke<string>("start_proxy");
  douyuProxyActive = true;
  return { streamUrl: proxyUrl, streamType };
}

export async function startDouyuDanmakuListener(roomId: string, onMessage: DanmakuListener): Promise<() => void> {
  await tauriInvoke("start_danmaku_listener", { roomId });
  const eventName = "danmaku-message";

  const unlisten = await listen<UnifiedRustDanmakuPayload>(eventName, (event) => {
    const payload = event.payload;
    if (!payload) return;
    if (payload.room_id && payload.room_id !== roomId) return;

    const danmaku: DanmakuMessage = {
      id: uuidv4(),
      nickname: payload.user || "未知用户",
      content: payload.content || "",
      level: String(payload.user_level || 0),
      badgeLevel: payload.fans_club_level > 0 ? String(payload.fans_club_level) : undefined,
      roomId: payload.room_id || roomId,
    };
    onMessage(danmaku);
  });

  return unlisten;
}

export async function stopDouyuDanmaku(roomId: string, currentUnlisten?: () => void) {
  if (currentUnlisten) {
    try {
      currentUnlisten();
    } catch (error) {
      console.warn("[douyu] unlisten failed (ignored)", error);
    }
  }
  try {
    if (roomId) {
      await tauriInvoke("stop_danmaku_listener", { roomId });
    }
  } catch (error) {
    console.error("[douyu] stop danmaku failed", error);
  }
}

export async function stopDouyuProxy() {
  if (!douyuProxyActive) return;
  try {
    await tauriInvoke("stop_proxy");
  } catch (error) {
    console.error("[douyu] stop proxy failed", error);
  } finally {
    douyuProxyActive = false;
  }
}

export async function fetchDouyuCategories() {
  return tauriInvoke<DouyuCategoryResponse>("fetch_categories");
}

const PAGE_SIZE = 20;

export async function fetchDouyuLiveList(categoryType: "cate2" | "cate3", categoryId: string, page: number) {
  const params =
    categoryType === "cate2"
      ? { cate2: categoryId, offset: page * PAGE_SIZE, limit: PAGE_SIZE }
      : { cate3Id: categoryId, page: page + 1, limit: PAGE_SIZE };
  const command = categoryType === "cate2" ? "fetch_live_list" : "fetch_live_list_for_cate3";
  return tauriInvoke<DouyuLiveListResponse>(command, params);
}
