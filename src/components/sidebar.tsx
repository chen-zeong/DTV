"use client";

import { useMemo } from "react";
import { Moon, PanelLeftClose, PanelLeftOpen, Sun, Github } from "lucide-react";
import { motion } from "framer-motion";
import { ThemeMode } from "@/types/follow-list";
import { openLink } from "@/lib/tauri";
import { useFollowStore } from "@/stores/follow-store";

type SidebarProps = {
  className?: string;
  theme: ThemeMode;
  toggleTheme: () => void;
  isLeaderboardOpen: boolean;
  toggleLeaderboard: () => void;
};

export function Sidebar({
  className,
  theme,
  toggleTheme,
  isLeaderboardOpen,
  toggleLeaderboard,
}: SidebarProps) {
  const isDark = theme === "dark";
  const followedStreamers = useFollowStore((s) => s.followedStreamers);
  const listOrder = useFollowStore((s) => s.listOrder);

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

  const containerClass = isDark
    ? "bg-gradient-to-b from-[#0b0c12] via-[#0f111a] to-[#0b0c12] border-gray-800/70"
    : "bg-gradient-to-b from-white via-[#f4f7ff] to-white border-gray-200 shadow-xl";

  const iconClass = `w-6 h-6 transition-all cursor-pointer ${isDark ? "opacity-70 hover:opacity-100" : "opacity-80 hover:opacity-100"}`;

  return (
    <div
      className={`flex flex-col items-center justify-between py-5 w-[80px] h-full border-r z-50 transition-colors duration-300 ${containerClass} ${className}`}
    >
      <div className="flex flex-col items-center gap-4">
        {!isLeaderboardOpen && orderedFollows.length > 0 ? (
          <div className="flex flex-col items-center gap-2 mt-1">
            {orderedFollows.slice(0, 8).map((s) => (
              <div
                key={`${s.platform}:${s.id}`}
                className={`w-10 h-10 rounded-full overflow-hidden border shadow-sm ${
                  isDark ? "border-white/10" : "border-gray-200"
                }`}
                title={s.nickname || s.displayName || s.id}
              >
                {s.avatarUrl ? (
                  <img src={s.avatarUrl} alt={s.nickname || s.displayName || s.id} className="w-full h-full object-cover" />
                ) : (
                  <div
                    className={`w-full h-full flex items-center justify-center text-xs ${
                      isDark ? "text-gray-300 bg-white/10" : "text-gray-600 bg-gray-100"
                    }`}
                  >
                    {(s.nickname || s.displayName || s.id).slice(0, 1)}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col items-center gap-4 pb-2">
        <a
          href="https://github.com/chen-zeong/DTV"
          target="_blank"
          rel="noreferrer"
          onClick={() => {
            // 尝试调用 Tauri / 插件打开，同时保留默认跳转
            void openLink("https://github.com/chen-zeong/DTV");
          }}
          title="打开 GitHub"
          className={`p-2 rounded-2xl border transition-colors ${isDark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"}`}
        >
          <Github className={iconClass} />
        </a>
        <button
          onClick={toggleLeaderboard}
          title="展开/收起关注列表"
          className={`p-2 rounded-2xl border transition-colors ${isDark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"}`}
        >
          {isLeaderboardOpen ? <PanelLeftClose className={iconClass} /> : <PanelLeftOpen className={iconClass} />}
        </button>

        <button
          onClick={toggleTheme}
          title="切换主题"
          className={`p-2 rounded-2xl border transition-colors ${isDark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"}`}
        >
          {isDark ? <Sun className={iconClass} /> : <Moon className={iconClass} />}
        </button>
      </div>
    </div>
  );
}
