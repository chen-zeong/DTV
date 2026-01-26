import { ref } from "vue";
import type { Ref } from "vue";
import type { CommonStreamer } from "../../../types/models/streamer";
import { startStaticProxyServer } from "../../../api/proxy";
import { fetchBilibiliLiveList } from "../../../api/live";

interface BilibiliRawRoom {
  roomid: number | string;
  title: string;
  uname: string;
  face: string;
  cover: string;
  watched_show?: {
    num: number | string;
  };
}

interface BilibiliLiveListResponse {
  code: number;
  data?: {
    list: BilibiliRawRoom[];
  };
}

export function useBilibiliLiveRooms(
  subCategoryId: Ref<string | null>,
  parentCategoryId: Ref<string | null>,
) {
  const rooms = ref<CommonStreamer[]>([]) as Ref<CommonStreamer[]>;
  const isLoading = ref(false);
  const isLoadingMore = ref(false);
  const error = ref<string | null>(null);
  const currentPage = ref(1);
  const hasMore = ref(true);
  const proxyBase = ref<string | null>(null);

  const ensureProxyStarted = async () => {
    if (!proxyBase.value) {
      try {
        const base = await startStaticProxyServer();
        proxyBase.value = base;
      } catch (e) {
        console.error(
          "[useBilibiliLiveRooms] Failed to start static proxy server",
          e,
        );
      }
    }
  };

  const proxify = (url?: string): string => {
    if (!url) return "";
    if (proxyBase.value) {
      return `${proxyBase.value}/image?url=${encodeURIComponent(url)}`;
    }
    return url;
  };

  const mapToCommon = (raw: BilibiliRawRoom): CommonStreamer => {
    return {
      room_id: String(raw.roomid ?? ""),
      title: raw.title ?? "",
      nickname: raw.uname ?? "",
      avatar: proxify(raw.face ?? ""),
      room_cover: proxify(raw.cover ?? ""),
      viewer_count_str:
        raw.watched_show?.num != null ? String(raw.watched_show.num) : "",
      platform: "bilibili",
    };
  };

  const fetchPage = async (page: number, isLoadMore = false) => {
    const areaId = subCategoryId.value;
    const parentId = parentCategoryId.value;
    if (!areaId || !parentId) {
      rooms.value = [];
      hasMore.value = false;
      return;
    }

    try {
      await ensureProxyStarted();
      if (isLoadMore) isLoadingMore.value = true;
      else isLoading.value = true;
      error.value = null;

      const text = await fetchBilibiliLiveList(areaId, parentId, page);
      const parsed = JSON.parse(text) as BilibiliLiveListResponse;
      const list = parsed?.data?.list ?? [];
      const newRooms = list.map(mapToCommon);
      if (isLoadMore) rooms.value.push(...newRooms);
      else rooms.value = newRooms;

      // Bilibili returns refresh_id or has_more? We estimate by list length
      hasMore.value = newRooms.length > 0;
      currentPage.value = page + 1;
    } catch (e: any) {
      error.value =
        typeof e === "string" ? e : e?.message || "获取 B 站主播列表失败";
      hasMore.value = false;
      if (!isLoadMore) rooms.value = [];
    } finally {
      if (isLoadMore) isLoadingMore.value = false;
      else isLoading.value = false;
    }
  };

  const loadInitialRooms = async () => {
    currentPage.value = 1;
    rooms.value = [];
    hasMore.value = true;
    await fetchPage(1, false);
  };
  const loadMoreRooms = async () => {
    if (hasMore.value && !isLoading.value && !isLoadingMore.value) {
      await fetchPage(currentPage.value, true);
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
