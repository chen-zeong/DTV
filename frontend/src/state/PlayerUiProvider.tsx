import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { LivePlatform } from "@/api";

/**
 * 播放页的"全局可见状态"。
 *
 * 旧项目的 PlayerUiProvider 里塞了 island / isFullscreen / danmuPanel 三块，
 * 其中 danmuPanel 是一整套死 API（registerDanmuPanelSetter 从未被调用，
 * "展开弹幕"按钮永远 disabled）。这里只保留真正有用的两件事：
 *  - island：播放中显示在 Navbar 上的主播信息
 *  - fullscreen：全屏时隐藏 Sidebar / Navbar
 */

export interface PlayerIsland {
  platform: LivePlatform;
  roomId: string;
  nickname: string;
  title: string;
  avatar: string;
  isLive: boolean;
}

interface PlayerUiContextValue {
  island: PlayerIsland | null;
  setIsland: (island: PlayerIsland | null) => void;
  isFullscreen: boolean;
  setFullscreen: (v: boolean) => void;
}

const PlayerUiContext = createContext<PlayerUiContextValue | null>(null);

export function PlayerUiProvider({ children }: { children: ReactNode }) {
  const [island, setIsland] = useState<PlayerIsland | null>(null);
  const [isFullscreen, setFullscreen] = useState(false);

  const value = useMemo<PlayerUiContextValue>(
    () => ({ island, setIsland, isFullscreen, setFullscreen }),
    [island, isFullscreen],
  );

  return <PlayerUiContext.Provider value={value}>{children}</PlayerUiContext.Provider>;
}

export function usePlayerUi(): PlayerUiContextValue {
  const ctx = useContext(PlayerUiContext);
  if (!ctx) throw new Error("usePlayerUi 必须在 PlayerUiProvider 内使用");
  return ctx;
}
