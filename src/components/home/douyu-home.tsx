/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Loader2, RefreshCw, ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
import { fetchDouyuCategories, fetchDouyuLiveList } from "@/services/douyu";
import { DouyuCate2, DouyuCate3, DouyuStreamer } from "@/types/douyu";
import { Platform } from "@/types/platform";
import { usePlayerOverlayStore } from "@/stores/player-overlay-store";
import { LiveGrid, type LiveCardItem } from "@/components/live/live-grid";

type CateOption = {
  id: string;
  name: string;
  shortName: string;
  cate1Id: string;
  cate3?: DouyuCate3[];
};

export function DouyuHome() {
  const openPlayer = usePlayerOverlayStore((s) => s.open);
  const [cate1List, setCate1List] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedCate1, setSelectedCate1] = useState<string | null>(null);
  const [cateOptions, setCateOptions] = useState<CateOption[]>([]);
  const [selectedCate2, setSelectedCate2] = useState<string | null>(null);
  const [selectedCate3, setSelectedCate3] = useState<string | null>(null);
  const [streamers, setStreamers] = useState<DouyuStreamer[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [cate2Expanded, setCate2Expanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loaderRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef(0);

  const categoryChipClass = (active: boolean) =>
    `inline-flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-semibold border transition-all backdrop-blur-sm ${
      active
        ? "bg-white text-gray-900 shadow-[0_10px_30px_-14px_rgba(255,255,255,0.85)] border-white/80 dark:bg-white dark:text-gray-900"
        : "bg-white/70 text-gray-700 border-gray-200 hover:bg-white dark:bg-white/5 dark:text-gray-200 dark:border-white/10 dark:hover:bg-white/10"
    }`;

  const currentCate3List = useMemo(() => {
    return cateOptions.find((c) => c.shortName === selectedCate2)?.cate3 ?? [];
  }, [cateOptions, selectedCate2]);

  const loadCategories = async () => {
    setLoadingCategories(true);
    try {
      const res = await fetchDouyuCategories();
      const c1s =
        res?.cate1List?.map((c1) => ({
          id: c1.id,
          name: c1.name,
        })) || [];
      setCate1List(c1s);
      const cate2s: CateOption[] =
        res?.cate1List?.flatMap((c1) =>
          (c1.cate2List || []).map((c2: DouyuCate2) => ({
            id: c2.id,
            name: c2.name,
            shortName: c2.short_name,
            cate1Id: c1.id,
            cate3: c2.cate3List || [],
          }))
        ) || [];
      setCateOptions(cate2s);
      if (c1s.length > 0) {
        setSelectedCate1(c1s[0].id);
        const firstCate2 = cate2s.find((c) => c.cate1Id === c1s[0].id);
        setSelectedCate2(firstCate2?.shortName || null);
        setSelectedCate3(null);
        pageRef.current = 0;
      }
    } catch (error) {
      console.error("[douyu-home] fetch categories failed", error);
    } finally {
      setLoadingCategories(false);
    }
  };

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
    void loadCategories();
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

  return (
    <div className="h-full flex flex-col p-3 md:p-4 space-y-3">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col flex-1 gap-2">
            <div className="flex gap-2 flex-wrap mt-2 mb-2">
              {loadingCategories && cate1List.length === 0 ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> 加载分类...
                </div>
              ) : (
                cate1List.map((c1) => (
                  <button
                    key={c1.id}
                    onClick={() => setSelectedCate1(c1.id)}
                    className={categoryChipClass(selectedCate1 === c1.id)}
                  >
                    {c1.name}
                  </button>
                ))
              )}
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

        <div className="relative mt-1">
          <motion.div
            layout
            initial={false}
            animate={{ height: cate2Expanded ? "auto" : "6rem" }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="flex gap-2 flex-wrap overflow-hidden"
            style={{ height: cate2Expanded ? "auto" : "6rem" }}
          >
            {loadingCategories && cateOptions.length === 0 ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> 加载分类...
              </div>
            ) : (
              cateOptions
                .filter((cate) => (selectedCate1 ? cate.cate1Id === selectedCate1 : true))
                .map((cate) => (
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
                ))
            )}
          </motion.div>
          {cateOptions.length > 10 && (
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

      <div className="flex-1 bg-transparent p-2 md:p-3 overflow-hidden">
        {loading && streamers.length === 0 ? (
          <div className="flex items-center justify-center gap-2 text-gray-300 text-sm">
            <Loader2 className="w-5 h-5 animate-spin" /> 加载直播列表...
          </div>
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
            className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
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
    </div>
  );
}
