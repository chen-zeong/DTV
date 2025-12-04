"use client";

import { useState } from "react";
import { Search, Loader2, Play, UserPlus, UserMinus, AlertTriangle } from "lucide-react";
import { tauriInvoke } from "@/lib/tauri";
import { Platform } from "@/types/platform";
import { platformLabelMap, platformSlugMap } from "@/utils/platform";
import { useFollowStore } from "@/stores/follow-store";
import { useRouter } from "next/navigation";

type SearchResult = {
  id: string;
  nickname: string;
  title?: string;
  avatarUrl?: string;
  platform: Platform;
};

const platformOptions: Array<{ label: string; value: Platform }> = [
  { label: platformLabelMap[Platform.DOUYU], value: Platform.DOUYU },
  { label: platformLabelMap[Platform.HUYA], value: Platform.HUYA },
  { label: platformLabelMap[Platform.BILIBILI], value: Platform.BILIBILI },
];

export function SearchPanel() {
  const [keyword, setKeyword] = useState("");
  const [platform, setPlatform] = useState<Platform>(Platform.DOUYU);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const isFollowed = useFollowStore((s) => s.isFollowed);
  const follow = useFollowStore((s) => s.followStreamer);
  const unfollow = useFollowStore((s) => s.unfollowStreamer);
  const router = useRouter();

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
    if (!Array.isArray(data)) return [];
    const arr = data as Array<Record<string, unknown>>;
    const mapped: SearchResult[] = [];
    for (const item of arr) {
      const id =
        (item.room_id as string) ||
        (item.rid as string) ||
        (item.id as string) ||
        (item.roomId as string) ||
        (item.roomid as string);
      const nickname = (item.nickname as string) || (item.userName as string) || (item.name as string);
      if (!id || !nickname) continue;
      mapped.push({
        id: String(id),
        nickname: String(nickname),
        title: (item.title as string) || (item.roomName as string) || "",
        avatarUrl: (item.avatar as string) || (item.face as string) || (item.avatarUrl as string) || "",
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
      } else {
        payload = [];
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
    <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-4 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:gap-3 gap-2">
        <div className="flex items-center gap-2 flex-1">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doSearch();
            }}
            placeholder="搜索主播或房间..."
            className="flex-1 bg-transparent border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white/30"
          />
        </div>
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform)}
          className="bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm"
        >
          {platformOptions.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <button
          onClick={doSearch}
          disabled={loading}
          className="px-4 py-2 rounded-lg border border-white/20 bg-white/10 hover:bg-white/20 text-sm inline-flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          搜索
        </button>
      </div>

      {error && (
        <div className="text-xs text-amber-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {results.map((r) => {
          const followed = isFollowed(r.platform, r.id);
          return (
            <div
              key={`${r.platform}-${r.id}`}
              className="rounded-xl border border-white/10 bg-black/40 p-3 space-y-2 hover:border-white/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-full border border-white/10 overflow-hidden">
                  {r.avatarUrl ? (
                    <img src={r.avatarUrl} alt={r.nickname} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-white/10 flex items-center justify-center text-sm font-semibold">
                      {r.nickname.slice(0, 1)}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{r.nickname}</div>
                  <div className="text-xs text-gray-400 truncate">
                    {platformLabelMap[r.platform]} {r.id}
                  </div>
                </div>
              </div>
              {r.title && <div className="text-xs text-gray-400 line-clamp-2">{r.title}</div>}
              <div className="flex items-center justify-between gap-2">
                <button
                  className="text-xs px-3 py-1 rounded-full border border-white/20 hover:bg-white/10 inline-flex items-center gap-1"
                  onClick={() => {
                    const slug = platformSlugMap[r.platform];
                    router.push(`/player?platform=${slug}&roomId=${r.id}`);
                  }}
                >
                  <Play className="w-3 h-3" /> 播放
                </button>
                <button
                  className={`text-xs px-3 py-1 rounded-full border inline-flex items-center gap-1 ${
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
                        avatarUrl: r.avatarUrl || "",
                        displayName: r.title || r.nickname,
                        isLive: true,
                      });
                    }
                  }}
                >
                  {followed ? (
                    <>
                      <UserMinus className="w-3 h-3" /> 取消
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-3 h-3" /> 关注
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
