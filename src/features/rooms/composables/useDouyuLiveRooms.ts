import { ref } from "vue";
import type { Ref } from "vue";
import type { CommonStreamer } from "../../../types/models/streamer";
import { fetchDouyuLiveList, fetchDouyuLiveListForCate3 } from "../../../api/live";

interface DouyuStreamer {
  rid: string;
  roomName: string;
  nickname: string;
  roomSrc: string;
  avatar: string;
  hn: string;
  isLive?: boolean;
}

interface LiveListDataWrapper {
  list: DouyuStreamer[];
  total?: number;
  page_count?: number;
}

interface LiveListApiResponse {
  error: number;
  msg?: string;
  data?: LiveListDataWrapper;
}

const PAGE_SIZE = 20;

export function useDouyuLiveRooms(
  categoryTypeRef: Ref<"cate2" | "cate3" | null>,
  categoryIdRef: Ref<string | null>,
) {
  const rooms = ref<CommonStreamer[]>([]);
  const isLoading = ref(false);
  const isLoadingMore = ref(false);
  const hasMore = ref(true);
  const currentPage = ref(0);

  const mapDouyuItemToCommon = (item: DouyuStreamer): CommonStreamer => ({
    room_id: item.rid?.toString() || "",
    title: item.roomName || "",
    nickname: item.nickname || "",
    avatar: item.avatar || "",
    room_cover: item.roomSrc || "",
    viewer_count_str: item.hn || "0",
    platform: "douyu",
  });

  const fetchRooms = async (pageToFetch: number, isLoadMore: boolean) => {
    const categoryType = categoryTypeRef.value;
    const categoryId = categoryIdRef.value;
    if (!categoryType || !categoryId) {
      rooms.value = [];
      hasMore.value = false;
      currentPage.value = 0;
      return;
    }

    if (isLoadMore) isLoadingMore.value = true;
    else isLoading.value = true;

    try {
      let resp: LiveListApiResponse;
      if (categoryType === "cate2") {
        resp = await fetchDouyuLiveList(categoryId, pageToFetch * PAGE_SIZE, PAGE_SIZE);
      } else {
        resp = await fetchDouyuLiveListForCate3(categoryId, pageToFetch + 1, PAGE_SIZE);
      }

      if (resp.error !== 0 || !resp.data) {
        throw new Error(resp.msg || "斗鱼接口返回错误");
      }

      const newRooms = (resp.data.list || []).map(mapDouyuItemToCommon);
      if (pageToFetch === 0) rooms.value = newRooms;
      else rooms.value = [...rooms.value, ...newRooms];

      if (resp.data.total !== undefined) {
        const totalFetched = (pageToFetch + 1) * PAGE_SIZE;
        hasMore.value = resp.data.total > totalFetched && newRooms.length > 0;
      } else if (resp.data.page_count !== undefined) {
        hasMore.value =
          pageToFetch + 1 < resp.data.page_count && newRooms.length > 0;
      } else {
        hasMore.value = newRooms.length === PAGE_SIZE;
      }

      currentPage.value = pageToFetch;
    } catch (e) {
      console.error("[useDouyuLiveRooms] invoke error", e);
      if (pageToFetch === 0) rooms.value = [];
      hasMore.value = false;
    } finally {
      if (isLoadMore) isLoadingMore.value = false;
      else isLoading.value = false;
    }
  };

  const loadInitialRooms = async () => {
    rooms.value = [];
    hasMore.value = true;
    currentPage.value = 0;
    await fetchRooms(0, false);
  };

  const loadMoreRooms = async () => {
    if (!hasMore.value || isLoading.value || isLoadingMore.value) return;
    await fetchRooms(currentPage.value + 1, true);
  };

  return {
    rooms,
    isLoading,
    isLoadingMore,
    hasMore,
    loadInitialRooms,
    loadMoreRooms,
  };
}
