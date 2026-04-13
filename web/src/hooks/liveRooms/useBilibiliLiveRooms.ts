"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommonStreamer } from "@/platforms/common/streamerTypes";

export function useBilibiliLiveRooms(subCategoryId: string | null, parentCategoryId: string | null) {
  const [rooms, setRooms] = useState<CommonStreamer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const proxyBaseRef = useRef<string | null>(null);

  const canFetch = useMemo(() => !!subCategoryId && !!parentCategoryId, [parentCategoryId, subCategoryId]);

  const ensureProxyStarted = useCallback(async () => {
    if (proxyBaseRef.current) return;
    try {
      const base = await invoke<string>("start_static_proxy_server");
      proxyBaseRef.current = base || null;
    } catch (e) {
      console.error("[useBilibiliLiveRooms] Failed to start static proxy server", e);
    }
  }, []);

  const proxify = useCallback((url?: string) => {
    if (!url) return "";
    if (proxyBaseRef.current) return `${proxyBaseRef.current}/image?url=${encodeURIComponent(url)}`;
    return url;
  }, []);

  const mapToCommon = useCallback(
    (raw: any): CommonStreamer => {
      return {
        room_id: String(raw.roomid ?? ""),
        title: raw.title ?? "",
        nickname: raw.uname ?? "",
        avatar: proxify(raw.face ?? ""),
        room_cover: proxify(raw.cover ?? ""),
        viewer_count_str: raw.watched_show?.num != null ? String(raw.watched_show.num) : "",
        platform: "bilibili"
      };
    },
    [proxify]
  );

  const fetchPage = useCallback(
    async (page: number, loadMore: boolean) => {
      if (!subCategoryId || !parentCategoryId) {
        setRooms([]);
        setHasMore(false);
        return;
      }
      await ensureProxyStarted();
      if (loadMore) setIsLoadingMore(true);
      else setIsLoading(true);
      setError(null);

      try {
        const text = await invoke<string>("fetch_bilibili_live_list", {
          areaId: subCategoryId,
          parentAreaId: parentCategoryId,
          page
        });
        const parsed = JSON.parse(text);
        const list: any[] = parsed?.data?.list ?? [];
        const newRooms = list.map(mapToCommon);
        setRooms((prev) => (loadMore ? [...prev, ...newRooms] : newRooms));
        setHasMore(newRooms.length > 0);
        setCurrentPage(page + 1);
      } catch (e: any) {
        setError(typeof e === "string" ? e : e?.message || "获取 B 站主播列表失败");
        setHasMore(false);
        if (!loadMore) setRooms([]);
      } finally {
        if (loadMore) setIsLoadingMore(false);
        else setIsLoading(false);
      }
    },
    [ensureProxyStarted, mapToCommon, parentCategoryId, subCategoryId]
  );

  const loadInitialRooms = useCallback(async () => {
    setCurrentPage(1);
    setRooms([]);
    setHasMore(true);
    await fetchPage(1, false);
  }, [fetchPage]);

  const loadMoreRooms = useCallback(async () => {
    if (!hasMore || isLoading || isLoadingMore) return;
    await fetchPage(currentPage, true);
  }, [currentPage, fetchPage, hasMore, isLoading, isLoadingMore]);

  useEffect(() => {
    if (!canFetch) {
      setRooms([]);
      setHasMore(false);
      return;
    }
    void loadInitialRooms();
  }, [canFetch, loadInitialRooms]);

  return { rooms, isLoading, isLoadingMore, error, hasMore, loadInitialRooms, loadMoreRooms };
}

