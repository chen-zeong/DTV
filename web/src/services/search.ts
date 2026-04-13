"use client";

import { invoke } from "@tauri-apps/api/core";

export type SearchPlatform = "douyu" | "huya" | "bilibili";

export type SearchAnchorResult = {
  platform: SearchPlatform;
  roomId: string;
  userName: string;
  roomTitle: string;
  avatar: string;
  liveStatus: boolean;
};

function safeString(v: unknown) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function toBool(v: unknown) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v === "1" || v.toLowerCase() === "true";
  return false;
}

function parseDouyuSearch(raw: string): SearchAnchorResult[] {
  try {
    const json = JSON.parse(raw) as any;
    const list =
      json?.data?.relateUser ??
      json?.data?.relate_user ??
      json?.data?.relate ??
      json?.data?.relateUserList ??
      json?.data ??
      json?.relate ??
      [];
    if (!Array.isArray(list)) return [];

    return list
      .filter((item: any) => {
        // Douyu searchUser returns mixed types; type===1 is anchor user
        if (typeof item?.type === "number") return item.type === 1;
        return true;
      })
      .map((item: any) => {
        const anchorInfo = item?.anchorInfo ?? item;
        const roomId =
          safeString(anchorInfo?.rid ?? anchorInfo?.room_id ?? anchorInfo?.roomId) ||
          safeString(anchorInfo?.bkUrl ? String(anchorInfo.bkUrl).split("/").pop() : "");
        const userName = safeString(anchorInfo?.nickName ?? anchorInfo?.nickname ?? anchorInfo?.user_name ?? anchorInfo?.userName);
        const roomTitle = safeString(anchorInfo?.roomName ?? anchorInfo?.room_name ?? anchorInfo?.description ?? anchorInfo?.title);
        const avatar = safeString(anchorInfo?.avatar ?? anchorInfo?.avatar_url ?? anchorInfo?.avatarUrl);

        const isLive = Number(anchorInfo?.isLive ?? anchorInfo?.is_live ?? NaN);
        const isLoop = Number(anchorInfo?.isLoop ?? anchorInfo?.is_loop ?? NaN);
        const videoLoop = Number(anchorInfo?.videoLoop ?? anchorInfo?.video_loop ?? NaN);
        const liveStatus = isLive === 2 && isLoop !== 1 && videoLoop !== 1;

        if (!roomId || !userName) return null;
        return {
          platform: "douyu" as const,
          roomId,
          userName,
          roomTitle: roomTitle || "暂无标题",
          avatar,
          liveStatus
        };
      })
      .filter(Boolean) as SearchAnchorResult[];
  } catch {
    return [];
  }
}

export async function searchAnchors(platform: SearchPlatform, keyword: string): Promise<SearchAnchorResult[]> {
  const trimmed = (keyword || "").trim();
  if (!trimmed) return [];

  if (platform === "huya") {
    const items = await invoke<Array<{ room_id: string; avatar: string; user_name: string; live_status: boolean; title: string }>>(
      "search_huya_anchors",
      { keyword: trimmed }
    );
    return (items ?? []).map((x) => ({
      platform: "huya",
      roomId: safeString(x.room_id),
      userName: safeString(x.user_name),
      roomTitle: safeString(x.title || "暂无标题"),
      avatar: safeString(x.avatar),
      liveStatus: !!x.live_status
    }));
  }

  if (platform === "bilibili") {
    const items = await invoke<Array<{ room_id: string; title: string; avatar: string; anchor: string; is_live: boolean }>>(
      "search_bilibili_rooms",
      { keyword: trimmed }
    );
    return (items ?? []).map((x) => ({
      platform: "bilibili",
      roomId: safeString(x.room_id),
      userName: safeString(x.anchor),
      roomTitle: safeString(x.title || "暂无标题"),
      avatar: safeString(x.avatar),
      liveStatus: !!x.is_live
    }));
  }

  const raw = await invoke<string>("search_anchor", { keyword: trimmed });
  return parseDouyuSearch(raw ?? "");
}
