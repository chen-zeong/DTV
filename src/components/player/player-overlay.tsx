"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PlayerView } from "@/components/player/player-view";
import { usePlayerOverlayStore } from "@/stores/player-overlay-store";
import { Sidebar } from "@/components/sidebar";
import { useThemeStore } from "@/stores/theme-store";
import { useSidebarStore } from "@/stores/sidebar-store";

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

  useEffect(() => {
    const update = () => {
      if (typeof window === "undefined") return;
      const width = window.visualViewport?.width ?? window.innerWidth;
      setViewportWidth(width);
    };
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  return (
    <AnimatePresence>
      {canRender ? (
        <motion.div
          className="fixed inset-0 z-[130] bg-gradient-to-br from-black via-zinc-950 to-gray-900 text-white"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
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
              className="flex-1 h-full overflow-auto p-0 md:p-5"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              <PlayerView
                platform={platform}
                roomId={roomId}
                onClose={close}
                initialTitle={title || undefined}
                initialAnchorName={anchorName || undefined}
                initialAvatar={avatar || undefined}
              />
            </motion.div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
