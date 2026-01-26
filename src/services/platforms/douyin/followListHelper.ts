import type { FollowedStreamer } from "../../../types/models/streamer"; import type { LiveStatus } from "../../../types/app/status";
import { getLiveStreamV2 } from "../../../api/live";

// This will be used by the store or components to update local meta

export async function refreshDouyinFollowedStreamer(
  streamer: FollowedStreamer,
): Promise<Partial<FollowedStreamer>> {
  try {
    const resp = await getLiveStreamV2({
      platform: "douyin",
      room_id: streamer.id,
      debug: false,
      mode: "meta",
    });

    if (resp.status === "error") {
      console.warn(
        `[DouyinFollowHelper] Failed to fetch Douyin meta for ${streamer.id}: ${resp.error ?? "unknown"}`,
      );
      return { isLive: false, liveStatus: "OFFLINE" };
    }

    const isLive = resp.status === "live";
    const liveStatus: LiveStatus = isLive ? "LIVE" : "OFFLINE";
    const nextId = resp.room?.web_rid || streamer.id;

    if (resp.room?.web_rid && resp.room.web_rid !== streamer.id) {
      console.info(
        `[DouyinFollowHelper] Migrating stored ID ${streamer.id} -> ${resp.room.web_rid}`,
      );
    }

    return {
      id: nextId,
      isLive,
      liveStatus,
      nickname: resp.room?.anchor_name || streamer.nickname,
      roomTitle: resp.room?.title || streamer.roomTitle,
      avatarUrl: resp.room?.avatar || streamer.avatarUrl,
    };
  } catch (e) {
    console.error(
      `[DouyinFollowHelper] Failed to refresh Douyin streamer ${streamer.id}:`,
      e,
    );
    return { isLive: false, liveStatus: "OFFLINE" }; // Ensure these are set on error too
  }
}
