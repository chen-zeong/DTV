"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { BackgroundFeed } from "@/components/background-feed";
import { InputArea } from "@/components/input-area";
import { useThemeStore } from "@/stores/theme-store";
import { useFollowStore } from "@/stores/follow-store";
import { useCategoryStore } from "@/stores/category-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { Platform } from "@/types/platform";
import { platformLabelMap } from "@/utils/platform";
import { PlayerOverlay } from "@/components/player/player-overlay";
import { motion } from "framer-motion";
import { SearchPanel } from "@/components/search/search-panel";
import { Github, Moon, Sun, PanelLeftOpen, PanelLeftClose } from "lucide-react";
import { openLink } from "@/lib/tauri";
import { DouyuHome } from "@/components/home/douyu-home";
import { HuyaHome } from "@/components/home/huya-home";
import { BilibiliHome } from "@/components/home/bilibili-home";
import { DouyinHome } from "@/components/home/douyin-home";

type HomeShellProps = {
  initialPlatform?: Platform | "ALL";
  initialLeaderboardOpen?: boolean;
  showInput?: boolean;
};

export function HomeShell({
  initialPlatform = "ALL",
  initialLeaderboardOpen = true,
  showInput = true,
}: HomeShellProps) {
  const theme = useThemeStore((s) => s.getEffectiveTheme());
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const initTheme = useThemeStore((s) => s.initTheme);

  const hydrateFollow = useFollowStore((s) => s.hydrateFromLegacy);
  const hydrateCategory = useCategoryStore((s) => s.hydrateFromLegacy);
  const isSidebarOpen = useSidebarStore((s) => s.isOpen);
  const toggleSidebar = useSidebarStore((s) => s.toggle);
  const setSidebarOpen = useSidebarStore((s) => s.setOpen);

  const [activePlatform, setActivePlatform] = useState<Platform | "ALL">(initialPlatform);
  const [mounted, setMounted] = useState(false);

  const toggleLeaderboard = () => toggleSidebar();

  useEffect(() => {
    initTheme();
    hydrateFollow();
    hydrateCategory();
    setMounted(true);
  }, [initTheme, hydrateFollow, hydrateCategory]);

  const contentGradient =
    theme === "dark"
      ? "bg-gradient-to-br from-[#0c101a] via-[#0d111c] to-[#0b0f18]"
      : "bg-gradient-to-br from-[#e9f1ff] via-[#f7faff] to-white";

  useEffect(() => {
    setActivePlatform(initialPlatform);
    setSidebarOpen(initialLeaderboardOpen);
  }, [initialPlatform, initialLeaderboardOpen, setSidebarOpen]);

  if (!mounted) {
    return null;
  }

  const sidebarWidthCollapsed = 80;
  const sidebarWidthExpanded = 240;
  const slideTransition = {
    type: "spring",
    stiffness: 180,
    damping: isSidebarOpen ? 18 : 20,
  };

  return (
    <div
      className={`relative w-full h-screen overflow-hidden flex font-sans select-none transition-colors duration-300 ${
        theme === "dark" ? "bg-black text-white" : "bg-gray-100 text-black"
      }`}
    >
      <motion.div
        className="relative h-full flex-shrink-0"
        animate={{ width: isSidebarOpen ? sidebarWidthExpanded : sidebarWidthCollapsed }}
        initial={false}
        transition={slideTransition}
        layout
      >
        <div className="absolute inset-0 flex overflow-hidden">
          <Sidebar
            className="flex-shrink-0 relative z-50"
            theme={theme}
            isLeaderboardOpen={isSidebarOpen}
          />

        </div>
      </motion.div>

      <div className="relative flex-1 h-full">
        <BackgroundFeed theme={theme} />

        <div className="relative z-20 h-full overflow-hidden flex flex-col">
          <div className="pt-4 pb-2 px-4">
            <div className="grid w-full grid-cols-[auto,1fr,auto] items-center gap-3">
              <div className="flex items-center">
                <button
                  onClick={toggleLeaderboard}
                  className={`p-2 rounded-full border transition-colors ${
                    theme === "dark" ? "border-white/10 bg-white/10 hover:bg-white/15" : "border-gray-200 bg-white hover:bg-gray-100"
                  }`}
                  title="展开/收起关注列表"
                >
                  {isSidebarOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
                </button>
              </div>

              <div className="flex justify-center">
                <div
                  className={`flex items-center gap-2 rounded-full border px-2.5 py-1.5 shadow-lg backdrop-blur-xl ${
                    theme === "dark"
                      ? "bg-white/10 border-white/10 shadow-black/40"
                      : "bg-white border-gray-200 shadow-gray-300/60"
                  }`}
                >
                  {[Platform.DOUYU, Platform.HUYA, Platform.BILIBILI, Platform.DOUYIN].map((p) => {
                    const isActive = activePlatform === p;
                    const label = platformLabelMap[p];
                    return (
                      <button
                        key={p}
                        onClick={() => {
                          setActivePlatform(p);
                        }}
                        className={`px-3 py-1.5 text-sm font-semibold rounded-full transition-all ${
                          isActive
                            ? theme === "dark"
                              ? "bg-white text-gray-900 shadow-[0_10px_30px_-12px_rgba(255,255,255,0.8)]"
                              : "bg-gray-900 text-white shadow-[0_10px_30px_-12px_rgba(0,0,0,0.35)]"
                            : theme === "dark"
                              ? "text-gray-200 hover:text-white hover:bg-white/10"
                              : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <SearchPanel platform={activePlatform === "ALL" ? Platform.DOUYU : activePlatform} />
                <a
                  href="https://github.com/chen-zeong/DTV"
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => void openLink("https://github.com/chen-zeong/DTV")}
                  className={`p-2 rounded-full border transition-colors ${
                    theme === "dark"
                      ? "border-white/10 bg-white/10 hover:bg-white/15"
                      : "border-gray-200 bg-white hover:bg-gray-100"
                  }`}
                  title="打开 GitHub"
                >
                  <Github className="w-5 h-5" />
                </a>
                <button
                  onClick={toggleTheme}
                  className={`p-2 rounded-full border transition-colors ${
                    theme === "dark"
                      ? "border-white/10 bg-white/10 hover:bg-white/15"
                      : "border-gray-200 bg-white hover:bg-gray-100"
                  }`}
                  title="切换主题"
                >
                  {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>

          <div className={`flex-1 overflow-hidden p-2 md:p-4 space-y-3 ${contentGradient}`}>
            {activePlatform === Platform.DOUYU && <DouyuHome />}
            {activePlatform === Platform.HUYA && <HuyaHome />}
            {activePlatform === Platform.BILIBILI && <BilibiliHome />}
            {activePlatform === Platform.DOUYIN && <DouyinHome />}
            {activePlatform === "ALL" && <DouyuHome />}
          </div>
        </div>

        {showInput && <InputArea theme={theme} />}
        <PlayerOverlay />
      </div>
    </div>
  );
}
