"use client";

import { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { ThemeMode } from "@/types/follow-list";
import { useFollowStore } from "@/stores/follow-store";
import { usePlayerOverlayStore } from "@/stores/player-overlay-store";
import { platformLabelMap } from "@/utils/platform";

type SidebarProps = {
  className?: string;
  theme: ThemeMode;
  isLeaderboardOpen: boolean;
};

export function Sidebar({ className, theme, isLeaderboardOpen }: SidebarProps) {
  const isDark = theme === "dark";
  const followedStreamers = useFollowStore((s) => s.followedStreamers);
  const listOrder = useFollowStore((s) => s.listOrder);
  const folders = useFollowStore((s) => s.folders);
  const hydrate = useFollowStore((s) => s.hydrateFromLegacy);
  const openPlayer = usePlayerOverlayStore((s) => s.open);
  const toKey = (platform: string, id: string) => `${String(platform).toUpperCase()}:${id}`;

  const orderedFollows = useMemo(() => {
    const map = new Map<string, (typeof followedStreamers)[number]>();
    followedStreamers.forEach((s) => map.set(`${s.platform}:${s.id}`, s));
    const ordered = listOrder
      .filter((item): item is Extract<typeof listOrder[number], { type: "streamer" }> => item.type === "streamer")
      .map((item) => map.get(`${item.data.platform}:${item.data.id}`))
      .filter((s): s is (typeof followedStreamers)[number] => Boolean(s));
    if (ordered.length) return ordered;
    return followedStreamers;
  }, [followedStreamers, listOrder]);

  const collapsedItems = useMemo(() => {
    if (listOrder.length) return listOrder;
    return orderedFollows.map((s) => ({ type: "streamer", data: s })) as typeof listOrder;
  }, [listOrder, orderedFollows]);

  const containerClass = isDark
    ? "bg-slate-900/80 border-white/10 text-white shadow-2xl"
    : "bg-white/70 border-white/40 text-slate-800 shadow-xl";

  const statusDot = (live?: boolean) => (
    <span
      className={`absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full border ${
        isDark ? "border-slate-900" : "border-white"
      } ${live ? "bg-emerald-400" : "bg-gray-500/70"}`}
    />
  );

  return (
    <aside
      className={`flex flex-col items-center py-4 w-full max-w-[240px] h-full border-r backdrop-blur-xl transition-all duration-300 overflow-y-auto no-scrollbar ${containerClass} ${className}`}
    >
      <div className="w-full flex flex-col items-center gap-5">
        <button
          onClick={() => hydrate()}
          className={`w-11 h-11 inline-flex items-center justify-center rounded-2xl border transition-colors ${
            isDark ? "border-white/10 bg-white/5 hover:bg-white/10" : "border-gray-200 bg-white hover:bg-gray-100"
          }`}
          title="刷新关注列表"
        >
          <RefreshCw className={`w-5 h-5 ${isDark ? "text-white" : "text-gray-900"}`} />
        </button>

        {!isLeaderboardOpen && (orderedFollows.length > 0 || folders.length > 0) ? (
          <div className="flex flex-col items-center gap-3 mt-1 w-full px-2">
            {collapsedItems.map((item) => {
              if (item.type === "streamer") {
                const s = orderedFollows.find((f) => f.platform === item.data.platform && f.id === item.data.id);
                if (!s) return null;
                return (
                  <button
                    key={`${s.platform}:${s.id}`}
                    type="button"
                    onClick={() =>
                      openPlayer({
                        platform: s.platform,
                        roomId: s.id,
                        title: s.roomTitle,
                        anchorName: s.nickname,
                        avatar: s.avatarUrl,
                      })
                    }
                    className={`relative w-10 h-10 rounded-full border shadow-sm transition-all duration-200 ${
                      isDark
                        ? "border-white/10 hover:border-white/25 hover:scale-105"
                        : "border-gray-200 hover:border-gray-300 hover:scale-105"
                    }`}
                    title={s.nickname || s.displayName || s.id}
                  >
                    {s.avatarUrl ? (
                      <img
                        src={s.avatarUrl}
                        alt={s.nickname || s.displayName || s.id}
                        className="w-full h-full rounded-full object-cover"
                      />
                    ) : (
                      <div
                        className={`w-full h-full rounded-full flex items-center justify-center text-xs ${
                          isDark ? "text-gray-300 bg-white/10" : "text-gray-600 bg-gray-100"
                        }`}
                      >
                        {(s.nickname || s.displayName || s.id).slice(0, 1)}
                      </div>
                    )}
                    {statusDot(s.isLive)}
                  </button>
                );
              }
              const folder = folders.find((f) => f.id === item.data.id);
              if (!folder) return null;
              const label = (folder.name || "F").slice(0, 1);
              return (
                <div
                  key={`folder-${folder.id}`}
                  className={`px-3.5 h-12 rounded-2xl border shadow-sm flex items-center justify-center text-sm font-semibold uppercase transition-all duration-200 ${
                    isDark
                      ? "border-white/10 bg-white/10 text-white hover:border-white/25"
                      : "border-gray-200 bg-gray-50 text-gray-800 hover:border-gray-300"
                  }`}
                  title={folder.name}
                >
                  {label}
                </div>
              );
              })}
            </div>
          ) : null}
        </div>

      {isLeaderboardOpen ? (
        <div className="flex-1 w-full overflow-y-auto no-scrollbar py-4 px-3 space-y-3">
          {listOrder.length === 0 && orderedFollows.length === 0 ? (
            <div className="text-xs text-center text-gray-400">暂无关注主播</div>
          ) : (
            (listOrder.length ? listOrder : orderedFollows.map((s) => ({ type: "streamer" as const, data: s }))).map((item) => {
              if (item.type === "folder") {
                const folder = folders.find((f) => f.id === item.data.id);
                if (!folder) return null;
                const items = (folder.streamerIds || [])
                  .map((id) => followedStreamers.find((s) => toKey(s.platform, s.id) === id))
                  .filter(Boolean);
                return (
                  <div key={`folder-${folder.id}`} className="space-y-2">
                      <div
                        className={`flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-sm font-semibold ${
                          isDark ? "bg-white/5 text-white" : "bg-black/5 text-slate-800"
                        }`}
                      >
                      <span className="truncate">{folder.name}</span>
                      <span className="text-xs opacity-70">{items.length}</span>
                    </div>
                    <div className="space-y-1.5">
                      {items.map((s) => (
                        <button
                          key={`${s!.platform}:${s!.id}`}
                          onClick={() =>
                            openPlayer({
                              platform: s!.platform,
                              roomId: s!.id,
                              title: s!.roomTitle,
                              anchorName: s!.nickname,
                              avatar: s!.avatarUrl,
                            })
                          }
                          className={`group w-full flex items-center gap-3 p-2 rounded-xl transition-all ${
                            isDark ? "hover:bg-white/10" : "hover:bg-black/5"
                          }`}
                        >
                          <div className="relative flex-shrink-0">
                            {s!.avatarUrl ? (
                              <img
                                src={s!.avatarUrl}
                                alt={s!.nickname || s!.displayName || s!.id}
                                className="w-10 h-10 rounded-full object-cover border border-white/10"
                              />
                            ) : (
                              <div
                                className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold ${
                                  isDark ? "bg-white/10 text-white" : "bg-black/5 text-slate-800"
                                }`}
                              >
                                {(s!.nickname || s!.displayName || s!.id).slice(0, 1)}
                              </div>
                            )}
                            {statusDot(s!.isLive)}
                          </div>
                          <div className="flex flex-col min-w-0 text-left">
                            <span className="text-sm font-semibold truncate">{s!.nickname || s!.displayName}</span>
                            <span className="text-xs text-gray-400 truncate">
                              {s!.roomTitle || s!.displayName || platformLabelMap[s!.platform]}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }
              const s = orderedFollows.find((f) => f.platform === item.data.platform && f.id === item.data.id);
              if (!s) return null;
              return (
                <button
                  key={`${s.platform}:${s.id}`}
                  onClick={() =>
                    openPlayer({
                      platform: s.platform,
                      roomId: s.id,
                      title: s.roomTitle,
                      anchorName: s.nickname,
                      avatar: s.avatarUrl,
                    })
                  }
                  className={`group w-full flex items-center gap-3 p-2 rounded-xl transition-all ${
                    isDark ? "hover:bg-white/10" : "hover:bg-black/5"
                  }`}
                >
                  <div className="relative flex-shrink-0">
                    {s.avatarUrl ? (
                      <img
                        src={s.avatarUrl}
                        alt={s.nickname || s.displayName || s.id}
                        className="w-10 h-10 rounded-full object-cover border border-white/10"
                      />
                    ) : (
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold ${
                          isDark ? "bg-white/10 text-white" : "bg-black/5 text-slate-800"
                        }`}
                      >
                        {(s.nickname || s.displayName || s.id).slice(0, 1)}
                      </div>
                    )}
                    {statusDot(s.isLive)}
                  </div>
                  <div className="flex flex-col min-w-0 text-left">
                    <span className="text-sm font-semibold truncate">{s.nickname || s.displayName}</span>
                    <span className="text-xs text-gray-400 truncate">
                      {s.roomTitle || s.displayName || platformLabelMap[s.platform]}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </aside>
  );
}
