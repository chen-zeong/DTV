"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommonStreamer } from "@/platforms/common/streamerTypes";
import { useImageProxy } from "@/hooks/useImageProxy";

export interface UseHuyaLiveRoomsOptions {
  defaultPageSize?: number;
}

export function useHuyaLiveRooms(gid: string | null, options: UseHuyaLiveRoomsOptions = { defaultPageSize: 120 }) {
  const [rooms, setRooms] = useState<CommonStreamer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const pageSize = options.defaultPageSize ?? 120;
  const lastInitialKeyRef = useRef<string | null>(null);
  const inflightRef = useRef<Map<string, Promise<void>>>(new Map());

  const { proxify, ensureProxyStarted } = useImageProxy();

  const canFetch = useMemo(() => !!gid, [gid]);

  const huyaCoverParams =
    "x-oss-process=image/resize,limit_0,m_fill,w_338,h_190/sharpen,80/format,jpg/interlace,1/quality,q_90";
  const appendHuyaCoverParams = useCallback((url: string) => {
    if (!url) return url;
    if (url.includes("x-oss-process=")) return url;
    return url.includes("?") ? `${url}&${huyaCoverParams}` : `${url}?${huyaCoverParams}`;
  }, []);

  const mapHuyaItemToCommonStreamer = useCallback(
    (item: any): CommonStreamer => {
      const viewers = typeof item.lUserCount === "number" ? item.lUserCount : 0;
      const rawCover = item.room_cover || item.sScreenshot || "";
      return {
        room_id: item.room_id?.toString() || item.lProfileRoom?.toString() || "",
        title: item.title || item.sIntroduction || "",
        nickname: item.nickname || item.sNick || "",
        avatar: proxify(item.avatar || item.sAvatar180 || ""),
        room_cover: proxify(appendHuyaCoverParams(rawCover)),
        viewer_count_str: item.viewer_count_str || (viewers ? `${viewers}` : "0"),
        platform: "huya"
      };
    },
    [appendHuyaCoverParams, proxify]
  );

  const fetchRooms = useCallback(
    async (pageNo: number, loadMore: boolean) => {
      if (!gid) {
        setRooms([]);
        setHasMore(false);
        setCurrentPage(1);
        return;
      }

      const requestKey = `${gid}:${pageNo}:${pageSize}`;
      const existing = inflightRef.current.get(requestKey);
      if (existing) return existing;

      const task = (async () => {
        if (loadMore) setIsLoadingMore(true);
        else setIsLoading(true);
        setError(null);

        await ensureProxyStarted();

        try {
          const resp = await invoke<{ error: number; msg?: string; data?: any[] }>("fetch_huya_live_list", {
            iGid: gid,
            iPageNo: pageNo,
            iPageSize: pageSize
          });

          if (resp.error !== 0 || !Array.isArray(resp.data)) throw new Error(resp.msg || "虎牙接口返回错误");
          const newRooms = resp.data.map(mapHuyaItemToCommonStreamer);
          setRooms((prev) => (loadMore ? [...prev, ...newRooms] : newRooms));
          setHasMore(newRooms.length === pageSize);
          setCurrentPage(pageNo + 1);
        } catch (e: any) {
          console.error("[useHuyaLiveRooms] invoke error", e);
          setError(e?.message || "加载失败");
          if (!loadMore) {
            setRooms([]);
            setHasMore(false);
          }
        } finally {
          if (loadMore) setIsLoadingMore(false);
          else setIsLoading(false);
        }
      })();

      inflightRef.current.set(requestKey, task);
      try {
        await task;
      } finally {
        inflightRef.current.delete(requestKey);
      }
    },
    [ensureProxyStarted, gid, mapHuyaItemToCommonStreamer, pageSize]
  );

  const loadInitialRooms = useCallback(async () => {
    setRooms([]);
    setHasMore(true);
    setCurrentPage(1);
    setError(null);
    setIsLoading(true);
    await fetchRooms(1, false);
  }, [fetchRooms]);

  const loadMoreRooms = useCallback(async () => {
    if (!hasMore || isLoading || isLoadingMore) return;
    await fetchRooms(currentPage, true);
  }, [currentPage, fetchRooms, hasMore, isLoading, isLoadingMore]);

  useEffect(() => {
    if (!canFetch) {
      setRooms([]);
      setHasMore(false);
      return;
    }
    // Dedup: 避免路由/分类状态短时间内抖动导致重复拉取第一页
    const key = `${gid}:${pageSize}`;
    if (lastInitialKeyRef.current === key) return;
    lastInitialKeyRef.current = key;
    void loadInitialRooms();
  }, [canFetch, gid, loadInitialRooms, pageSize]);

  return { rooms, isLoading, isLoadingMore, error, hasMore, loadInitialRooms, loadMoreRooms };
}
