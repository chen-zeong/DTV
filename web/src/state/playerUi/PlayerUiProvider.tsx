"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

import { Platform } from "@/platforms/common/types";

export type PlayerIslandState = {
  visible: boolean;
  platform: Platform | null;
  roomId: string | null;
  anchorName: string | null;
  title: string | null;
  avatarUrl: string | null;
};

type PlayerUiContextValue = {
  island: PlayerIslandState;
  setIsland: (next: Partial<PlayerIslandState>) => void;
  clearIsland: () => void;
  isFullscreen: boolean;
  setFullscreen: (next: boolean) => void;
  registerDanmuPanelSetter: (setter: ((visible: boolean) => void) | null) => void;
  requestShowDanmuPanel: () => void;
};

const PlayerUiContext = createContext<PlayerUiContextValue | null>(null);

const emptyIsland: PlayerIslandState = {
  visible: false,
  platform: null,
  roomId: null,
  anchorName: null,
  title: null,
  avatarUrl: null
};

export function PlayerUiProvider({ children }: { children: React.ReactNode }) {
  const [island, setIslandState] = useState<PlayerIslandState>(emptyIsland);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const danmuSetterRef = useRef<((visible: boolean) => void) | null>(null);

  const setIsland = useCallback((next: Partial<PlayerIslandState>) => {
    setIslandState((prev) => ({ ...prev, ...next, visible: true }));
  }, []);

  const clearIsland = useCallback(() => {
    setIslandState(emptyIsland);
  }, []);

  const registerDanmuPanelSetter = useCallback((setter: ((visible: boolean) => void) | null) => {
    danmuSetterRef.current = setter;
  }, []);

  const requestShowDanmuPanel = useCallback(() => {
    danmuSetterRef.current?.(true);
  }, []);

  const value = useMemo<PlayerUiContextValue>(() => {
    return {
      island,
      setIsland,
      clearIsland,
      isFullscreen,
      setFullscreen: setIsFullscreen,
      registerDanmuPanelSetter,
      requestShowDanmuPanel
    };
  }, [clearIsland, island, isFullscreen, registerDanmuPanelSetter, requestShowDanmuPanel, setIsland]);

  return <PlayerUiContext.Provider value={value}>{children}</PlayerUiContext.Provider>;
}

export function usePlayerUi() {
  const ctx = useContext(PlayerUiContext);
  if (!ctx) throw new Error("usePlayerUi must be used within PlayerUiProvider");
  return ctx;
}
