import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * 播放页的"全局可见状态"。
 *
 * 旧项目的 PlayerUiProvider 里塞了 island / isFullscreen / danmuPanel 三块，
 * 其中 danmuPanel 是一整套死 API；island（顶栏主播信息）已按产品要求移除，
 * 主播信息只保留在播放器自己的顶栏里。
 *
 * 现在这里有两种"全屏"：
 *   - nativeFullscreen：DOM Fullscreen API / 系统级全屏，会盖住任务栏；
 *   - cssFullscreen：西瓜播放器 cssFullscreen 那种样式全屏 —— 播放器铺满
 *     应用窗口（侧栏/顶栏让位），操作系统窗口不变，任务栏照常可见。
 * 两者都会让外壳隐藏 chrome，所以再派生出 isFullscreen 给布局用。
 */

interface PlayerUiContextValue {
  /** 原生全屏（DOM Fullscreen API / Wails 窗口全屏） */
  nativeFullscreen: boolean;
  setNativeFullscreen: (v: boolean) => void;
  /** 样式全屏（铺满应用窗口，任务栏可见） */
  cssFullscreen: boolean;
  setCssFullscreen: (v: boolean) => void;
  /** 任一全屏 —— 侧栏/顶栏让位、弹幕面板隐藏 */
  isFullscreen: boolean;
}

const PlayerUiContext = createContext<PlayerUiContextValue | null>(null);

export function PlayerUiProvider({ children }: { children: ReactNode }) {
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [cssFullscreen, setCssFullscreen] = useState(false);

  const value = useMemo<PlayerUiContextValue>(
    () => ({
      nativeFullscreen,
      setNativeFullscreen,
      cssFullscreen,
      setCssFullscreen,
      isFullscreen: nativeFullscreen || cssFullscreen,
    }),
    [cssFullscreen, nativeFullscreen],
  );

  return <PlayerUiContext.Provider value={value}>{children}</PlayerUiContext.Provider>;
}

export function usePlayerUi(): PlayerUiContextValue {
  const ctx = useContext(PlayerUiContext);
  if (!ctx) throw new Error("usePlayerUi 必须在 PlayerUiProvider 内使用");
  return ctx;
}
