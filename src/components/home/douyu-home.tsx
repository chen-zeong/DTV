"use client";

/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Loader2, RefreshCw, Eye } from "lucide-react";
import { useRouter } from "next/navigation";
import { fetchDouyuCategories, fetchDouyuLiveList } from "@/services/douyu";
import { DouyuCate2, DouyuCate3, DouyuStreamer } from "@/types/douyu";
import { useFollowStore } from "@/stores/follow-store";
import { Platform } from "@/types/platform";
import { platformSlugMap } from "@/utils/platform";

type CateOption = {
  id: string;
  name: string;
  shortName: string;
  cate1Id: string;
  cate3?: DouyuCate3[];
};

export function DouyuHome() {
  const router = useRouter();
  const isFollowed = useFollowStore((s) => s.isFollowed);
  const follow = useFollowStore((s) => s.followStreamer);
  const unfollow = useFollowStore((s) => s.unfollowStreamer);

  const [cate1List, setCate1List] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedCate1, setSelectedCate1] = useState<string | null>(null);
  const [cateOptions, setCateOptions] = useState<CateOption[]>([]);
  const [selectedCate2, setSelectedCate2] = useState<string | null>(null);
  const [selectedCate3, setSelectedCate3] = useState<string | null>(null);
  const [streamers, setStreamers] = useState<DouyuStreamer[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState(false);

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
    setPage(0);
    if (selectedCate2 || selectedCate3) {
      void fetchList(0, false);
    }
  }, [selectedCate2, selectedCate3, fetchList]);

  const loadMore = () => {
    if (loading || !hasMore) return;
    const next = page + 1;
    setPage(next);
    void fetchList(next, true);
  };

  return (
    <div className="bg-black/40 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl p-4 md:p-6 space-y-4 min-h-full">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col flex-1 gap-2">
            <div className="text-xs text-gray-400">一级分类</div>
            <div className="flex gap-2 flex-wrap">
              {loadingCategories && cate1List.length === 0 ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> 加载分类...
                </div>
              ) : (
                cate1List.map((c1) => (
                  <button
                    key={c1.id}
                    onClick={() => setSelectedCate1(c1.id)}
                    className={`px-3 py-2 rounded-full border text-sm transition-colors ${
                      selectedCate1 === c1.id ? "border-white/80 text-white bg-white/10" : "border-white/10 text-gray-200 hover:bg-white/5"
                    }`}
                  >
                    {c1.name}
                  </button>
                ))
              )}
            </div>
          </div>
          <button
            onClick={() => {
              setPage(0);
              void fetchList(0, false);
            }}
            className="inline-flex items-center justify-center px-3 py-2 rounded-lg border border-white/10 bg-transparent hover:bg-white/10 transition-colors text-sm"
            title="刷新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="text-xs text-gray-400">二级分类</div>
        <div className="flex gap-2 flex-wrap">
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
                  className={`px-3 py-2 rounded-full border text-sm transition-colors ${
                    selectedCate2 === cate.shortName
                      ? "border-white/80 text-white bg-white/10"
                      : "border-white/10 text-gray-200 hover:bg-white/5"
                  }`}
                >
                  {cate.name}
                </button>
              ))
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

      <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-4">
        {loading && streamers.length === 0 ? (
          <div className="flex items-center justify-center gap-2 text-gray-300 text-sm">
            <Loader2 className="w-5 h-5 animate-spin" /> 加载直播列表...
          </div>
        ) : streamers.length === 0 ? (
          <div className="text-center text-sm text-gray-400 py-10">暂无直播</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {streamers.map((s) => {
              const followed = isFollowed(Platform.DOUYU, s.rid);
              return (
                <div
                  key={s.rid}
                  className="group rounded-xl border border-white/10 bg-black/40 overflow-hidden hover:border-white/30 transition-colors cursor-pointer"
                  onClick={() => {
                    const slug = platformSlugMap[Platform.DOUYU];
                    router.push(`/player?platform=${slug}&roomId=${s.rid}`);
                  }}
                >
                  <div className="relative">
                    <img
                      src={s.roomSrc || "https://via.placeholder.com/320x180.png?text=No+Image"}
                      alt={s.roomName}
                      className="w-full aspect-video object-cover"
                    />
                    <div className="absolute top-2 right-2 inline-flex items-center gap-1 text-xs bg-black/60 backdrop-blur px-2 py-1 rounded-full">
                      <Eye className="w-4 h-4" />
                      <span>{s.hn}</span>
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <img
                        src={s.avatar || "https://via.placeholder.com/40.png?text=?"}
                        alt={s.nickname}
                        className="w-10 h-10 rounded-full object-cover border border-white/10"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-white truncate">{s.roomName}</div>
                        <div className="text-xs text-gray-400 truncate">{s.nickname}</div>
                      </div>
                    </div>
                    <button
                      className={`w-full text-sm rounded-lg px-3 py-2 border transition-colors ${
                        followed
                          ? "border-emerald-400/60 text-emerald-100 bg-emerald-500/10"
                          : "border-white/10 text-white hover:bg-white/10"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (followed) {
                          unfollow(Platform.DOUYU, s.rid);
                        } else {
                          follow({
                            id: s.rid,
                            platform: Platform.DOUYU,
                            nickname: s.nickname,
                            avatarUrl: s.avatar,
                            displayName: s.roomName,
                            isLive: true,
                          });
                        }
                      }}
                    >
                      {followed ? "已关注" : "关注"}
                    </button>
                  </div>
                </div>
              );
            })}
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
