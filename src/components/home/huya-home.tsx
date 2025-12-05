"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState, useCallback } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import huyaCategories from "@/data/huya_categories.json";
import { fetchHuyaLiveList } from "@/services/huya";
import { HuyaCategory, HuyaStreamer } from "@/types/huya";
import { Platform } from "@/types/platform";
import { useFollowStore } from "@/stores/follow-store";
import { usePlayerOverlayStore } from "@/stores/player-overlay-store";
import { LiveGrid, type LiveCardItem } from "@/components/live/live-grid";

const PAGE_SIZE = 120;

export function HuyaHome() {
  const openPlayer = usePlayerOverlayStore((s) => s.open);
  const isFollowed = useFollowStore((s) => s.isFollowed);
  const follow = useFollowStore((s) => s.followStreamer);
  const unfollow = useFollowStore((s) => s.unfollowStreamer);

  const categories = huyaCategories as HuyaCategory[];
  const cate2Options = useMemo(
    () =>
      categories.flatMap((c1) =>
        (c1.subcategories || []).map((sub) => ({
          id: sub.id,
          title: sub.title,
          href: sub.href,
          parent: c1.title,
        }))
      ),
    [categories]
  );

  const [selectedCateId, setSelectedCateId] = useState<string | null>(null);
  const [selectedCate1, setSelectedCate1] = useState<string | null>(null);
  const [streamers, setStreamers] = useState<HuyaStreamer[]>([]);
  const [pageNo, setPageNo] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const categoryChipClass = (active: boolean) =>
    `flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm whitespace-nowrap transition-all duration-300 backdrop-blur-md ${
      active
        ? "font-bold bg-slate-800 text-white shadow-lg shadow-slate-300 dark:bg-white dark:text-slate-900 dark:shadow-white/10"
        : "font-semibold bg-white/60 text-slate-600 hover:bg-white hover:shadow-sm dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
    }`;

  const loadList = useCallback(
    async (page: number, append = false) => {
      if (!selectedCateId) return;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      try {
        const res = await fetchHuyaLiveList(selectedCateId, page, PAGE_SIZE);
        const list = res?.data || [];
        setStreamers((prev) => (append ? [...prev, ...list] : list));
        setHasMore(list.length === PAGE_SIZE);
        setPageNo(page + 1);
      } catch (error) {
        console.error("[huya-home] fetch live list failed", error);
        if (!append) {
          setStreamers([]);
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
    [selectedCateId]
  );

  useEffect(() => {
    if (categories.length > 0) {
      setSelectedCate1(categories[0].title);
      const firstCate2 = categories[0].subcategories?.[0]?.id;
      if (firstCate2) setSelectedCateId(firstCate2);
    }
  }, [categories]);

  useEffect(() => {
    if (selectedCate1) {
      const cate1 = categories.find((c) => c.title === selectedCate1);
      const firstCate2 = cate1?.subcategories?.[0]?.id;
      if (firstCate2) {
        setSelectedCateId(firstCate2);
        setPageNo(1);
      }
    }
  }, [selectedCate1, categories]);

  useEffect(() => {
    if (selectedCateId) {
      void loadList(1, false);
    }
  }, [selectedCateId, loadList]);

  const loadMore = () => {
    if (loading || loadingMore || !hasMore) return;
    void loadList(pageNo, true);
  };

  return (
    <div className="p-4 md:p-6 space-y-4 min-h-full">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-400">一级分类</div>
          <button
            onClick={() => void loadList(1, false)}
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
          {cate2Options
            .filter((c) => (selectedCate1 ? c.parent === selectedCate1 : true))
            .map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setSelectedCateId(c.id);
                  setPageNo(1);
                }}
                className={categoryChipClass(selectedCateId === c.id)}
              >
                {c.title}
              </button>
            ))}
        </div>
      </div>

      <div className="p-4">
        {loading && streamers.length === 0 ? (
          <div className="flex items-center justify-center gap-2 text-gray-300 text-sm">
            <Loader2 className="w-5 h-5 animate-spin" /> 加载直播列表...
          </div>
        ) : streamers.length === 0 ? (
          <div className="text-center text-sm text-gray-400 py-10">暂无直播</div>
        ) : (
          <LiveGrid
            items={streamers.map(
              (s): LiveCardItem => ({
                id: s.room_id,
                title: s.title || s.room_id,
                subtitle: s.nickname,
                cover: s.room_cover || "https://via.placeholder.com/320x180.png?text=No+Image",
                avatar: s.avatar || "https://via.placeholder.com/40.png?text=?",
                viewerText: s.viewer_count_str || undefined,
              })
            )}
            onCardClick={(item) =>
              openPlayer({
                platform: Platform.HUYA,
                roomId: item.id,
                title: item.title,
                anchorName: item.subtitle ?? undefined,
                avatar: item.avatar ?? undefined,
              })
            }
            renderActions={(item) => {
              const followed = isFollowed(Platform.HUYA, item.id);
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
                      unfollow(Platform.HUYA, item.id);
                    } else {
                      follow({
                        id: item.id,
                        platform: Platform.HUYA,
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
