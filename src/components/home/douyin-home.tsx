"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState, useCallback } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import douyinCategories from "@/data/douyin_categories.json";
import { DouyinCategory } from "@/types/douyin";
import { fetchDouyinMsToken, fetchDouyinPartitionRooms, mapDouyinRoom, DouyinPartitionRoomsResponse } from "@/services/douyin-home";
import { Platform } from "@/types/platform";
import { useFollowStore } from "@/stores/follow-store";
import { usePlayerOverlayStore } from "@/stores/player-overlay-store";
import { LiveGrid, type LiveCardItem } from "@/components/live/live-grid";

type CategorySelected = {
  cate2Href: string;
  cate1Name: string;
  cate2Name: string;
};

export function DouyinHome() {
  const openPlayer = usePlayerOverlayStore((s) => s.open);
  const isFollowed = useFollowStore((s) => s.isFollowed);
  const follow = useFollowStore((s) => s.followStreamer);
  const unfollow = useFollowStore((s) => s.unfollowStreamer);

  const categories = douyinCategories as DouyinCategory[];
  const cateOptions = useMemo(() => {
    const opts: CategorySelected[] = [];
    categories.forEach((c1) => {
      (c1.subcategories || []).forEach((c2) => {
        opts.push({ cate2Href: c2.href, cate1Name: c1.title, cate2Name: c2.title });
      });
    });
    return opts;
  }, [categories]);

  const [selectedCate, setSelectedCate] = useState<CategorySelected | null>(null);
  const [selectedCate1, setSelectedCate1] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Array<ReturnType<typeof mapDouyinRoom>>>([]);
  const [msToken, setMsToken] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const categoryChipClass = (active: boolean) =>
    `flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm whitespace-nowrap transition-all duration-300 backdrop-blur-md ${
      active
        ? "font-bold bg-slate-800 text-white shadow-lg shadow-slate-300 dark:bg-white dark:text-slate-900 dark:shadow-white/10"
        : "font-semibold bg-white/60 text-slate-600 hover:bg-white hover:shadow-sm dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
    }`;

  const parsePartition = (href: string) => {
    const parts = href.split("_");
    const partition = parts.pop();
    const partitionType = parts.pop();
    return { partition, partitionType };
  };

  const loadMsToken = useCallback(async () => {
    try {
      const token = await fetchDouyinMsToken();
      setMsToken(token);
      return token;
    } catch (error) {
      console.error("[douyin-home] ms token failed", error);
      setMsToken(null);
      return null;
    }
  }, []);

  const fetchRooms = useCallback(
    async (nextOffset: number, append = false) => {
      if (!selectedCate) return;
      if (!msToken) {
        const token = await loadMsToken();
        if (!token) {
          return;
        }
      }

      const { partition, partitionType } = parsePartition(selectedCate.cate2Href);
      if (!partition || !partitionType || !msToken) {
        setHasMore(false);
        return;
      }

      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      try {
        const resp: DouyinPartitionRoomsResponse = await fetchDouyinPartitionRooms({
          partition,
          partitionType,
          offset: nextOffset,
          msToken,
        });
        if (resp && Array.isArray(resp.rooms)) {
          const newRooms = resp.rooms.map(mapDouyinRoom);
          setRooms((prev) => (append ? [...prev, ...newRooms] : newRooms));
          setHasMore(resp.has_more === true);
          setOffset(resp.next_offset ?? nextOffset + newRooms.length);
        } else {
          setRooms((prev) => (append ? prev : []));
          setHasMore(false);
        }
      } catch (error) {
        console.error("[douyin-home] fetch rooms failed", error);
        if (!append) {
          setRooms([]);
          setHasMore(false);
        }
      } finally {
        if (append) {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    },
    [selectedCate, msToken, loadMsToken]
  );

  useEffect(() => {
    if (cateOptions.length > 0) {
      setSelectedCate1(cateOptions[0].cate1Name);
      setSelectedCate(cateOptions[0]);
    }
  }, [cateOptions]);

  useEffect(() => {
    if (selectedCate1) {
      const nextCate = cateOptions.find((c) => c.cate1Name === selectedCate1);
      if (nextCate) {
        setSelectedCate(nextCate);
      }
    }
  }, [selectedCate1, cateOptions]);

  useEffect(() => {
    setOffset(0);
    setHasMore(true);
    setRooms([]);
    if (selectedCate) {
      void fetchRooms(0, false);
    }
  }, [selectedCate, fetchRooms]);

  const loadMore = () => {
    if (loading || loadingMore || !hasMore) return;
    void fetchRooms(offset, true);
  };

  return (
    <div className="p-4 md:p-6 space-y-4 min-h-full">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-400">一级分类</div>
          <button
            onClick={() => selectedCate && fetchRooms(0, false)}
            className="inline-flex items-center justify-center px-3 py-2 rounded-lg border border-white/10 bg-transparent hover:bg-white/10 transition-colors text-sm"
            title="刷新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {categories.map((c1) => (
            <button
              key={c1.title}
              onClick={() => setSelectedCate1(c1.title)}
              className={categoryChipClass(selectedCate1 === c1.title)}
            >
              {c1.title}
            </button>
          ))}
        </div>

        <div className="text-xs text-gray-400">二级分类</div>
        <div className="flex gap-2 flex-wrap">
          {cateOptions
            .filter((c) => (selectedCate1 ? c.cate1Name === selectedCate1 : true))
            .map((c) => (
              <button
                key={c.cate2Href}
                onClick={() => {
                  setSelectedCate(c);
                  setOffset(0);
                }}
                className={categoryChipClass(selectedCate?.cate2Href === c.cate2Href)}
              >
                {c.cate2Name}
              </button>
            ))}
        </div>
      </div>

      <div className="p-4">
        {loading && rooms.length === 0 ? (
          <div className="flex items-center justify-center gap-2 text-gray-300 text-sm">
            <Loader2 className="w-5 h-5 animate-spin" /> 加载直播列表...
          </div>
        ) : rooms.length === 0 ? (
          <div className="text-center text-sm text-gray-400 py-10">暂无直播</div>
        ) : (
          <LiveGrid
            items={rooms.map(
              (s): LiveCardItem => ({
                id: s.room_id,
                title: s.title,
                subtitle: s.nickname,
                cover: s.room_cover || "https://via.placeholder.com/320x180.png?text=No+Image",
                avatar: s.avatar || "https://via.placeholder.com/40.png?text=?",
                viewerText: s.viewer_count_str || undefined,
              })
            )}
            onCardClick={(item) =>
              openPlayer({
                platform: Platform.DOUYIN,
                roomId: item.id,
                title: item.title,
                anchorName: item.subtitle ?? undefined,
                avatar: item.avatar ?? undefined,
              })
            }
            renderActions={(item) => {
              const followed = isFollowed(Platform.DOUYIN, item.id);
              return (
                <button
                  className={`w-full text-sm rounded-lg px-3 py-2 border transition-colors ${
                    followed
                      ? "border-emerald-400/60 text-emerald-100 bg-emerald-500/10"
                      : "border-white/10 text-white hover:bg-white/10"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (followed) {
                      unfollow(Platform.DOUYIN, item.id);
                    } else {
                      follow({
                        id: item.id,
                        platform: Platform.DOUYIN,
                        nickname: item.subtitle || item.title,
                        avatarUrl: item.avatar || "",
                        displayName: item.title,
                        isLive: true,
                      });
                    }
                  }}
                >
                  {followed ? "已关注" : "关注"}
                </button>
              );
            }}
          />
        )}

        <div className="flex justify-center mt-4">
          {hasMore ? (
            <button
              onClick={loadMore}
              disabled={loading || loadingMore}
              className="px-4 py-2 rounded-full border border-white/20 bg-white/5 hover:bg-white/10 text-sm inline-flex items-center gap-2 disabled:opacity-50"
            >
              {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              加载更多
            </button>
          ) : (
            <div className="text-xs text-gray-500">没有更多了</div>
          )}
        </div>
      </div>
    </div>
  );
}
