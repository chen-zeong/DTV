/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Loader2, RefreshCw, ChevronDown } from "lucide-react";
import { motion, type Transition } from "framer-motion";
import { fetchDouyuLiveList } from "@/services/douyu";
import { DouyuCate2, DouyuCate3, DouyuStreamer } from "@/types/douyu";
import { Platform } from "@/types/platform";
import { usePlayerOverlayStore } from "@/stores/player-overlay-store";
import { LiveGrid, LiveGridSkeleton, type LiveCardItem } from "@/components/live/live-grid";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useThemeStore } from "@/stores/theme-store";
import { CategoryPill } from "@/components/category/category-pill";
import { CategorySheet } from "@/components/category/category-sheet";
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
  const theme = useThemeStore((s) => s.resolvedTheme);
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
  const cate2Transition: Transition = {
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
                    label={c1.name}
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
                  <CategoryPill key={c1.id} label={c1.name} isDark={isDark} active={selectedCate1 === c1.id} onClick={() => setSelectedCate1(c1.id)} />
                ))}
                {isMobile && cate1List.length > cate1Limit ? (
                  <CategoryPill label="更多" isDark={isDark} size="sm" onClick={() => setShowCateSheet("cate1")} />
                ) : null}
              </div>
            )}
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

        {isMobile ? (
          <div className="mt-1">
            <div className="flex gap-4 overflow-x-auto no-scrollbar -mx-1 px-1 py-1">
              {visibleCate2.map((cate) => (
                <CategoryPill
                  key={cate.shortName}
                  label={cate.name}
                  isDark={isDark}
                  active={selectedCate2 === cate.shortName}
                  onClick={() => {
                    setSelectedCate2(cate.shortName);
                    setSelectedCate3(null);
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
              {visibleCate2.map((cate) => (
                <CategoryPill
                  key={cate.shortName}
                  label={cate.name}
                  isDark={isDark}
                  active={selectedCate2 === cate.shortName}
                  onClick={() => {
                    setSelectedCate2(cate.shortName);
                    setSelectedCate3(null);
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
                <CategoryPill
                  isDark={isDark}
                  size="sm"
                  onClick={() => setCate2Expanded((v) => !v)}
                  className="px-3"
                >
                  <span className="text-xs">{cate2Expanded ? "收起" : "展开"}</span>
                  <motion.span animate={{ rotate: cate2Expanded ? 180 : 0 }} transition={{ duration: 0.2, ease: "easeInOut" }}>
                    <ChevronDown className="w-4 h-4" />
                  </motion.span>
                </CategoryPill>
              </div>
            )}
          </div>
        )}
        {currentCate3List.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-gray-400">三级分类</div>
            <div className="flex gap-2 flex-wrap">
              <CategoryPill
                label="全部"
                size="sm"
                isDark={isDark}
                active={selectedCate3 === null}
                onClick={() => setSelectedCate3(null)}
              />
              {currentCate3List.map((c3) => (
                <CategoryPill
                  key={c3.id}
                  label={c3.name}
                  size="sm"
                  isDark={isDark}
                  active={selectedCate3 === c3.id}
                  onClick={() => setSelectedCate3(c3.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 bg-transparent overflow-hidden">
        {loading && streamers.length === 0 ? (
          <LiveGridSkeleton className={gridColsClass} />
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
              className={gridColsClass}
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

      {isMobile && showCateSheet === "cate1" ? (
        <CategorySheet
          title="选择一级分类"
          isDark={isDark}
          items={cate1List.map((c1) => ({ id: c1.id, label: c1.name }))}
          activeId={selectedCate1}
          onClose={() => setShowCateSheet(null)}
          onSelect={(id) => {
            setSelectedCate1(id);
            const firstCate2 = cateOptions.find((c) => c.cate1Id === id);
            setSelectedCate2(firstCate2?.shortName || null);
            setSelectedCate3(null);
            setShowCateSheet(null);
          }}
        />
      ) : null}
      {isMobile && showCateSheet === "cate2" ? (
        <CategorySheet
          title="选择二级分类"
          isDark={isDark}
          items={cateOptions.map((c2) => ({ id: c2.shortName, label: c2.name }))}
          activeId={selectedCate2}
          onClose={() => setShowCateSheet(null)}
          onSelect={(id) => {
            setSelectedCate2(id);
            setSelectedCate3(null);
            setShowCateSheet(null);
          }}
        />
      ) : null}
    </div>
  );
}
