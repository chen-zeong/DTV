import type { StreamerDetails } from "../../../types/models/streamer";
import { getLiveStreamV2 } from "../../../api/live";

export async function getDouyinStreamerDetails(params: {
  roomId: string;
  initialTitle?: string | null;
  initialAnchorName?: string | null;
  initialAvatar?: string | null;
}): Promise<StreamerDetails> {
  const { roomId, initialTitle, initialAnchorName, initialAvatar } = params;
  try {
    const resp = await getLiveStreamV2({
      platform: "douyin",
      room_id: roomId,
      debug: false,
      mode: "meta",
    });

    if (resp.status === "error") {
      console.error(
        `[StreamerInfo/douyinParser.ts] Error from get_live_stream_v2(meta) for room ${roomId}: ${resp.error ?? "unknown"}`,
      );
      // On error from API, return details with an error indication or use initial props as fallback.
      return {
        roomId: roomId,
        platform: "douyin", // Explicitly set platform as it's not in LiveStreamInfoFromRust
        nickname: initialAnchorName || "获取失败",
        roomTitle: initialTitle || "直播信息获取失败",
        avatarUrl: initialAvatar ?? null,
        isLive: false, // Assume not live on error
        viewerCount: 0, // Placeholder
        categoryName: "N/A", // Placeholder
        errorMessage: resp.error ?? "直播信息获取失败", // Pass along the error message
      };
    }

    const isLive = resp.status === "live";

    return {
      roomId: roomId,
      platform: "douyin", // Explicitly set platform
      nickname: resp.room?.anchor_name || initialAnchorName || "抖音主播",
      roomTitle: resp.room?.title || initialTitle || "精彩直播中",
      avatarUrl: resp.room?.avatar ?? initialAvatar ?? null,
      isLive: isLive,
      viewerCount: 0, // Placeholder
      categoryName: "N/A", // Placeholder
      errorMessage: null, // No error from API
    };
  } catch (error) {
    console.error(
      `[StreamerInfo/douyinParser.ts] Exception invoking get_live_stream_v2(meta) for room ${roomId}:`,
      error,
    );
    // On exception during invoke, return details with an error indication.
    return {
      roomId: roomId,
      platform: "douyin",
      nickname: initialAnchorName || "获取异常",
      roomTitle: initialTitle || "直播信息获取异常",
      avatarUrl: initialAvatar ?? null,
      isLive: false, // Assume not live on exception
      viewerCount: 0,
      categoryName: "N/A",
      errorMessage:
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "未知异常",
    };
  }
}
