"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Loader2, RefreshCw, ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
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

const PAGE_SIZE = 30;

export function BilibiliHome() {
  const openPlayer = usePlayerOverlayStore((s) => s.open);
  const isFollowed = useFollowStore((s) => s.isFollowed);
  const follow = useFollowStore((s) => s.followStreamer);
  const unfollow = useFollowStore((s) => s.unfollowStreamer);

  const [isMobile, setIsMobile] = useState(false);

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
    void fetchRooms(pageNo, true);
  }, [fetchRooms, hasMore, loading, loadingMore, pageNo]);

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

  const cate1Limit = isMobile ? 8 : cate1List.length;
  const cate2Limit = isMobile ? 12 : cateOptions.length;
  const visibleCate1 = isMobile ? cate1List.slice(0, cate1Limit) : cate1List;
  const visibleCate2 = isMobile
    ? cateOptions.filter((cate) => (selectedCate1 ? cate.parentId === selectedCate1 : true)).slice(0, cate2Limit)
    : cateOptions.filter((cate) => (selectedCate1 ? cate.parentId === selectedCate1 : true));

  return (
    <div className="h-full flex flex-col space-y-3">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col flex-1 gap-2">
            <div className="flex gap-2 flex-wrap mt-2 mb-2">
              {visibleCate1.map((c1) => (
                <button
                  key={c1.id}
                  onClick={() => setSelectedCate1(c1.id)}
                  className={categoryChipClass(selectedCate1 === c1.id)}
                >
                  {c1.title}
                </button>
              ))}
              {isMobile && cate1List.length > cate1Limit ? (
                <button
                  className="px-3 py-2 rounded-full border border-white/15 text-xs text-gray-200"
                  onClick={() => setShowCateSheet("cate1")}
                >
                  更多
                </button>
              ) : null}
            </div>
          </div>
          <button
            onClick={() => void fetchRooms(1, false)}
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
          </motion.div>
          {isMobile && cateOptions.length > cate2Limit ? (
            <div className="flex justify-center mt-2">
              <button
                className="inline-flex items-center gap-1 text-xs text-gray-300 hover:text-white"
                onClick={() => setShowCateSheet("cate2")}
              >
                更多
              </button>
            </div>
          ) : null}
          {!isMobile && cateOptions.length > 10 && (
            <div className="flex justify-center mt-2">
              <button
                className="inline-flex items-center gap-1 text-xs text-gray-300 hover:text-white"
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
              className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
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
              {(showCateSheet === "cate1" ? cate1List : cateOptions).map((item) => {
                const active =
                  showCateSheet === "cate1"
                    ? selectedCate1 === item.id
                    : selectedCate?.id === (item as CateOption).id;
                return (
                  <button
                    key={showCateSheet === "cate1" ? item.id : (item as CateOption).id}
                    onClick={() => {
                      if (showCateSheet === "cate1") {
                        const cate1 = item as { id: string; title: string };
                        setSelectedCate1(cate1.id);
                        const firstCate2 = cateOptions.find((c) => c.parentId === cate1.id);
                        if (firstCate2) {
                          setSelectedCate(firstCate2);
                          setPageNo(1);
                        }
                      } else {
                        const cate2 = item as CateOption;
                        setSelectedCate(cate2);
                        setPageNo(1);
                      }
                      setShowCateSheet(null);
                    }}
                    className={`px-3 py-2 rounded-xl text-sm text-left ${
                      active ? "bg-white text-gray-900 font-semibold" : "bg-white/10 text-white hover:bg-white/15"
                    }`}
                  >
                    {"title" in item ? item.title : (item as CateOption).title}
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
