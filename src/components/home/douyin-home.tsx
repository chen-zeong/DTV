"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Loader2, RefreshCw, ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
import douyinCategories from "@/data/douyin_categories.json";
import { DouyinCategory } from "@/types/douyin";
import { fetchDouyinMsToken, fetchDouyinPartitionRooms, mapDouyinRoom, DouyinPartitionRoomsResponse } from "@/services/douyin-home";
import { Platform } from "@/types/platform";
import { useFollowStore } from "@/stores/follow-store";
import { usePlayerOverlayStore } from "@/stores/player-overlay-store";
import { LiveGrid, type LiveCardItem } from "@/components/live/live-grid";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useThemeStore } from "@/stores/theme-store";

type CategorySelected = {
  cate2Href: string;
  cate1Name: string;
  cate2Name: string;
};

export function DouyinHome() {
  const openPlayer = usePlayerOverlayStore((s) => s.open);
  const isSidebarOpen = useSidebarStore((s) => s.isOpen);
  const theme = useThemeStore((s) => s.getEffectiveTheme());
  const isDark = theme === "dark";
  const isFollowed = useFollowStore((s) => s.isFollowed);
  const follow = useFollowStore((s) => s.followStreamer);
  const unfollow = useFollowStore((s) => s.unfollowStreamer);

  const [isMobile, setIsMobile] = useState(false);
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
  const [cate2Expanded, setCate2Expanded] = useState(false);
  const [showCateSheet, setShowCateSheet] = useState<"cate1" | "cate2" | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loaderRef = useRef<HTMLDivElement | null>(null);

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
      const token = msToken || (await loadMsToken());
      if (!token) {
        return;
      }

      const { partition, partitionType } = parsePartition(selectedCate.cate2Href);
      if (!partition || !partitionType) {
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
          msToken: token,
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

  useEffect(() => {
    const update = () => {
      if (typeof window === "undefined") return;
      const width = window.visualViewport?.width ?? window.innerWidth;
      setIsMobile(width <= 768);
    };
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    void fetchRooms(offset, true);
  }, [fetchRooms, hasMore, loading, loadingMore, offset]);

  useEffect(() => {
    const root = scrollRef.current;
    const target = loaderRef.current;
    if (!root || !target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          loadMore();
        }
      },
      {
        root,
        rootMargin: "120px",
        threshold: 0.1,
      }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMore, hasMore, loading, loadingMore]);

  const cate1Limit = isMobile ? 8 : categories.length;
  const cate2Limit = isMobile ? 12 : cateOptions.length;
  const visibleCate1 = isMobile ? categories.slice(0, cate1Limit) : categories;
  const visibleCate2 = isMobile
    ? cateOptions.filter((cate) => (selectedCate1 ? cate.cate1Name === selectedCate1 : true)).slice(0, cate2Limit)
    : cateOptions.filter((cate) => (selectedCate1 ? cate.cate1Name === selectedCate1 : true));

  return (
    <div className="h-full flex flex-col space-y-3">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col flex-1 gap-2">
            <div className="flex gap-2 flex-wrap mt-2 mb-2">
              {visibleCate1.map((c1) => (
                <button
                  key={c1.title}
                  onClick={() => setSelectedCate1(c1.title)}
                  className={categoryChipClass(selectedCate1 === c1.title)}
                >
                  {c1.title}
                </button>
              ))}
              {isMobile && categories.length > cate1Limit ? (
                <button
                  className={`px-3 py-2 rounded-full border text-xs ${
                    isDark
                      ? "border-white/15 text-gray-200 bg-white/5 hover:bg-white/10"
                      : "border-gray-200 text-gray-700 bg-white hover:bg-gray-50"
                  }`}
                  onClick={() => setShowCateSheet("cate1")}
                >
                  更多
                </button>
              ) : null}
            </div>
          </div>
          <button
            onClick={() => selectedCate && fetchRooms(0, false)}
            className="inline-flex items-center justify-center px-3 py-2 rounded-lg border border-white/10 bg-transparent hover:bg-white/10 transition-colors text-sm"
            title="刷新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="relative mt-1">
          <motion.div
            layout
            initial={false}
            animate={{ height: cate2Expanded ? "auto" : "6rem" }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="flex gap-2 flex-wrap overflow-hidden"
            style={{ height: cate2Expanded ? "auto" : "6rem" }}
          >
            {visibleCate2.map((c) => (
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
          </motion.div>
          {isMobile && cateOptions.length > cate2Limit ? (
            <div className="flex justify-center mt-2">
              <button
                className={`inline-flex items-center gap-1 text-xs px-3 py-1 rounded-full border ${
                  isDark
                    ? "text-gray-200 border-white/10 bg-white/5 hover:bg-white/10"
                    : "text-gray-700 border-gray-200 bg-white hover:bg-gray-50"
                }`}
                onClick={() => setShowCateSheet("cate2")}
              >
                更多
              </button>
            </div>
          ) : null}
          {!isMobile && cateOptions.length > 10 && (
            <div className="flex justify-center mt-2">
              <button
                className={`inline-flex items-center gap-1 text-xs px-3 py-1 rounded-full border transition-colors ${
                  isDark
                    ? "text-gray-200 border-white/10 bg-white/5 hover:bg-white/10"
                    : "text-gray-700 border-gray-200 bg-white hover:bg-gray-50"
                }`}
                onClick={() => setCate2Expanded((v) => !v)}
              >
                {cate2Expanded ? "收起" : "展开"}
                <motion.span animate={{ rotate: cate2Expanded ? 180 : 0 }} transition={{ duration: 0.2, ease: "easeInOut" }}>
                  <ChevronDown className="w-4 h-4" />
                </motion.span>
              </button>
            </div>
          )}
        </div>
      </div>

          <div className="flex-1 bg-transparent overflow-hidden">
            {loading && rooms.length === 0 ? (
              <div className="flex items-center justify-center gap-2 text-gray-300 text-sm">
                <Loader2 className="w-5 h-5 animate-spin" /> 加载直播列表...
              </div>
        ) : rooms.length === 0 ? (
          <div className="text-center text-sm text-gray-400 py-10">暂无直播</div>
        ) : (
          <div ref={scrollRef} className="max-h-full overflow-y-auto no-scrollbar pr-3 pb-0">
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
              className={`grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 ${isSidebarOpen ? "xl:grid-cols-5" : "xl:grid-cols-6"}`}
            />
            <div ref={loaderRef} className="h-px" />
          </div>
        )}
      </div>

      {isMobile && showCateSheet ? (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end justify-center">
          <div className="w-full max-h-[80vh] bg-[#0f111a] text-white rounded-t-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{showCateSheet === "cate1" ? "选择一级分类" : "选择二级分类"}</div>
              <button
                onClick={() => setShowCateSheet(null)}
                className="text-xs px-3 py-1 rounded-full border border-white/15 hover:bg-white/10"
              >
                关闭
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 overflow-y-auto no-scrollbar max-h-[65vh]">
              {(showCateSheet === "cate1" ? categories : cateOptions).map((item) => {
                const active =
                  showCateSheet === "cate1"
                    ? selectedCate1 === item.title
                    : selectedCate?.cate2Href === (item as CategorySelected).cate2Href;
                return (
                  <button
                    key={showCateSheet === "cate1" ? item.title : (item as CategorySelected).cate2Href}
                    onClick={() => {
                      if (showCateSheet === "cate1") {
                        const cate1 = item as DouyinCategory;
                        setSelectedCate1(cate1.title);
                        const firstCate2 = cateOptions.find((c) => c.cate1Name === cate1.title);
                        if (firstCate2) {
                          setSelectedCate(firstCate2);
                          setOffset(0);
                        }
                      } else {
                        const cate2 = item as CategorySelected;
                        setSelectedCate(cate2);
                        setOffset(0);
                      }
                      setShowCateSheet(null);
                    }}
                    className={`px-3 py-2 rounded-xl text-sm text-left ${
                      active ? "bg-white text-gray-900 font-semibold" : "bg-white/10 text-white hover:bg-white/15"
                    }`}
                  >
                    {"title" in item ? item.title : (item as CategorySelected).cate2Name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
