import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { LivePlatform } from "@/api";
import { platformHomePath } from "@/lib/navigation";
import { exitWindowFullscreen, isWindowFullscreen, onWindowFullscreenChange } from "@/lib/window";
import { usePlayerUi } from "@/state/PlayerUiProvider";
import type { UseXgPlayerResult } from "./useXgPlayer";

const CHROME_IDLE_MS = 2800;

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    el.isContentEditable ||
    el.getAttribute("role") === "textbox"
  );
}

function hasOpenOverlay(): boolean {
  return Boolean(
    document.querySelector('[role="dialog"], [role="menu"], [class*="menuBackdrop"]'),
  );
}

/**
 * 播放页全屏状态同步、悬浮栏自动隐藏与全局快捷键。
 */
export function usePlayerFullscreen(
  platform: LivePlatform,
  stageRef: RefObject<HTMLDivElement | null>,
  player: UseXgPlayerResult,
) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    nativeFullscreen,
    cssFullscreen,
    setNativeFullscreen,
    setCssFullscreen,
    isFullscreen,
  } = usePlayerUi();

  const lastFullscreenExitRef = useRef(0);
  const wasFullscreenRef = useRef(false);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [chromeHover, setChromeHover] = useState(false);
  const chromeIdleTimer = useRef<number | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  /* 全屏下鼠标静止自动隐藏悬浮 chrome */
  useEffect(() => {
    const clearTimer = () => {
      if (chromeIdleTimer.current != null) {
        window.clearTimeout(chromeIdleTimer.current);
        chromeIdleTimer.current = null;
      }
    };
    if (!isFullscreen) {
      clearTimer();
      setChromeHidden(false);
      return clearTimer;
    }
    if (chromeHover) {
      clearTimer();
      setChromeHidden(false);
      return clearTimer;
    }
    const arm = () => {
      clearTimer();
      chromeIdleTimer.current = window.setTimeout(() => {
        chromeIdleTimer.current = null;
        setChromeHidden(true);
      }, CHROME_IDLE_MS);
    };
    const onMove = () => {
      setChromeHidden(false);
      arm();
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    arm();
    return () => {
      window.removeEventListener("mousemove", onMove);
      clearTimer();
    };
  }, [chromeHover, isFullscreen]);

  const syncFullscreenState = useCallback(async () => {
    const windowFull = await isWindowFullscreen();
    const next = Boolean(document.fullscreenElement) || windowFull;
    if (wasFullscreenRef.current && !next) {
      lastFullscreenExitRef.current = Date.now();
    }
    wasFullscreenRef.current = next;
    setNativeFullscreen(next);
  }, [setNativeFullscreen]);

  const exitPlayerFullscreen = useCallback(async () => {
    lastFullscreenExitRef.current = Date.now();
    setCssFullscreen(false);
    setNativeFullscreen(false);

    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        /* 已经退出或无全屏元素 */
      }
    }

    try {
      if (await isWindowFullscreen()) await exitWindowFullscreen();
    } catch {
      /* 窗口已恢复正常 */
    }
  }, [setCssFullscreen, setNativeFullscreen]);

  useEffect(() => {
    void syncFullscreenState();
    const onFsChange = () => void syncFullscreenState();
    document.addEventListener("fullscreenchange", onFsChange);
    window.addEventListener("resize", onFsChange);
    const offWindowFullscreen = onWindowFullscreenChange(onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      window.removeEventListener("resize", onFsChange);
      offWindowFullscreen();
      setNativeFullscreen(false);
      setCssFullscreen(false);
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
      void isWindowFullscreen().then((fullscreen) => {
        if (fullscreen) void exitWindowFullscreen();
      });
    };
  }, [setCssFullscreen, setNativeFullscreen, syncFullscreenState]);

  const onToggleFullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void exitPlayerFullscreen();
    else void el.requestFullscreen().catch(() => undefined);
  }, [exitPlayerFullscreen, stageRef]);

  const onToggleWindowFullscreen = useCallback(() => {
    setCssFullscreen(!cssFullscreen);
  }, [cssFullscreen, setCssFullscreen]);

  const goBack = useCallback(async () => {
    await exitPlayerFullscreen();
    if (location.key === "default") navigate(platformHomePath(platform));
    else navigate(-1);
  }, [exitPlayerFullscreen, location.key, navigate, platform]);

  /* 捕获阶段快捷键（避免被 xgplayer 或弹层拦截） */
  const keyStateRef = useRef({
    isFullscreen,
    shortcutsOpen,
    player,
    onToggleFullscreen,
  });
  keyStateRef.current = { isFullscreen, shortcutsOpen, player, onToggleFullscreen };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const {
        isFullscreen: fullscreenActive,
        shortcutsOpen: shortcuts,
        player: playerApi,
        onToggleFullscreen: toggleFullscreen,
      } = keyStateRef.current;

      if (isTypingTarget(event.target)) return;
      if (event.key === "?") {
        event.preventDefault();
        event.stopPropagation();
        setShortcutsOpen((open) => !open);
        return;
      }
      if (event.key === "Escape") {
        if (shortcuts) {
          setShortcutsOpen(false);
          event.stopPropagation();
          return;
        }
        if (hasOpenOverlay()) return;
        if (document.fullscreenElement || fullscreenActive) {
          event.preventDefault();
          event.stopPropagation();
          void exitPlayerFullscreen();
          return;
        }
        void isWindowFullscreen().then((fullscreen) => {
          if (fullscreen) {
            void exitPlayerFullscreen();
            return;
          }
          if (Date.now() - lastFullscreenExitRef.current < 500) return;
          navigate(-1);
        });
        return;
      }
      if (shortcuts) return;
      switch (event.key.toLowerCase()) {
        case " ":
        case "k":
          event.preventDefault();
          event.stopPropagation();
          playerApi.togglePlay();
          break;
        case "f":
          event.preventDefault();
          event.stopPropagation();
          toggleFullscreen();
          break;
        case "m":
          event.preventDefault();
          event.stopPropagation();
          playerApi.toggleMute();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [exitPlayerFullscreen, navigate]);

  return {
    nativeFullscreen,
    cssFullscreen,
    isFullscreen,
    chromeHidden,
    setChromeHover,
    shortcutsOpen,
    setShortcutsOpen,
    onToggleFullscreen,
    onToggleWindowFullscreen,
    goBack,
  };
}
