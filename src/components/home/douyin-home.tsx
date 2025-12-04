"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState, useCallback } from "react";
import { Loader2, Eye, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import douyinCategories from "@/data/douyin_categories.json";
import { DouyinCategory } from "@/types/douyin";
import { fetchDouyinMsToken, fetchDouyinPartitionRooms, mapDouyinRoom, DouyinPartitionRoomsResponse } from "@/services/douyin-home";
import { Platform } from "@/types/platform";
import { useFollowStore } from "@/stores/follow-store";
import { platformSlugMap } from "@/utils/platform";

type CategorySelected = {
  cate2Href: string;
  cate1Name: string;
  cate2Name: string;
};

export function DouyinHome() {
  const router = useRouter();
  const isFollowed = useFollowStore((s) => s.isFollowed);
  const follow = useFollowStore((s) => s.followStreamer);
  const unfollow = useFollowStore((s) => s.unfollowStreamer);

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
  const [rooms, setRooms] = useState<Array<ReturnType<typeof mapDouyinRoom>>>([]);
  const [msToken, setMsToken] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

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
      if (!msToken) {
        const token = await loadMsToken();
        if (!token) {
          return;
        }
      }

      const { partition, partitionType } = parsePartition(selectedCate.cate2Href);
      if (!partition || !partitionType || !msToken) {
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
          msToken,
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
      setSelectedCate(cateOptions[0]);
    }
  }, [cateOptions]);

  useEffect(() => {
    setOffset(0);
    setHasMore(true);
    setRooms([]);
    if (selectedCate) {
      void fetchRooms(0, false);
    }
  }, [selectedCate, fetchRooms]);

  const loadMore = () => {
    if (loading || loadingMore || !hasMore) return;
    void fetchRooms(offset, true);
  };

  return (
    <div className="bg-black/40 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl p-4 md:p-6 space-y-4 min-h-full">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-gray-400">Douyin</p>
          <h2 className="text-xl font-semibold text-white">分类与直播</h2>
        </div>
        <button
          onClick={() => selectedCate && fetchRooms(0, false)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-sm"
        >
          <RefreshCw className="w-4 h-4" /> 刷新
        </button>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-gray-400">分类</div>
        <div className="flex gap-2 flex-wrap">
          {cateOptions.map((c) => (
            <button
              key={c.cate2Href}
              onClick={() => {
                setSelectedCate(c);
                setOffset(0);
              }}
              className={`px-3 py-2 rounded-full border text-sm transition-colors ${
                selectedCate?.cate2Href === c.cate2Href ? "border-white/80 text-white bg-white/10" : "border-white/10 text-gray-200 hover:bg-white/5"
              }`}
            >
              {c.cate2Name}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-4">
        {loading && rooms.length === 0 ? (
          <div className="flex items-center justify-center gap-2 text-gray-300 text-sm">
            <Loader2 className="w-5 h-5 animate-spin" /> 加载直播列表...
          </div>
        ) : rooms.length === 0 ? (
          <div className="text-center text-sm text-gray-400 py-10">暂无直播</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {rooms.map((s) => {
              const followed = isFollowed(Platform.DOUYIN, s.room_id);
              return (
                <div
                  key={s.room_id}
                  className="group rounded-xl border border-white/10 bg-black/40 overflow-hidden hover:border-white/30 transition-colors cursor-pointer"
                  onClick={() => {
                    const slug = platformSlugMap[Platform.DOUYIN];
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
                          unfollow(Platform.DOUYIN, s.room_id);
                        } else {
                          follow({
                            id: s.room_id,
                            platform: Platform.DOUYIN,
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
