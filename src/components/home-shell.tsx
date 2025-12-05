"use client";

import { ReactNode, useEffect, useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { FollowList } from "@/components/follow-list";
import { BackgroundFeed } from "@/components/background-feed";
import { InputArea } from "@/components/input-area";
import { useThemeStore } from "@/stores/theme-store";
import { useFollowStore } from "@/stores/follow-store";
import { useCategoryStore } from "@/stores/category-store";
import { Platform } from "@/types/platform";
import { platformLabelMap, platformSlugMap } from "@/utils/platform";
import { usePathname, useRouter } from "next/navigation";
import { PlayerOverlay } from "@/components/player/player-overlay";

type HomeShellProps = {
  initialPlatform?: Platform | "ALL";
  initialLeaderboardOpen?: boolean;
  showInput?: boolean;
  children?: ReactNode;
};

export function HomeShell({
  initialPlatform = "ALL",
  initialLeaderboardOpen = true,
  showInput = true,
  children,
}: HomeShellProps) {
  const theme = useThemeStore((s) => s.getEffectiveTheme());
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const initTheme = useThemeStore((s) => s.initTheme);

  const hydrateFollow = useFollowStore((s) => s.hydrateFromLegacy);
  const hydrateCategory = useCategoryStore((s) => s.hydrateFromLegacy);

  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(initialLeaderboardOpen);
  const [activePlatform, setActivePlatform] = useState<Platform | "ALL">(initialPlatform);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const toggleLeaderboard = () => setIsLeaderboardOpen((prev) => !prev);

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

  // Keep activePlatform in sync with current path
  useEffect(() => {
    if (pathname?.startsWith("/douyu")) setActivePlatform(Platform.DOUYU);
    else if (pathname?.startsWith("/huya")) setActivePlatform(Platform.HUYA);
    else if (pathname?.startsWith("/bilibili")) setActivePlatform(Platform.BILIBILI);
    else if (pathname?.startsWith("/douyin")) setActivePlatform(Platform.DOUYIN);
    else setActivePlatform("ALL");
  }, [pathname]);

  useEffect(() => {
    setActivePlatform(initialPlatform);
  }, [initialPlatform]);

  if (!mounted) {
    return null;
  }

  return (
    <div
      className={`relative w-full h-screen overflow-hidden flex font-sans select-none transition-colors duration-300 ${
        theme === "dark" ? "bg-black text-white" : "bg-gray-100 text-black"
      }`}
    >
      <Sidebar
        className="flex-shrink-0 relative z-50"
        theme={theme}
        toggleTheme={toggleTheme}
        isLeaderboardOpen={isLeaderboardOpen}
        toggleLeaderboard={toggleLeaderboard}
      />

      <div className="relative flex-1 h-full">
        <BackgroundFeed theme={theme} />

        <div
          className={`absolute top-0 left-0 bottom-0 z-30 transition-transform duration-500 ease-in-out ${
            isLeaderboardOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <FollowList
            theme={theme}
            searchPlatform={activePlatform === "ALL" ? Platform.DOUYU : activePlatform}
          />
        </div>

        <div className="relative z-20 h-full overflow-hidden flex flex-col">
          <div className="flex justify-center pt-4 pb-2">
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
                      const path = `/${platformSlugMap[p]}`;
                      if (pathname !== path) {
                        router.push(path);
                      }
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

          {children ? <div className={`flex-1 overflow-hidden p-2 md:p-4 space-y-3 ${contentGradient}`}>{children}</div> : null}
        </div>

        {showInput && <InputArea theme={theme} />}
        <PlayerOverlay />
      </div>
    </div>
  );
}
