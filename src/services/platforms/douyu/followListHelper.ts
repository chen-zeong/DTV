import type { FollowedStreamer } from "../../../types/models/streamer"; import type { LiveStatus } from "../../../types/app/status";
import { getLiveStreamV2 } from "../../../api/live";

// Define what this function returns - it's a partial update for FollowedStreamer
// focusing on the fields this function is responsible for.
interface DouyuRefreshUpdate extends Partial<
  Omit<FollowedStreamer, "liveStatus">
> {
  liveStatus: LiveStatus; // Use the common LiveStatus type
}

export async function refreshDouyuFollowedStreamer(
  streamer: FollowedStreamer,
): Promise<DouyuRefreshUpdate> {
  try {
    const resp = await getLiveStreamV2({
      platform: "douyu",
      room_id: streamer.id,
      debug: false,
      mode: "meta",
    });

    if (resp.status === "error") {
      console.warn(
        `[DouyuFollowHelper] Failed to refresh ${streamer.id}: ${resp.error ?? "unknown"}`,
      );
      return { liveStatus: "UNKNOWN" };
    }

    const currentLiveStatus: LiveStatus =
      resp.status === "live" ? "LIVE" : "OFFLINE";

    return {
      liveStatus: currentLiveStatus,
      nickname: resp.room?.anchor_name ?? streamer.nickname,
      roomTitle: resp.room?.title ?? streamer.roomTitle,
      avatarUrl: resp.room?.avatar ?? streamer.avatarUrl,
    };
  } catch (e: any) {
    console.error(
      `[DouyuFollowHelper] Error refreshing Douyu meta for ${streamer.id}. Error:`,
      e,
    );
    return { liveStatus: "UNKNOWN" }; // Or 'OFFLINE' - UNKNOWN signals an error state more clearly
  }
}
