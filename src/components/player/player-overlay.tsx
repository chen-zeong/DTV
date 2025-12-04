"use client";

import { AnimatePresence, motion } from "framer-motion";
import { PlayerView } from "@/components/player/player-view";
import { usePlayerOverlayStore } from "@/stores/player-overlay-store";

export function PlayerOverlay() {
  const { isOpen, platform, roomId, title, anchorName, avatar, close } = usePlayerOverlayStore();

  const canRender = isOpen && platform && roomId;

  return (
    <AnimatePresence>
      {canRender ? (
        <motion.div
          className="fixed inset-0 z-[130] pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="pointer-events-auto absolute right-4 top-6 w-full max-w-6xl max-h-[88vh] bg-black/70 border border-white/10 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-xl"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
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
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
