"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState, useCallback } from "react";
import { Loader2, Eye, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import huyaCategories from "@/data/huya_categories.json";
import { fetchHuyaLiveList } from "@/services/huya";
import { HuyaCategory, HuyaStreamer } from "@/types/huya";
import { Platform } from "@/types/platform";
import { useFollowStore } from "@/stores/follow-store";
import { platformSlugMap } from "@/utils/platform";

const PAGE_SIZE = 120;

export function HuyaHome() {
  const router = useRouter();
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
    <div className="bg-black/40 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl p-4 md:p-6 space-y-4 min-h-full">
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
              className={`px-3 py-2 rounded-full border text-sm transition-colors ${
                selectedCate1 === c1.title ? "border-white/80 text-white bg-white/10" : "border-white/10 text-gray-200 hover:bg-white/5"
              }`}
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
                className={`px-3 py-2 rounded-full border text-sm transition-colors ${
                  selectedCateId === c.id ? "border-white/80 text-white bg-white/10" : "border-white/10 text-gray-200 hover:bg-white/5"
                }`}
              >
                {c.title}
              </button>
            ))}
        </div>
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
              const followed = isFollowed(Platform.HUYA, s.room_id);
              return (
                <div
                  key={s.room_id}
                  className="group rounded-xl border border-white/10 bg-black/40 overflow-hidden hover:border-white/30 transition-colors cursor-pointer"
                  onClick={() => {
                    const slug = platformSlugMap[Platform.HUYA];
                    router.push(`/player?platform=${slug}&roomId=${s.room_id}`);
                  }}
                >
                  <div className="relative">
                    <img
                      src={s.room_cover || "https://via.placeholder.com/320x180.png?text=No+Image"}
                      alt={s.title}
                      className="w-full aspect-video object-cover"
                    />
                    <div className="absolute top-2 right-2 inline-flex items-center gap-1 text-xs bg-black/60 backdrop-blur px-2 py-1 rounded-full">
                      <Eye className="w-4 h-4" />
                      <span>{s.viewer_count_str}</span>
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
                        <div className="text-sm font-semibold text-white truncate">{s.title || s.room_id}</div>
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
                          unfollow(Platform.HUYA, s.room_id);
                        } else {
                          follow({
                            id: s.room_id,
                            platform: Platform.HUYA,
                            nickname: s.nickname,
                            avatarUrl: s.avatar,
                            displayName: s.title,
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
