"use client";

import { ReactNode, useEffect, useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { Leaderboard } from "@/components/leaderboard";
import { BackgroundFeed } from "@/components/background-feed";
import { InputArea } from "@/components/input-area";
import { SearchPanel } from "@/components/search/search-panel";
import { useThemeStore } from "@/stores/theme-store";
import { useFollowStore } from "@/stores/follow-store";
import { useCategoryStore } from "@/stores/category-store";
import { Platform } from "@/types/platform";
import { platformSlugMap } from "@/utils/platform";
import { usePathname, useRouter } from "next/navigation";

type HomeShellProps = {
  initialPlatform?: Platform | "ALL";
  initialLeaderboardOpen?: boolean;
  showInput?: boolean;
  children?: ReactNode;
};

export function HomeShell({ initialPlatform = "ALL", initialLeaderboardOpen = true, showInput = true, children }: HomeShellProps) {
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
        activePlatform={activePlatform}
        onSelectPlatform={(p) => {
          setActivePlatform(p);
          const path = p === "ALL" ? "/" : `/${platformSlugMap[p]}`;
          if (pathname !== path) {
            router.push(path);
          }
        }}
      />

      <div className="relative flex-1 h-full">
        <BackgroundFeed />

        <div
          className={`absolute top-0 left-0 bottom-0 z-30 transition-transform duration-500 ease-in-out ${
            isLeaderboardOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Leaderboard theme={theme} onClose={() => setIsLeaderboardOpen(false)} filterPlatform={activePlatform} />
        </div>

        <div className="relative z-20 h-full overflow-hidden">
          {children ? (
            <div className="h-full overflow-auto p-4 md:p-8 space-y-4">
              <SearchPanel />
              {children}
            </div>
          ) : null}
        </div>

        {showInput && <InputArea theme={theme} />}
      </div>
    </div>
  );
}
