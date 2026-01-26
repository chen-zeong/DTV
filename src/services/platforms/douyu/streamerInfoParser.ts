import type { StreamerDetails } from "../../../types/models/streamer"; import type { LiveStatus } from "../../../types/app/status";
import { getLiveStreamV2 } from "../../../api/live";

export async function fetchDouyuStreamerDetails(
  roomId: string,
): Promise<StreamerDetails> {
  try {
    const resp = await getLiveStreamV2({
      platform: "douyu",
      room_id: roomId,
      debug: false,
      mode: "meta",
    });

    if (resp.status === "error") {
      throw new Error(resp.error || "Failed to load douyu room meta");
    }

    const isActuallyLive = resp.status === "live";
    const currentLiveStatus: LiveStatus = isActuallyLive ? "LIVE" : "OFFLINE";
    const isCurrentlyLooping = false;

    return {
      roomId: roomId,
      platform: "douyu",
      nickname: resp.room?.anchor_name ?? "N/A",
      roomTitle: resp.room?.title ?? "N/A",
      avatarUrl: resp.room?.avatar ?? null,
      liveStatus: currentLiveStatus,
      isLive: isActuallyLive, // isLive is true if show_status is 1 (live or looping)
      isLooping: isCurrentlyLooping, // new field for explicit loop status
      viewerCount: undefined, // Placeholder - needs data source
      categoryName: undefined, // Placeholder - needs data source
    };
  } catch (e: any) {
    console.error(
      `[StreamerInfo/douyuParser.ts] Error fetching or parsing Douyu details for ${roomId}:`,
      e,
    );
    // Return a StreamerDetails object with an error message and offline status
    return {
      roomId: roomId,
      platform: "douyu",
      nickname: "获取失败",
      roomTitle: "信息加载出错",
      avatarUrl: null,
      liveStatus: "UNKNOWN",
      isLive: false,
      isLooping: false, // Ensure isLooping is present in error case
      errorMessage:
        typeof e === "string"
          ? e
          : e.message || "Unknown error loading details",
      viewerCount: 0,
      categoryName: "N/A",
    };
  }
}
