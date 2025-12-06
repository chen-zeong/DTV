/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Loader2, RefreshCw, ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
import { fetchDouyuLiveList } from "@/services/douyu";
import { DouyuCate2, DouyuCate3, DouyuStreamer } from "@/types/douyu";
import { Platform } from "@/types/platform";
import { usePlayerOverlayStore } from "@/stores/player-overlay-store";
import { LiveGrid, LiveGridSkeleton, type LiveCardItem } from "@/components/live/live-grid";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useThemeStore } from "@/stores/theme-store";
import douyuCategories from "@/data/douyu_categories.json";

type CateOption = {
  id: string;
  name: string;
  shortName: string;
  cate1Id: string;
  cate3?: DouyuCate3[];
};

export function DouyuHome() {
  const openPlayer = usePlayerOverlayStore((s) => s.open);
  const isSidebarOpen = useSidebarStore((s) => s.isOpen);
  const theme = useThemeStore((s) => s.getEffectiveTheme());
  const isDark = theme === "dark";
  const [isMobile, setIsMobile] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window === "undefined" ? 900 : window.innerHeight));
  const parsedCategories = useMemo(() => {
    const res = douyuCategories as unknown as {
      cate1List?: Array<{ id: string; name: string; cate2List?: DouyuCate2[] }>;
    };
    const c1s =
      res?.cate1List?.map((c1) => ({
        id: String(c1.id),
        name: c1.name,
      })) || [];
    const cate2s: CateOption[] =
      res?.cate1List?.flatMap((c1) =>
        (c1.cate2List || []).map((c2: DouyuCate2) => ({
          id: String(c2.id),
          name: c2.name,
          shortName: c2.short_name,
          cate1Id: String(c1.id),
          cate3: c2.cate3List || [],
        }))
      ) || [];
    const firstCate1 = c1s[0]?.id ?? null;
    const firstCate2 = firstCate1 ? cate2s.find((c) => c.cate1Id === firstCate1) : null;
    return {
      cate1List: c1s,
      cate2List: cate2s,
      firstCate1,
      firstCate2: firstCate2?.shortName ?? null,
    };
  }, []);

  const [cate1List, setCate1List] = useState<Array<{ id: string; name: string }>>(parsedCategories.cate1List);
  const [selectedCate1, setSelectedCate1] = useState<string | null>(parsedCategories.firstCate1);
  const [cateOptions, setCateOptions] = useState<CateOption[]>(parsedCategories.cate2List);
  const [selectedCate2, setSelectedCate2] = useState<string | null>(parsedCategories.firstCate2);
  const [selectedCate3, setSelectedCate3] = useState<string | null>(null);
  const [streamers, setStreamers] = useState<DouyuStreamer[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [cate2Expanded, setCate2Expanded] = useState(false);
  const [showCateSheet, setShowCateSheet] = useState<"cate1" | "cate2" | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loaderRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef(0);

  const categoryChipClass = (active: boolean) =>
    `flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm whitespace-nowrap transition-all duration-300 backdrop-blur-md ${
      active
        ? "font-bold bg-slate-800 text-white shadow-lg shadow-slate-300 dark:bg-white dark:text-slate-900 dark:shadow-white/10"
        : "font-semibold bg-white/60 text-slate-600 hover:bg-white hover:shadow-sm dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
    }`;

  const currentCate3List = useMemo(() => {
    return cateOptions.find((c) => c.shortName === selectedCate2)?.cate3 ?? [];
  }, [cateOptions, selectedCate2]);

  const fetchList = useCallback(
    async (pageToFetch: number, append = false) => {
      if (!selectedCate2 && !selectedCate3) return;
      setLoading(true);
      try {
        const type = selectedCate3 ? "cate3" : "cate2";
        const id = selectedCate3 || selectedCate2!;
        const res = await fetchDouyuLiveList(type, id, pageToFetch);
        const list = res?.data?.list || [];
        setStreamers((prev) => (append ? [...prev, ...list] : list));

        if (res?.data?.total !== undefined) {
          const PAGE_SIZE = 20;
          const totalFetched = (pageToFetch + 1) * PAGE_SIZE;
          setHasMore(res.data.total > totalFetched && list.length > 0);
        } else if (res?.data?.page_count !== undefined) {
          setHasMore(pageToFetch + 1 < (res.data.page_count || 0) && list.length > 0);
        } else {
          setHasMore(list.length === 20);
        }
      } catch (error) {
        console.error("[douyu-home] fetch live list failed", error);
        if (!append) setStreamers([]);
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    },
    [selectedCate2, selectedCate3]
  );

  useEffect(() => {
    // ensure derived selections are set once categories are initialized
    if (cate1List.length > 0 && !selectedCate1) {
      setSelectedCate1(cate1List[0].id);
      const firstCate2 = cateOptions.find((c) => c.cate1Id === cate1List[0].id);
      setSelectedCate2(firstCate2?.shortName || null);
      setSelectedCate3(null);
      pageRef.current = 0;
    }
  }, [cate1List, cateOptions, selectedCate1]);

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

  useEffect(() => {
    if (selectedCate1) {
      const firstCate2 = cateOptions.find((c) => c.cate1Id === selectedCate1);
      setSelectedCate2(firstCate2?.shortName || null);
      setSelectedCate3(null);
    }
  }, [selectedCate1, cateOptions]);

  useEffect(() => {
    pageRef.current = 0;
    if (selectedCate2 || selectedCate3) {
      void fetchList(0, false);
    }
  }, [selectedCate2, selectedCate3, fetchList]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    const next = pageRef.current + 1;
    pageRef.current = next;
    void fetchList(next, true);
  }, [fetchList, hasMore, loading]);

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
  }, [loadMore, hasMore, loading]);

  const cate1Limit = isMobile ? 8 : cate1List.length;
  const cate2Limit = isMobile ? 12 : cateOptions.length;
  const visibleCate1 = isMobile ? cate1List.slice(0, cate1Limit) : cate1List;
  const visibleCate2 = isMobile
    ? cateOptions.filter((cate) => (selectedCate1 ? cate.cate1Id === selectedCate1 : true)).slice(0, cate2Limit)
    : cateOptions.filter((cate) => (selectedCate1 ? cate.cate1Id === selectedCate1 : true));
  const cate2CollapsedHeight = 96;
  const cate2ContainerMaxHeight = Math.max(260, Math.floor(viewportHeight * 0.8));
  const cate2ExpandedMaxHeight = Math.max(200, cate2ContainerMaxHeight - 60);
  const expandedCate2 = cate2Expanded || visibleCate2.length <= 10;
  const cate2Transition = {
    maxHeight: { duration: expandedCate2 ? 0.6 : 0.38, ease: [0.16, 1, 0.3, 1] },
    opacity: { duration: 0.25 },
    scaleY: { type: "spring", stiffness: 200, damping: expandedCate2 ? 26 : 28, mass: 1.05 },
  };

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
                  {c1.name}
                </button>
              ))}
              {isMobile && cate1List.length > cate1Limit ? (
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
            onClick={() => {
              pageRef.current = 0;
              void fetchList(0, false);
            }}
            className="inline-flex items-center justify-center px-3 py-2 rounded-lg border border-white/10 bg-transparent hover:bg-white/10 transition-colors text-sm"
            title="刷新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

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
            {visibleCate2.map((cate) => (
              <button
                key={cate.shortName}
                onClick={() => {
                  setSelectedCate2(cate.shortName);
                  setSelectedCate3(null);
                }}
                className={categoryChipClass(selectedCate2 === cate.shortName)}
              >
                {cate.name}
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
          {!isMobile && cateOptions.length > 10 && visibleCate2.length > 10 && (
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
        {currentCate3List.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-gray-400">三级分类</div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setSelectedCate3(null)}
                className={`px-3 py-1.5 rounded-full border text-xs transition-colors ${
                  selectedCate3 === null ? "border-emerald-400/60 text-emerald-100 bg-emerald-500/10" : "border-white/10 text-gray-200"
                }`}
              >
                全部
              </button>
              {currentCate3List.map((c3) => (
                <button
                  key={c3.id}
                  onClick={() => setSelectedCate3(c3.id)}
                  className={`px-3 py-1.5 rounded-full border text-xs transition-colors ${
                    selectedCate3 === c3.id ? "border-emerald-400/60 text-emerald-100 bg-emerald-500/10" : "border-white/10 text-gray-200"
                  }`}
                >
                  {c3.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 bg-transparent overflow-hidden">
        {loading && streamers.length === 0 ? (
          <LiveGridSkeleton className={`grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 ${isSidebarOpen ? "xl:grid-cols-5" : "xl:grid-cols-6"}`} />
        ) : streamers.length === 0 ? (
          <div className="text-center text-sm text-gray-400 py-10">暂无直播</div>
        ) : (
          <div ref={scrollRef} className="max-h-full overflow-y-auto no-scrollbar pr-3">
            <LiveGrid
              items={streamers.map(
                (s): LiveCardItem => ({
                  id: s.rid,
                  title: s.roomName || s.nickname || s.rid,
                  subtitle: s.nickname,
                  cover: s.roomSrc || "https://via.placeholder.com/320x180.png?text=No+Image",
                  avatar: s.avatar || "https://via.placeholder.com/40.png?text=?",
                  viewerText: String(s.hn ?? ""),
                })
              )}
              className={`grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 ${isSidebarOpen ? "xl:grid-cols-5" : "xl:grid-cols-6"}`}
              onCardClick={(item) =>
                openPlayer({
                  platform: Platform.DOUYU,
                  roomId: item.id,
                  title: item.title,
                  anchorName: item.subtitle ?? undefined,
                  avatar: item.avatar ?? undefined,
                })
              }
            />
            <div ref={loaderRef} className="h-8" />
          </div>
        )}

        <div className="flex justify-center mt-4">
          {hasMore ? (
            <button
              onClick={loadMore}
              disabled={loading}
              className="px-4 py-2 rounded-full border border-white/20 bg-white/5 hover:bg-white/10 text-sm inline-flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              加载更多
            </button>
          ) : (
            <div className="text-xs text-gray-500">没有更多了</div>
          )}
        </div>
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
                    : selectedCate2 === (item as CateOption).shortName;
                return (
                  <button
                    key={showCateSheet === "cate1" ? item.id : (item as CateOption).shortName}
                    onClick={() => {
                      if (showCateSheet === "cate1") {
                        setSelectedCate1(item.id);
                        const firstCate2 = cateOptions.find((c) => c.cate1Id === item.id);
                        setSelectedCate2(firstCate2?.shortName || null);
                        setSelectedCate3(null);
                      } else {
                        const c = item as CateOption;
                        setSelectedCate2(c.shortName);
                        setSelectedCate3(null);
                      }
                      setShowCateSheet(null);
                    }}
                    className={`px-3 py-2 rounded-xl text-sm text-left ${
                      active ? "bg-white text-gray-900 font-semibold" : "bg-white/10 text-white hover:bg-white/15"
                    }`}
                  >
                    {"name" in item ? item.name : (item as CateOption).name}
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
