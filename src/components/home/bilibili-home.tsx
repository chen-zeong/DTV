"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState, useCallback } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import biliCategories from "@/data/bilibili_categories.json";
import { BiliCategory, BiliLiveRoom } from "@/types/bilibili";
import { fetchBilibiliLiveList } from "@/services/bilibili";
import { Platform } from "@/types/platform";
import { useFollowStore } from "@/stores/follow-store";
import { usePlayerOverlayStore } from "@/stores/player-overlay-store";
import { LiveGrid, type LiveCardItem } from "@/components/live/live-grid";

type CateOption = {
  id: string;
  title: string;
  parentId?: string;
};

export function BilibiliHome() {
  const openPlayer = usePlayerOverlayStore((s) => s.open);
  const isFollowed = useFollowStore((s) => s.isFollowed);
  const follow = useFollowStore((s) => s.followStreamer);
  const unfollow = useFollowStore((s) => s.unfollowStreamer);

  const categories = biliCategories as BiliCategory[];
  const cateOptions = useMemo(() => {
    const opts: CateOption[] = [];
    categories.forEach((c1) => {
      if (c1.subcategories) {
        c1.subcategories.forEach((c2) => {
          opts.push({ id: String(c2.id), title: c2.title, parentId: String(c1.id) });
        });
      }
    });
    return opts;
  }, [categories]);

  const cate1List = useMemo(() => categories.map((c1) => ({ id: String(c1.id), title: c1.title })), [categories]);
  const [selectedCate, setSelectedCate] = useState<CateOption | null>(null);
  const [selectedCate1, setSelectedCate1] = useState<string | null>(null);
  const [rooms, setRooms] = useState<BiliLiveRoom[]>([]);
  const [pageNo, setPageNo] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const categoryChipClass = (active: boolean) =>
    `inline-flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-semibold border transition-all backdrop-blur-sm ${
      active
        ? "bg-white text-gray-900 shadow-[0_10px_30px_-14px_rgba(255,255,255,0.85)] border-white/80 dark:bg-white dark:text-gray-900"
        : "bg-white/70 text-gray-700 border-gray-200 hover:bg-white dark:bg-white/5 dark:text-gray-200 dark:border-white/10 dark:hover:bg-white/10"
    }`;

  const PAGE_SIZE = 30;

  const fetchRooms = useCallback(
    async (page: number, append = false) => {
      if (!selectedCate) return;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const raw = await fetchBilibiliLiveList({
          areaId: selectedCate.id,
          parentAreaId: selectedCate.parentId ?? "",
          page,
          pageSize: PAGE_SIZE,
        });

        // 后端返回文本，需要手动解析
        let list: BiliLiveRoom[] = [];
        try {
          const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
          const dataList = (parsed as { data?: { list?: unknown } })?.data?.list;
          if (Array.isArray(dataList)) {
            list = dataList.map((item) => {
              const entry = item as Record<string, unknown>;
              return {
                room_id: String(entry.roomid ?? entry.room_id ?? ""),
                title: (entry.title as string) || "",
                nickname: (entry.uname as string) || "",
                avatar: (entry.face as string) || "",
                room_cover: (entry.cover as string) || (entry.user_cover as string) || "",
                viewer_count_str:
                  (entry.watched_show as { text_small?: string; num?: number })?.text_small ||
                  ((entry.watched_show as { text_small?: string; num?: number })?.num != null
                    ? String((entry.watched_show as { text_small?: string; num?: number }).num)
                    : "") ||
                  (entry.online != null ? String(entry.online) : "0"),
                platform: "bilibili",
              };
            });
          }
        } catch (error) {
          console.warn("[bilibili-home] parse list failed", error);
          list = [];
        }

        setRooms((prev) => (append ? [...prev, ...list] : list));
        setHasMore(list.length === PAGE_SIZE);
        setPageNo(page + 1);
      } catch (error) {
        console.error("[bilibili-home] fetch live list failed", error);
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
    [selectedCate]
  );

  useEffect(() => {
    if (cateOptions.length > 0) {
      const firstParent = cateOptions[0].parentId || null;
      setSelectedCate1(firstParent);
      setSelectedCate(cateOptions.find((c) => c.parentId === firstParent) || cateOptions[0]);
    }
  }, [cateOptions]);

  useEffect(() => {
    if (selectedCate1) {
      const nextCate = cateOptions.find((c) => c.parentId === selectedCate1);
      if (nextCate) setSelectedCate(nextCate);
    }
  }, [selectedCate1, cateOptions]);

  useEffect(() => {
    if (selectedCate) {
      setPageNo(1);
      setHasMore(true);
      setRooms([]);
      void fetchRooms(1, false);
    }
  }, [selectedCate, fetchRooms]);

  const loadMore = () => {
    if (loading || loadingMore || !hasMore) return;
    void fetchRooms(pageNo, true);
  };

  return (
    <div className="p-4 md:p-6 space-y-4 min-h-full">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-400">一级分类</div>
          <button
            onClick={() => void fetchRooms(1, false)}
            className="inline-flex items-center justify-center px-3 py-2 rounded-lg border border-white/10 bg-transparent hover:bg-white/10 transition-colors text-sm"
            title="刷新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {cate1List.map((c1) => (
            <button
              key={c1.id}
              onClick={() => setSelectedCate1(c1.id)}
              className={categoryChipClass(selectedCate1 === c1.id)}
            >
              {c1.title}
            </button>
          ))}
        </div>

        <div className="text-xs text-gray-400">二级分类</div>
        <div className="flex gap-2 flex-wrap">
          {cateOptions
            .filter((c) => (selectedCate1 ? c.parentId === selectedCate1 : true))
            .map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setSelectedCate(c);
                  setPageNo(1);
                }}
                className={categoryChipClass(selectedCate?.id === c.id)}
              >
                {c.title}
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
                id: s.room_id || "",
                title: s.title || s.uname || s.nickname || s.room_id || "",
                subtitle: s.nickname || s.uname || "",
                cover: s.room_cover || "https://via.placeholder.com/320x180.png?text=No+Image",
                avatar: s.avatar || "https://via.placeholder.com/40.png?text=?",
                viewerText: s.viewer_count_str || undefined,
              })
            )}
            onCardClick={(item) =>
              openPlayer({
                platform: Platform.BILIBILI,
                roomId: item.id,
                title: item.title,
                anchorName: item.subtitle ?? undefined,
                avatar: item.avatar ?? undefined,
              })
            }
            renderActions={(item) => {
              const followed = isFollowed(Platform.BILIBILI, item.id);
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
                      unfollow(Platform.BILIBILI, item.id);
                    } else {
                      follow({
                        id: item.id,
                        platform: Platform.BILIBILI,
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
