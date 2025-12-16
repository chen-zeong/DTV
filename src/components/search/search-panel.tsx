"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Search, Loader2, UserPlus, UserMinus, AlertTriangle } from "lucide-react";
import { tauriInvoke } from "@/lib/tauri";
import { Platform } from "@/types/platform";
import { useFollowStore } from "@/stores/follow-store";
import { proxyBilibiliImage } from "@/utils/image";
import { motion } from "framer-motion";
import { useThemeStore } from "@/stores/theme-store";
import { useRouter } from "next/navigation";
import { platformSlugMap } from "@/utils/platform";

type SearchResult = {
  id: string;
  nickname: string;
  title?: string;
  avatarUrl?: string;
  platform: Platform;
  isLive?: boolean;
};

export function SearchPanel({ platform: currentPlatform }: { platform?: Platform }) {
  const [keyword, setKeyword] = useState("");
  const [platform, setPlatform] = useState<Platform>(currentPlatform ?? Platform.DOUYU);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const isFollowed = useFollowStore((s) => s.isFollowed);
  const follow = useFollowStore((s) => s.followStreamer);
  const unfollow = useFollowStore((s) => s.unfollowStreamer);
  const theme = useThemeStore((s) => s.resolvedTheme);
  const isDark = theme === "dark";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (currentPlatform) setPlatform(currentPlatform);
  }, [currentPlatform]);

  const toLiveFlag = (val: unknown): boolean | undefined => {
    if (val === undefined || val === null) return undefined;
    if (typeof val === "boolean") return val;
    if (typeof val === "number") return val === 1;
    if (typeof val === "string") {
      const lower = val.toLowerCase();
      if (["1", "true", "live", "living", "online"].includes(lower)) return true;
      if (["0", "false", "offline"].includes(lower)) return false;
    }
    return undefined;
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current) return;
      const target = event.target as Node;
      if (!containerRef.current.contains(target)) {
        setOpen(false);
        setResults([]);
        setError(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

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
      const record = data as Record<string, unknown>;
      const relateUser = (record.data as Record<string, unknown> | undefined)?.relateUser as unknown;
      if (Array.isArray(relateUser)) {
        return relateUser
          .map((item: unknown) => {
            if (!item || typeof item !== "object") return null;
            const info = ((item as Record<string, unknown>).anchorInfo || {}) as Record<string, unknown>;
            const id = (info["rid"] ?? info["roomId"] ?? info["userId"]) as string | number | undefined;
            const nickname = (info["nickName"] ?? info["nickname"] ?? info["userName"]) as string | undefined;
            const live = toLiveFlag(
              info["isLive"] ?? info["is_live"] ?? info["liveStatus"] ?? info["live_status"]
            );
            if (!id || !nickname) return null;
            return {
              id: String(id),
              nickname: String(nickname),
              title: info.description || info.title || "",
              avatarUrl: info.avatar || "",
              platform: Platform.DOUYU,
              isLive: live,
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
      const live = toLiveFlag(
        (item.is_live as unknown) ??
          (item.isLive as unknown) ??
          (item.live_status as unknown) ??
          (item.liveStatus as unknown) ??
          (item.status as unknown) ??
          (item.online as unknown) ??
          (item.live as unknown) ??
          (item.is_on as unknown)
      );
      mapped.push({
        id: String(id),
        nickname: String(nickname),
        title: (item.title as string) || (item.roomName as string) || "",
        avatarUrl: platform === Platform.BILIBILI ? proxyBilibiliImage(rawAvatar) || rawAvatar : rawAvatar,
        platform,
        isLive: live,
      });
    }
    return mapped;
  };

  const openRoom = (r: SearchResult) => {
    const slug = platformSlugMap[r.platform] || String(r.platform).toLowerCase();
    router.push(`/player?platform=${encodeURIComponent(slug)}&roomId=${encodeURIComponent(r.id)}`);
    setOpen(false);
  };

  const doSearch = async () => {
    if (!keyword.trim()) {
      setOpen(false);
      return;
    }
    setLoading(true);
    setOpen(true);
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
    <motion.div
      ref={containerRef}
      className="relative w-[160px] md:w-[180px] lg:w-[190px]"
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 24, mass: 0.8 }}
    >
      <div className="relative">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") doSearch();
          }}
          placeholder="搜索主播或房间..."
          className={`w-full min-w-[140px] rounded-xl px-3 pr-11 py-2 text-sm focus:outline-none transition-all ${
            isDark
              ? "bg-white/10 border border-white/18 focus:border-white/45 focus:ring-2 focus:ring-white/20 text-white placeholder:text-white/55"
              : "bg-white border border-gray-200 focus:border-gray-400 text-gray-900 placeholder:text-gray-400"
          }`}
        />
        <motion.button
          onClick={() => void doSearch()}
          disabled={loading}
          className={`absolute top-1/2 -translate-y-1/2 right-2 h-8 w-8 inline-flex items-center justify-center text-sm transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 ${
            isDark
              ? "text-white/75 hover:text-white focus-visible:ring-white/25 focus-visible:bg-white/8 rounded-full"
              : "text-gray-500 hover:text-gray-800 focus-visible:ring-gray-300 focus-visible:bg-gray-100 rounded-full"
          }`}
          type="button"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        </motion.button>
      </div>

      {open && (results.length > 0 || error) && (
        <motion.div
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 240, damping: 22, mass: 0.7 }}
          className={`absolute right-0 mt-2 z-[200] w-[320px] max-w-[90vw] rounded-2xl p-3 shadow-2xl space-y-3 ${
            isDark
              ? "border border-white/10 bg-black shadow-black/50"
              : "border border-gray-200 bg-white shadow-gray-400/30"
          }`}
        >
          {error && (
            <div className={`text-xs flex items-center gap-2 ${isDark ? "text-amber-200" : "text-amber-600"}`}>
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          )}

          {results.length > 0 && (
            <div className={`rounded-xl p-1 max-h-[60vh] overflow-y-auto space-y-1 ${isDark ? "bg-white/5" : "bg-gray-50"}`}>
              {results.map((r) => {
                const followed = isFollowed(r.platform, r.id);
                const liveState = r.isLive;
                const liveBadge =
                  liveState === undefined
                    ? { label: "未知", className: isDark ? "bg-gray-700 text-gray-200" : "bg-gray-200 text-gray-700" }
                    : liveState
                      ? { label: "直播中", className: "bg-red-500 text-white" }
                      : { label: "未开播", className: isDark ? "bg-white/10 text-white" : "bg-gray-200 text-gray-700" };
                return (
                  <div
                    key={`${r.platform}-${r.id}`}
                    className={`rounded-lg px-2 py-1.5 flex items-center gap-2 transition-all cursor-pointer ${
                      isDark
                        ? "hover:bg-white/10 text-white"
                        : "hover:bg-white border border-transparent hover:border-gray-200 bg-transparent text-gray-900"
                    }`}
                    onClick={() => openRoom(r)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openRoom(r);
                      }
                    }}
                  >
                    <div
                      className={`w-8 h-8 rounded-full overflow-hidden flex-shrink-0 ${
                        isDark ? "border border-white/10" : "border border-gray-200"
                      }`}
                    >
                      {r.avatarUrl ? (
                        <Image
                          src={proxyBilibiliImage(r.avatarUrl) || r.avatarUrl}
                          alt={r.nickname}
                          width={32}
                          height={32}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-white/10 flex items-center justify-center text-xs font-semibold">
                          {r.nickname.slice(0, 1)}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className={`text-[13px] font-semibold truncate max-w-[8rem] ${isDark ? "text-white" : "text-gray-900"}`}>
                          {r.nickname}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${liveBadge.className}`}>
                          {liveBadge.label}
                        </span>
                      </div>
                    {r.title ? (
                      <div className={`text-[10px] line-clamp-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                        {r.title}
                      </div>
                    ) : null}
                  </div>
                    <div className="flex items-center gap-1">
                      <button
                        className={`text-[11px] px-2 py-1 rounded-full border inline-flex items-center gap-1 ${
                          followed
                            ? isDark
                            ? "border-emerald-400/60 text-emerald-100 bg-emerald-500/10"
                            : "border-emerald-500/70 text-emerald-700 bg-emerald-50"
                          : isDark
                            ? "border-white/20 text-white hover:bg-white/10"
                            : "border-gray-200 text-gray-800 hover:bg-gray-100 bg-white"
                          }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (followed) {
                            unfollow(r.platform, r.id);
                          } else {
                            follow({
                              id: r.id,
                              platform: r.platform,
                              nickname: r.nickname,
                              avatarUrl:
                                r.platform === Platform.BILIBILI ? proxyBilibiliImage(r.avatarUrl) || "" : r.avatarUrl || "",
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
        </motion.div>
      )}
    </motion.div>
  );
}
