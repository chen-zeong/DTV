"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState, useCallback } from "react";
import { Loader2, Eye, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import biliCategories from "@/data/bilibili_categories.json";
import { BiliCategory, BiliLiveRoom } from "@/types/bilibili";
import { fetchBilibiliLiveList } from "@/services/bilibili";
import { Platform } from "@/types/platform";
import { useFollowStore } from "@/stores/follow-store";
import { platformSlugMap } from "@/utils/platform";

type CateOption = {
  id: string;
  title: string;
  parentId?: string;
};

export function BilibiliHome() {
  const router = useRouter();
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

  const [selectedCate, setSelectedCate] = useState<CateOption | null>(null);
  const [rooms, setRooms] = useState<BiliLiveRoom[]>([]);
  const [pageNo, setPageNo] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

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
      setSelectedCate(cateOptions[0]);
    }
  }, [cateOptions]);

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
    <div className="bg-black/40 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl p-4 md:p-6 space-y-4 min-h-full">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-gray-400">Bilibili</p>
          <h2 className="text-xl font-semibold text-white">分类与直播</h2>
        </div>
        <button
          onClick={() => void fetchRooms(1, false)}
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
              key={c.id}
              onClick={() => {
                setSelectedCate(c);
                setPageNo(1);
              }}
              className={`px-3 py-2 rounded-full border text-sm transition-colors ${
                selectedCate?.id === c.id ? "border-white/80 text-white bg-white/10" : "border-white/10 text-gray-200 hover:bg-white/5"
              }`}
            >
              {c.title}
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
              const roomId = s.room_id || "";
              const title = s.title || roomId;
              const avatar = s.avatar || "";
              const nickname = s.nickname || "";
              const cover = s.room_cover || "";
              const viewerStr = s.viewer_count_str || "0";
              const followed = isFollowed(Platform.BILIBILI, roomId);
              return (
                <div
                  key={`${roomId}-${title}`}
                  className="group rounded-xl border border-white/10 bg-black/40 overflow-hidden hover:border-white/30 transition-colors cursor-pointer"
                  onClick={() => {
                    const slug = platformSlugMap[Platform.BILIBILI];
                    router.push(`/player?platform=${slug}&roomId=${roomId}`);
                  }}
                >
                  <div className="relative">
                    <img
                      src={cover || "https://via.placeholder.com/320x180.png?text=No+Image"}
                      alt={title}
                      className="w-full aspect-video object-cover"
                    />
                    <div className="absolute top-2 right-2 inline-flex items-center gap-1 text-xs bg-black/60 backdrop-blur px-2 py-1 rounded-full">
                      <Eye className="w-4 h-4" />
                      <span>{viewerStr}</span>
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <img
                        src={avatar || "https://via.placeholder.com/40.png?text=?"}
                        alt={nickname}
                        className="w-10 h-10 rounded-full object-cover border border-white/10"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-white truncate">{title}</div>
                        <div className="text-xs text-gray-400 truncate">{nickname}</div>
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
                          unfollow(Platform.BILIBILI, roomId);
                        } else {
                          follow({
                            id: roomId,
                            platform: Platform.BILIBILI,
                            nickname,
                            avatarUrl: avatar,
                            displayName: title,
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
