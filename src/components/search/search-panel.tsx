"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Search, Loader2, UserPlus, UserMinus, AlertTriangle } from "lucide-react";
import { tauriInvoke } from "@/lib/tauri";
import { Platform } from "@/types/platform";
import { useFollowStore } from "@/stores/follow-store";
import { proxyBilibiliImage } from "@/utils/image";

type SearchResult = {
  id: string;
  nickname: string;
  title?: string;
  avatarUrl?: string;
  platform: Platform;
};

export function SearchPanel({ platform: currentPlatform }: { platform?: Platform }) {
  const [keyword, setKeyword] = useState("");
  const [platform, setPlatform] = useState<Platform>(currentPlatform ?? Platform.DOUYU);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isFollowed = useFollowStore((s) => s.isFollowed);
  const follow = useFollowStore((s) => s.followStreamer);
  const unfollow = useFollowStore((s) => s.unfollowStreamer);

  useEffect(() => {
    if (currentPlatform) setPlatform(currentPlatform);
  }, [currentPlatform]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [open]);

  const parseResult = (payload: unknown): SearchResult[] => {
    if (!payload) return [];
    // Try parse JSON string
    let data: unknown = payload;
    if (typeof payload === "string") {
      try {
        data = JSON.parse(payload);
      } catch {
        return [];
      }
    }

    // Douyu structure: { data: { relateUser: [ { anchorInfo: {...}} ] } }
    if (!Array.isArray(data) && typeof data === "object" && data !== null) {
      const relateUser = (data as Record<string, unknown>).data?.relateUser as unknown;
      if (Array.isArray(relateUser)) {
        return relateUser
          .map((item: unknown) => {
            if (!item || typeof item !== "object") return null;
            const info = (item as Record<string, unknown>).anchorInfo || {};
            const id = info.rid || info.roomId || info.userId;
            const nickname = info.nickName || info.nickname || info.userName;
            if (!id || !nickname) return null;
            return {
              id: String(id),
              nickname: String(nickname),
              title: info.description || info.title || "",
              avatarUrl: info.avatar || "",
              platform: Platform.DOUYU,
            } as SearchResult;
          })
          .filter(Boolean) as SearchResult[];
      }
    }

    if (!Array.isArray(data)) {
      // Douyin fetch_douyin_room_info returns object
      if (platform === Platform.DOUYIN && typeof data === "object" && data) {
        const obj = data as Record<string, unknown>;
        const id = obj.web_rid || obj.webRid;
        const nickname = obj.nickname;
        const title = obj.room_name || obj.roomName;
        const avatar = obj.avatar_url || obj.avatarUrl;
        if (id && nickname) {
          return [
            {
              id: String(id),
              nickname: String(nickname),
              title: title ? String(title) : "",
              avatarUrl: avatar ? String(avatar) : "",
              platform: Platform.DOUYIN,
            },
          ];
        }
      }
      return [];
    }
    const arr = data as Array<Record<string, unknown>>;
      const mapped: SearchResult[] = [];
      for (const item of arr) {
      // Huya structure: room_id, user_name, title, avatar
      // Bilibili structure: room_id, anchor, avatar, cover
      const id =
        (item.room_id as string) ||
        (item.rid as string) ||
        (item.id as string) ||
        (item.roomId as string) ||
        (item.roomid as string);
      const nickname =
        (item.nickname as string) ||
        (item.userName as string) ||
        (item.name as string) ||
        (item.user_name as string) ||
        (item.anchor as string);
      if (!id || !nickname) continue;
      const rawAvatar = (item.avatar as string) || (item.face as string) || (item.avatarUrl as string) || "";
      mapped.push({
        id: String(id),
        nickname: String(nickname),
        title: (item.title as string) || (item.roomName as string) || "",
        avatarUrl: platform === Platform.BILIBILI ? proxyBilibiliImage(rawAvatar) || rawAvatar : rawAvatar,
        platform,
      });
    }
    return mapped;
  };

  const doSearch = async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      let payload: unknown;
      if (platform === Platform.DOUYU) {
        payload = await tauriInvoke("search_anchor", { keyword });
      } else if (platform === Platform.HUYA) {
        payload = await tauriInvoke("search_huya_anchors", { keyword });
      } else if (platform === Platform.BILIBILI) {
        payload = await tauriInvoke("search_bilibili_rooms", { keyword });
      } else if (platform === Platform.DOUYIN) {
        // 仅支持按房间号搜索
        payload = await tauriInvoke("fetch_douyin_room_info", { liveId: keyword.trim() });
      } else {
        setError("当前平台暂不支持搜索");
        setLoading(false);
        return;
      }
      const parsed = parseResult(payload);
      setResults(parsed);
      if (!parsed.length) setError("没有结果");
    } catch (e) {
      const err = e as Error;
      setError(err.message || "搜索失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        disabled={loading}
        className="px-3 py-2 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 transition-colors inline-flex items-center gap-2 text-sm"
        title="搜索主播或房间"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        <span className="hidden sm:inline">搜索</span>
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 z-[120] w-[320px] rounded-2xl border border-white/10 bg-black/85 backdrop-blur-2xl p-3 shadow-2xl space-y-3">
          <div className="flex items-center gap-2">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") doSearch();
              }}
              placeholder="搜索主播或房间..."
              className="flex-1 bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-white/40"
            />
            <button
              onClick={() => void doSearch()}
              disabled={loading}
              className="h-10 px-3 inline-flex items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-black font-semibold shadow-lg hover:from-emerald-300 hover:to-cyan-400 transition-all disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <div className="text-xs text-amber-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          )}

          {results.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-2 max-h-[60vh] overflow-y-auto space-y-1">
              {results.map((r) => {
                const followed = isFollowed(r.platform, r.id);
                return (
                  <div
                    key={`${r.platform}-${r.id}`}
                    className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 flex items-center gap-2 hover:border-white/25 transition-all"
                  >
                    <div className="w-8 h-8 rounded-full border border-white/10 overflow-hidden flex-shrink-0">
                      {r.avatarUrl ? (
                        <Image src={proxyBilibiliImage(r.avatarUrl) || r.avatarUrl} alt={r.nickname} width={32} height={32} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-white/10 flex items-center justify-center text-xs font-semibold">
                          {r.nickname.slice(0, 1)}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-[13px] font-semibold text-white truncate max-w-[8rem]">{r.nickname}</span>
                      </div>
                      {r.title ? <div className="text-[10px] text-gray-400 line-clamp-1">{r.title}</div> : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        className={`text-[11px] px-2 py-1 rounded-full border inline-flex items-center gap-1 ${
                          followed
                            ? "border-emerald-400/60 text-emerald-100 bg-emerald-500/10"
                            : "border-white/20 text-white hover:bg-white/10"
                        }`}
                        onClick={() => {
                          if (followed) {
                            unfollow(r.platform, r.id);
                          } else {
                            follow({
                              id: r.id,
                              platform: r.platform,
                              nickname: r.nickname,
                              avatarUrl: r.platform === Platform.BILIBILI ? proxyBilibiliImage(r.avatarUrl) || "" : r.avatarUrl || "",
                              displayName: r.title || r.nickname,
                              isLive: true,
                            });
                          }
                        }}
                      >
                        {followed ? <UserMinus className="w-3 h-3" /> : <UserPlus className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
