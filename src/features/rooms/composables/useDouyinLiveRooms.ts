import { ref } from "vue";
import type { Ref } from "vue";
import type { CommonStreamer } from "../../../types/models/streamer";
import { generateDouyinMsToken } from "../../../api/auth";
import { fetchDouyinPartitionRooms } from "../../../api/live";

interface DouyinRawRoom {
  web_rid?: string | number;
  title?: string;
  owner_nickname?: string;
  avatar_url?: string;
  cover_url?: string;
  user_count_str?: string;
}

export function useDouyinLiveRooms(
  partitionId: Ref<string | null>,
  partitionTypeId: Ref<string | null>,
) {
  const rooms = ref<CommonStreamer[]>([]) as Ref<CommonStreamer[]>;
  const isLoading = ref(false);
  const isLoadingMore = ref(false);
  const error = ref<string | null>(null);
  const currentOffset = ref(0);
  const hasMore = ref(true);
  const currentMsToken = ref<string | null>(null);

  const fetchAndSetMsToken = async () => {
    try {
      currentMsToken.value = await generateDouyinMsToken();
    } catch (e) {
      console.error("[useDouyinLiveRoomsCommon] Failed to fetch msToken:", e);
      error.value = "Failed to initialize session token.";
      currentMsToken.value = null;
      return false;
    }
    return true;
  };

  const mapRawRoomToCommonStreamer = (rawRoom: DouyinRawRoom): CommonStreamer => {
    const webId = rawRoom.web_rid?.toString() || "";
    return {
      room_id: webId || `N/A_RID_${Math.random()}`,
      title: rawRoom.title || "未知标题",
      nickname: rawRoom.owner_nickname || "未知主播",
      avatar: rawRoom.avatar_url || "",
      room_cover:
        rawRoom.cover_url ||
        "https://via.placeholder.com/320x180.png?text=No+Image",
      viewer_count_str: rawRoom.user_count_str || "0 人",
      platform: "douyin",
      web_id: webId,
    };
  };

  const fetchRooms = async (offset: number, isLoadMore: boolean = false) => {
    if (!partitionId.value || !partitionTypeId.value) {
      rooms.value = [];
      currentOffset.value = 0;
      hasMore.value = false;
      return;
    }

    if (!currentMsToken.value) {
      console.error(
        "[useDouyinLiveRoomsCommon] msToken is not set. Aborting fetchRooms.",
      );
      error.value =
        "Session token is missing. Please refresh or select category again.";
      if (!isLoadMore) isLoading.value = false;
      else isLoadingMore.value = false;
      hasMore.value = false;
      return;
    }

    if (isLoadMore) {
      isLoadingMore.value = true;
    } else {
      isLoading.value = true;
    }
    error.value = null;

    try {
      const response = await fetchDouyinPartitionRooms(
        partitionId.value,
        partitionTypeId.value,
        offset,
        currentMsToken.value,
      );

      if (response && Array.isArray(response.rooms)) {
        const newRooms = response.rooms.map(mapRawRoomToCommonStreamer);

        if (isLoadMore) {
          rooms.value.push(...newRooms);
        } else {
          rooms.value = newRooms;
        }

        hasMore.value = Boolean(response.has_more);
        const nextOffset = response.next_offset ?? offset + newRooms.length;
        currentOffset.value =
          typeof nextOffset === "string" ? Number(nextOffset) : nextOffset;
      } else {
        console.warn(
          "[useDouyinLiveRoomsCommon] No rooms array in response or invalid structure (expected response.rooms to be an array).",
        );
        if (!isLoadMore) rooms.value = [];
        hasMore.value = false;
      }
    } catch (e: any) {
      console.error("[useDouyinLiveRoomsCommon] Error fetching rooms:", e);
      error.value =
        typeof e === "string" ? e : e?.message || "Failed to fetch rooms";
      if (!isLoadMore) {
        hasMore.value = false;
        rooms.value = [];
      }
    } finally {
      if (isLoadMore) {
        isLoadingMore.value = false;
      } else {
        isLoading.value = false;
      }
    }
  };

  const loadInitialRooms = async () => {
    currentOffset.value = 0;
    hasMore.value = true;
    isLoading.value = true;
    error.value = null;
    rooms.value = [];

    const tokenFetched = await fetchAndSetMsToken();
    if (tokenFetched && currentMsToken.value) {
      await fetchRooms(0, false);
      if (hasMore.value && rooms.value.length > 0 && rooms.value.length <= 15) {
        await fetchRooms(currentOffset.value, true);
      }
    } else {
      if (!error.value)
        error.value = "Failed to initialize session. Cannot load rooms.";
      isLoading.value = false;
      hasMore.value = false;
    }
  };

  const loadMoreRooms = () => {
    if (
      hasMore.value &&
      !isLoading.value &&
      !isLoadingMore.value &&
      currentMsToken.value
    ) {
      fetchRooms(currentOffset.value, true);
    }
  };

  return {
    rooms,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadInitialRooms,
    loadMoreRooms,
  };
}
