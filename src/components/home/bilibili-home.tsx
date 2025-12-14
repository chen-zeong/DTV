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
import { LiveGrid, LiveGridSkeleton, type LiveCardItem } from "@/components/live/live-grid";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useThemeStore } from "@/stores/theme-store";
import { proxyBilibiliImage } from "@/utils/image";
import { CategoryPill } from "@/components/category/category-pill";
import { CategorySheet } from "@/components/category/category-sheet";

type CateOption = {
  id: string;
  title: string;
  parentId?: string;
};

const PAGE_SIZE = 30;

export function BilibiliHome() {
  const openPlayer = usePlayerOverlayStore((s) => s.open);
  const isSidebarOpen = useSidebarStore((s) => s.isOpen);
  const theme = useThemeStore((s) => s.resolvedTheme);
  const isDark = theme === "dark";
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window === "undefined" ? 900 : window.innerHeight));
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
      const height = window.visualViewport?.height ?? window.innerHeight;
      setIsMobile(width <= 768);
      setViewportHeight(height || window.innerHeight);
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
  const cate2CollapsedHeight = 96;
  const cate2ContainerMaxHeight = Math.max(260, Math.floor(viewportHeight * 0.8));
  const cate2ExpandedMaxHeight = Math.max(200, cate2ContainerMaxHeight - 60);
  const expandedCate2 = cate2Expanded || visibleCate2.length <= 10;
  const cate2Transition = {
    maxHeight: { duration: expandedCate2 ? 0.6 : 0.38, ease: [0.16, 1, 0.3, 1] },
    opacity: { duration: 0.25 },
    scaleY: { type: "spring", stiffness: 200, damping: expandedCate2 ? 26 : 28, mass: 1.05 },
  };
  const gridColsClass = isMobile ? "grid-cols-2" : `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 ${isSidebarOpen ? "xl:grid-cols-5" : "xl:grid-cols-6"}`;

  return (
    <div className="h-full flex flex-col space-y-3">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col flex-1 gap-2">
            {isMobile ? (
              <div className="flex gap-4 overflow-x-auto no-scrollbar mt-1 mb-1 -mx-1 px-1">
                {visibleCate1.map((c1) => (
                  <CategoryPill
                    key={c1.id}
                    label={c1.title}
                    isDark={isDark}
                    active={selectedCate1 === c1.id}
                    onClick={() => setSelectedCate1(c1.id)}
                    variant="tab"
                  />
                ))}
                {cate1List.length > cate1Limit ? (
                  <CategoryPill label="更多" isDark={isDark} size="sm" onClick={() => setShowCateSheet("cate1")} variant="tab" />
                ) : null}
              </div>
            ) : (
              <div className="flex gap-2 flex-wrap mt-2 mb-2">
                {visibleCate1.map((c1) => (
                  <CategoryPill key={c1.id} label={c1.title} isDark={isDark} active={selectedCate1 === c1.id} onClick={() => setSelectedCate1(c1.id)} />
                ))}
                {isMobile && cate1List.length > cate1Limit ? (
                  <CategoryPill label="更多" isDark={isDark} size="sm" onClick={() => setShowCateSheet("cate1")} />
                ) : null}
              </div>
            )}
          </div>
          <button
            onClick={() => void fetchRooms(1, false)}
            className="inline-flex items-center justify-center px-3 py-2 rounded-lg border border-white/10 bg-transparent hover:bg-white/10 transition-colors text-sm"
            title="刷新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {isMobile ? (
          <div className="mt-1">
            <div className="flex gap-4 overflow-x-auto no-scrollbar -mx-1 px-1 py-1">
              {visibleCate2.map((c) => (
                <CategoryPill
                  key={c.id}
                  label={c.title}
                  isDark={isDark}
                  active={selectedCate?.id === c.id}
                  onClick={() => {
                    setSelectedCate(c);
                    setPageNo(1);
                  }}
                  variant="tab"
                />
              ))}
              {cateOptions.length > cate2Limit ? (
                <CategoryPill label="更多" isDark={isDark} size="sm" onClick={() => setShowCateSheet("cate2")} variant="tab" />
              ) : null}
            </div>
          </div>
        ) : (
          <div
            className="relative mt-1 flex flex-col gap-2"
            style={{ maxHeight: cate2ContainerMaxHeight, overflow: "hidden" }}
          >
            <motion.div
              layout
              initial={false}
              animate={{
                maxHeight: expandedCate2 ? cate2ExpandedMaxHeight : cate2CollapsedHeight,
                opacity: expandedCate2 ? 1 : 0.97,
                scaleY: expandedCate2 ? 1 : 0.995,
              }}
              transition={cate2Transition}
              className="flex-1 flex gap-2 flex-wrap overflow-hidden no-scrollbar"
              style={{
                willChange: "transform, max-height, opacity",
                overflowY: expandedCate2 ? "auto" : "hidden",
                paddingBottom: expandedCate2 ? 8 : 0,
              }}
            >
              {visibleCate2.map((c) => (
                <CategoryPill
                  key={c.id}
                  label={c.title}
                  isDark={isDark}
                  active={selectedCate?.id === c.id}
                  onClick={() => {
                    setSelectedCate(c);
                    setPageNo(1);
                  }}
                />
              ))}
            </motion.div>
            {isMobile && cateOptions.length > cate2Limit ? (
              <div className="flex justify-center">
                <CategoryPill label="更多" isDark={isDark} size="sm" onClick={() => setShowCateSheet("cate2")} />
              </div>
            ) : null}
            {!isMobile && cateOptions.length > 10 && visibleCate2.length > 10 && (
              <div className="flex justify-center">
                <CategoryPill isDark={isDark} size="sm" onClick={() => setCate2Expanded((v) => !v)} className="px-3">
                  <span className="text-xs">{cate2Expanded ? "收起" : "展开"}</span>
                  <motion.span animate={{ rotate: cate2Expanded ? 180 : 0 }} transition={{ duration: 0.2, ease: "easeInOut" }}>
                    <ChevronDown className="w-4 h-4" />
                  </motion.span>
                </CategoryPill>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 bg-transparent overflow-hidden">
        {loading && rooms.length === 0 ? (
          <LiveGridSkeleton className={gridColsClass} />
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
                  cover: proxyBilibiliImage(s.room_cover) || "https://via.placeholder.com/320x180.png?text=No+Image",
                  avatar: proxyBilibiliImage(s.avatar) || "https://via.placeholder.com/40.png?text=?",
                  viewerText: s.viewer_count_str || undefined,
                })
              )}
              onCardClick={(item) =>
                openPlayer({
                  platform: Platform.BILIBILI,
                  roomId: item.id,
                  title: item.title,
                  anchorName: item.subtitle ?? undefined,
                  avatar: proxyBilibiliImage(item.avatar) ?? undefined,
                })
              }
              className={gridColsClass}
            />
            <div ref={loaderRef} className="h-px" />
          </div>
        )}
      </div>

      {isMobile && showCateSheet === "cate1" ? (
        <CategorySheet
          title="选择一级分类"
          isDark={isDark}
          items={cate1List.map((c1) => ({ id: c1.id, label: c1.title }))}
          activeId={selectedCate1}
          onClose={() => setShowCateSheet(null)}
          onSelect={(id) => {
            setSelectedCate1(id);
            const firstCate2 = cateOptions.find((c) => c.parentId === id);
            if (firstCate2) {
              setSelectedCate(firstCate2);
              setPageNo(1);
            }
            setShowCateSheet(null);
          }}
        />
      ) : null}
      {isMobile && showCateSheet === "cate2" ? (
        <CategorySheet
          title="选择二级分类"
          isDark={isDark}
          items={cateOptions.map((c2) => ({ id: c2.id, label: c2.title }))}
          activeId={selectedCate?.id ?? null}
          onClose={() => setShowCateSheet(null)}
          onSelect={(id) => {
            const target = cateOptions.find((c) => c.id === id);
            if (target) {
              setSelectedCate(target);
              setPageNo(1);
            }
            setShowCateSheet(null);
          }}
        />
      ) : null}
    </div>
  );
}
