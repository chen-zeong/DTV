"use client";

import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, m } from "framer-motion";

import styles from "./PlayerOverlayProvider.module.css";

const PlayerPage = dynamic(() => import("@/screens/PlayerPage").then((m) => m.PlayerPage), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 18, color: "var(--secondary-text)", fontWeight: 700 }}>
      加载播放器...
    </div>
  )
});

type PlayerOverlayOpenPayload = { platform: string; roomId: string };

type PlayerOverlayContextValue = {
  isOpen: boolean;
  platform: string;
  roomId: string;
  openPlayer: (payload: PlayerOverlayOpenPayload) => void;
  closePlayer: () => void;
};

const PlayerOverlayContext = React.createContext<PlayerOverlayContextValue | null>(null);

export function usePlayerOverlay() {
  const ctx = useContext(PlayerOverlayContext);
  if (!ctx) throw new Error("usePlayerOverlay must be used within PlayerOverlayProvider");
  return ctx;
}

export function PlayerOverlayHost() {
  const { isOpen, platform, roomId, closePlayer } = usePlayerOverlay();

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePlayer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePlayer, isOpen]);

  // NOTE:
  // - Avoid transforms while playing video (WebView2 may black-screen with transformed ancestors).
  // - Only apply the "drop" transform on exit, when the user is closing the player anyway.
  return (
    <AnimatePresence>
      {isOpen ? (
        <m.div
          className={styles.overlayRoot}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <button type="button" className={styles.backdrop} aria-label="关闭播放器" onClick={closePlayer} />
          <m.div
            className={styles.overlayPanel}
            initial={false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: 110, rotate: 0.6, scale: 0.985 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            <PlayerPage platform={platform} roomId={roomId} onRequestClose={closePlayer} />
          </m.div>
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}

export function PlayerOverlayProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ isOpen: boolean; platform: string; roomId: string }>({
    isOpen: false,
    platform: "douyu",
    roomId: ""
  });

  const openPlayer = useCallback((payload: PlayerOverlayOpenPayload) => {
    setState({ isOpen: true, platform: payload.platform, roomId: payload.roomId });
  }, []);

  const closePlayer = useCallback(() => {
    setState((s) => ({ ...s, isOpen: false }));
  }, []);

  const value = useMemo<PlayerOverlayContextValue>(
    () => ({
      isOpen: state.isOpen,
      platform: state.platform,
      roomId: state.roomId,
      openPlayer,
      closePlayer
    }),
    [closePlayer, openPlayer, state.isOpen, state.platform, state.roomId]
  );

  return <PlayerOverlayContext.Provider value={value}>{children}</PlayerOverlayContext.Provider>;
}
