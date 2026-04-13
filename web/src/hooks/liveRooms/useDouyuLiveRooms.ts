"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommonStreamer } from "@/platforms/common/streamerTypes";

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

export function useDouyuLiveRooms(categoryType: "cate2" | "cate3" | null, categoryId: string | null) {
  const [rooms, setRooms] = useState<CommonStreamer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);

  const mapDouyuItemToCommon = useCallback((item: DouyuStreamer): CommonStreamer => {
    return {
      room_id: item.rid?.toString() || "",
      title: item.roomName || "",
      nickname: item.nickname || "",
      avatar: item.avatar || "",
      room_cover: item.roomSrc || "",
      viewer_count_str: item.hn || "0",
      platform: "douyu"
    };
  }, []);

  const canFetch = useMemo(() => !!categoryType && !!categoryId, [categoryType, categoryId]);

  const fetchRooms = useCallback(
    async (pageToFetch: number, loadMore: boolean) => {
      if (!categoryType || !categoryId) {
        setRooms([]);
        setHasMore(false);
        setCurrentPage(0);
        return;
      }

      if (loadMore) setIsLoadingMore(true);
      else setIsLoading(true);

      let command = "";
      let params: Record<string, unknown> = {};
      if (categoryType === "cate2") {
        command = "fetch_live_list";
        params = { cate2: categoryId, offset: pageToFetch * PAGE_SIZE, limit: PAGE_SIZE };
      } else {
        command = "fetch_live_list_for_cate3";
        params = { cate3Id: categoryId, page: pageToFetch + 1, limit: PAGE_SIZE };
      }

      try {
        const resp = await invoke<LiveListApiResponse>(command, params);
        if (resp.error !== 0 || !resp.data) throw new Error(resp.msg || "斗鱼接口返回错误");

        const newRooms = (resp.data.list || []).map(mapDouyuItemToCommon);
        setRooms((prev) => (pageToFetch === 0 ? newRooms : [...prev, ...newRooms]));

        if (resp.data.total !== undefined) {
          const totalFetched = (pageToFetch + 1) * PAGE_SIZE;
          setHasMore(resp.data.total > totalFetched && newRooms.length > 0);
        } else if (resp.data.page_count !== undefined) {
          setHasMore(pageToFetch + 1 < resp.data.page_count && newRooms.length > 0);
        } else {
          setHasMore(newRooms.length === PAGE_SIZE);
        }

        setCurrentPage(pageToFetch);
      } catch (e) {
        console.error("[useDouyuLiveRooms] invoke error", e);
        if (pageToFetch === 0) setRooms([]);
        setHasMore(false);
      } finally {
        if (loadMore) setIsLoadingMore(false);
        else setIsLoading(false);
      }
    },
    [categoryId, categoryType, mapDouyuItemToCommon]
  );

  const loadInitialRooms = useCallback(async () => {
    setRooms([]);
    setHasMore(true);
    setCurrentPage(0);
    await fetchRooms(0, false);
  }, [fetchRooms]);

  const loadMoreRooms = useCallback(async () => {
    if (!hasMore || isLoading || isLoadingMore) return;
    await fetchRooms(currentPage + 1, true);
  }, [currentPage, fetchRooms, hasMore, isLoading, isLoadingMore]);

  useEffect(() => {
    if (!canFetch) {
      setRooms([]);
      setHasMore(false);
      return;
    }
    void loadInitialRooms();
  }, [canFetch, loadInitialRooms]);

  return { rooms, isLoading, isLoadingMore, hasMore, loadInitialRooms, loadMoreRooms };
}

