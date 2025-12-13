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
import { motion, AnimatePresence } from "framer-motion";
import { SearchPanel } from "@/components/search/search-panel";
import { Moon, Sun, PanelLeftOpen, PanelLeftClose, Heart } from "lucide-react";
import { DouyuHome } from "@/components/home/douyu-home";
import { HuyaHome } from "@/components/home/huya-home";
import { BilibiliHome } from "@/components/home/bilibili-home";
import { DouyinHome } from "@/components/home/douyin-home";
import { FollowList } from "@/components/follow-list";
import { HomeTopNav } from "@/components/home/top-nav";

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
  const theme = useThemeStore((s) => s.resolvedTheme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const initTheme = useThemeStore((s) => s.initTheme);

  const hydrateFollow = useFollowStore((s) => s.hydrateFromLegacy);
  const hydrateCategory = useCategoryStore((s) => s.hydrateFromLegacy);
  const isSidebarOpen = useSidebarStore((s) => s.isOpen);
  const toggleSidebar = useSidebarStore((s) => s.toggle);
  const setSidebarOpen = useSidebarStore((s) => s.setOpen);

  const [activePlatform, setActivePlatform] = useState<Platform | "ALL" | "FOLLOW">(initialPlatform);
  const [mounted, setMounted] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1024 : window.innerWidth
  );
  const isMobile = viewportWidth <= 768;

  const toggleLeaderboard = () => toggleSidebar();

  useEffect(() => {
    initTheme();
    hydrateFollow();
    hydrateCategory();
    const updateWidth = () => {
      if (typeof window === "undefined") return;
      const width = window.visualViewport?.width ?? window.innerWidth;
      setViewportWidth(width);
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    window.visualViewport?.addEventListener("resize", updateWidth);
    setMounted(true);
    return () => {
      window.removeEventListener("resize", updateWidth);
      window.visualViewport?.removeEventListener("resize", updateWidth);
    };
  }, [initTheme, hydrateFollow, hydrateCategory]);

  const contentGradient =
    theme === "dark"
      ? "bg-gradient-to-br from-[#0c101a] via-[#0d111c] to-[#0b0f18]"
      : "bg-gradient-to-br from-[#e9f1ff] via-[#f7faff] to-white";

  useEffect(() => {
    setActivePlatform(initialPlatform);
  }, [initialPlatform]);

  useEffect(() => {
    if (isMobile && isSidebarOpen) {
      setSidebarOpen(false);
    }
  }, [isMobile, isSidebarOpen, setSidebarOpen]);

  useEffect(() => {
    const handler = () => toggleTheme();
    window.addEventListener("toggle-theme", handler);
    return () => window.removeEventListener("toggle-theme", handler);
  }, [toggleTheme]);

  if (!mounted) {
    return null;
  }

  const sidebarWidthCollapsed = isMobile ? 0 : 80;
  const sidebarWidthExpanded = isMobile ? 220 : 240;

  return (
    <div
      className={`relative w-full h-screen overflow-hidden flex font-sans select-none transition-colors duration-300 ${
        theme === "dark" ? "bg-black text-white" : "bg-gray-100 text-black"
      }`}
    >
      {isMobile ? null : (
        <motion.div
          className="relative h-full flex-shrink-0"
          animate={{ width: isSidebarOpen ? sidebarWidthExpanded : sidebarWidthCollapsed }}
          initial={false}
          transition={{
            type: "spring",
            stiffness: 180,
            damping: isSidebarOpen ? 18 : 20,
          }}
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
      )}

      <div className="relative flex-1 h-full">
        <BackgroundFeed theme={theme} />

        <div className="relative z-20 h-full overflow-hidden flex flex-col pb-0 md:pb-0">
          <div className="pt-4 px-4 pb-0 hidden md:block">
            <HomeTopNav
              theme={theme}
              activePlatform={activePlatform}
              onPlatformChange={setActivePlatform}
              onToggleTheme={toggleTheme}
              showSearch
            />
          </div>

          <div className={`flex-1 overflow-hidden p-0 md:p-2 md:pb-0 space-y-0 ${contentGradient}`}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activePlatform}
                className="h-full"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                {activePlatform === Platform.DOUYU && <DouyuHome />}
                {activePlatform === Platform.HUYA && <HuyaHome />}
                {activePlatform === Platform.BILIBILI && <BilibiliHome />}
                {activePlatform === Platform.DOUYIN && <DouyinHome />}
                {activePlatform === "FOLLOW" && <FollowList theme={theme} />}
                {activePlatform === "ALL" && <DouyuHome />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {showInput && <InputArea theme={theme} />}
        <PlayerOverlay />
      </div>

      {isMobile ? (
        <div className="fixed bottom-0 left-0 right-0 z-40 pb-4 px-4">
          <div
            className={`mx-auto flex items-center gap-2 rounded-3xl border backdrop-blur-xl shadow-xl px-2 py-2 ${
              theme === "dark" ? "bg-white/5 border-white/10" : "bg-white/90 border-gray-200"
            }`}
          >
            {[Platform.DOUYU, Platform.HUYA, Platform.BILIBILI, Platform.DOUYIN, "FOLLOW" as const].map((p) => {
              const isActive = activePlatform === p;
              const label = p === "FOLLOW" ? "关注" : platformLabelMap[p as Platform];
              return (
                <button
                  key={p}
                  onClick={() => setActivePlatform(p as Platform | "FOLLOW")}
                  className={`flex-1 flex flex-col items-center gap-1 rounded-2xl px-2 py-2 transition-all ${
                    isActive
                      ? theme === "dark"
                        ? "bg-white/10 text-white shadow-[0_10px_30px_-16px_rgba(0,0,0,0.6)]"
                        : "bg-gray-100 text-gray-900 shadow-[0_10px_30px_-16px_rgba(0,0,0,0.4)]"
                      : theme === "dark"
                        ? "text-gray-400 hover:text-white/90"
                        : "text-gray-600 hover:text-gray-900"
                  }`}
                  title={label}
                >
                  <span
                    className={`w-6 h-6 rounded-full inline-flex items-center justify-center text-[11px] font-semibold ${
                      isActive
                        ? theme === "dark"
                          ? "bg-white text-gray-900"
                          : "bg-gray-900 text-white"
                        : theme === "dark"
                          ? "bg-white/10 text-white"
                          : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {label.slice(0, 1)}
                  </span>
                  <span className="text-[11px] font-semibold leading-tight">{label}</span>
                </button>
              );
            })}
            <button
              onClick={toggleTheme}
              className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2 transition-all ${
                theme === "dark"
                  ? "text-gray-300 hover:text-white/90"
                  : "text-gray-600 hover:text-gray-900"
              }`}
              title="切换主题"
            >
              {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              <span className="text-[11px] font-semibold leading-tight">主题</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
