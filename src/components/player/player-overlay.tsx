"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PlayerView } from "@/components/player/player-view";
import { usePlayerOverlayStore } from "@/stores/player-overlay-store";
import { Sidebar } from "@/components/sidebar";
import { useThemeStore } from "@/stores/theme-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { HomeTopNav } from "@/components/home/top-nav";
import { Platform } from "@/types/platform";

export function PlayerOverlay() {
  const { isOpen, platform, roomId, title, anchorName, avatar, close } = usePlayerOverlayStore();
  const theme = useThemeStore((s) => s.getEffectiveTheme());
  const isSidebarOpen = useSidebarStore((s) => s.isOpen);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 1024 : window.innerWidth));
  const isMobile = viewportWidth <= 768;
  const sidebarWidthCollapsed = 80;
  const sidebarWidthExpanded = 240;
  const slideTransition = {
    type: "spring",
    stiffness: 180,
    damping: isSidebarOpen ? 18 : 20,
  };

  const canRender = isOpen && platform && roomId;
  const [isFullscreen, setIsFullscreen] = useState(false);

  const navHidden = isFullscreen;

  useEffect(() => {
    const update = () => {
      if (typeof window === "undefined") return;
      const width = window.visualViewport?.width ?? window.innerWidth;
      setViewportWidth(width);
    };
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    const handleToggleTheme = () => useThemeStore.getState().toggleTheme();
    window.addEventListener("toggle-theme", handleToggleTheme);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.removeEventListener("toggle-theme", handleToggleTheme);
    };
  }, []);

  return (
    <AnimatePresence>
      {canRender ? (
        <motion.div
          className={`fixed inset-0 z-[130] ${
            theme === "dark"
              ? "bg-gradient-to-br from-black via-zinc-950 to-gray-900 text-white"
              : "bg-gradient-to-br from-[#e9f1ff] via-white to-[#f3f6fb] text-gray-900"
          }`}
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 1 }}
          transition={{ duration: 0 }}
        >
          <div className="relative w-full h-full flex">
            {!isMobile && (
              <motion.div
                className="h-full"
                animate={{ width: isSidebarOpen ? sidebarWidthExpanded : sidebarWidthCollapsed }}
                initial={false}
                transition={slideTransition}
                layout
              >
                <Sidebar className="h-full" theme={theme} isLeaderboardOpen={isSidebarOpen} />
              </motion.div>
            )}

            <motion.div
              className="flex-1 h-full overflow-hidden flex flex-col"
              initial={false}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            >
              {!navHidden && (
                <div className="pt-4 px-4 pb-0 hidden md:block">
                  <HomeTopNav
                    theme={theme}
                    activePlatform={platform ?? Platform.DOUYU}
                    onPlatformChange={() => {}}
                    showSearch
                  />
                </div>
              )}
              <div className="flex-1 min-h-0 overflow-hidden p-0 md:p-4">
                <PlayerView
                  platform={platform}
                  roomId={roomId}
                  onClose={close}
                  initialTitle={title || undefined}
                  initialAnchorName={anchorName || undefined}
                  initialAvatar={avatar || undefined}
                  theme={theme}
                  onFullscreenChange={setIsFullscreen}
                />
              </div>
            </motion.div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
