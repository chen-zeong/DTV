"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Player from "xgplayer";
import FlvPlugin from "xgplayer-flv";
import HlsPlugin from "xgplayer-hls.js";
import "xgplayer/dist/index.min.css";
import "./player-controls.css";
import { Loader2, RotateCw, AlertTriangle, Play, X, ChevronRight, AtSign, Hash, Check, Plus, ChevronLeft } from "lucide-react";
import DanmuJs from "danmu.js";
import { Platform } from "@/types/platform";
import { DanmakuMessage } from "@/types/danmaku";
import { DanmakuPanel } from "@/components/player/danmaku-panel";
import { getStreamConfig, startDanmaku, stopDanmaku, StreamConfig } from "@/services/streams";
import { cn } from "@/utils/cn";
import { useFollowStore } from "@/stores/follow-store";
import { platformSlugMap } from "@/utils/platform";
import { getLineLabel, getLineOptionsForPlatform, persistLinePreference, resolveStoredLine } from "@/types/line";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { arrangeControlClusters } from "./controls/control-layout";
import { DanmuSettingsControl, DanmuToggleControl } from "./controls/danmu-plugins";
import { LineControl, QualityControl, RefreshControl, VolumeControl } from "./controls/player-controls-plugins";
import {
  DANMU_OPACITY_MIN,
  ICONS,
  sanitizeDanmuArea,
  sanitizeDanmuOpacity,
  type DanmuUserSettings,
} from "./controls/constants";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useThemeStore, type ThemeResolved } from "@/stores/theme-store";

type PlayerViewProps = {
  platform: Platform;
  roomId: string;
  onClose?: () => void;
  initialTitle?: string;
  initialAnchorName?: string;
  initialAvatar?: string;
  theme?: ThemeResolved;
  onFullscreenChange?: (isFs: boolean) => void;
};

type DanmuOverlayInstance = {
  sendComment?: (comment: { id?: string; txt: string; duration?: number; mode?: string; style?: Record<string, string> }) => void;
  setOpacity?: (opacity: number) => void;
  setFontSize?: (size: number | string, channelSize?: number) => void;
  setArea?: (area: { start: number; end: number; lines?: number }) => void;
  setAllDuration?: (mode: string, duration: number) => void;
  start?: () => void;
  destroy?: () => void;
};

type XgMediaPlayer = Player & {
  video?: HTMLVideoElement;
  media?: HTMLVideoElement;
};

const qualityOptions = ["原画", "高清", "标清"] as const;
const DANMAKU_PANEL_COLLAPSE_KEY = "danmaku_panel_collapsed";

export function PlayerView({
  platform,
  roomId,
  onClose,
  initialTitle,
  initialAnchorName,
  initialAvatar,
  theme,
  onFullscreenChange,
}: PlayerViewProps) {
  const storeTheme = useThemeStore((s) => s.resolvedTheme);
  const effectiveTheme = theme ?? storeTheme ?? "dark";
  const isDark = effectiveTheme === "dark";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<Player | null>(null);
  const danmakuUnlistenRef = useRef<(() => void) | undefined>(undefined);
  const danmuOverlayRef = useRef<DanmuOverlayInstance | null>(null);
  const danmakuCountRef = useRef(0);
  const refreshControlRef = useRef<RefreshControl | null>(null);
  const qualityControlRef = useRef<QualityControl | null>(null);
  const lineControlRef = useRef<LineControl | null>(null);
  const danmuToggleRef = useRef<DanmuToggleControl | null>(null);
  const danmuSettingsRef = useRef<DanmuSettingsControl | null>(null);
  const volumeControlRef = useRef<VolumeControl | null>(null);
  const reloadReasonRef = useRef<"auto" | "refresh" | "quality" | "line">("auto");
  const streamOrientationCleanupRef = useRef<(() => void) | null>(null);
  const rotateObserverRef = useRef<MutationObserver | null>(null);
  const closeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [quality, setQuality] = useState<(typeof qualityOptions)[number]>(() => {
    if (typeof window === "undefined") return "原画";
    const saved = window.localStorage.getItem(`quality_${platform}`) as (typeof qualityOptions)[number] | null;
    if (saved && (qualityOptions as readonly string[]).includes(saved)) return saved as (typeof qualityOptions)[number];
    return "原画";
  });
  const [line, setLine] = useState<string | null>(() => resolveStoredLine(platform));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamMeta, setStreamMeta] = useState<StreamConfig | null>(null);
  const [danmakuMessages, setDanmakuMessages] = useState<DanmakuMessage[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [danmakuEnabled, setDanmakuEnabled] = useState(true);
  const [danmakuOpacity, setDanmakuOpacity] = useState(1);
  const [danmakuFontSize, setDanmakuFontSize] = useState(20);
  const [danmakuDuration, setDanmakuDuration] = useState(10000);
  const [danmakuArea, setDanmakuArea] = useState(0.5);
  const [danmakuColor, setDanmakuColor] = useState("#ffffff");
  const [danmakuStrokeColor, setDanmakuStrokeColor] = useState("#444444");
  const [volume, setVolume] = useState(0.7);
  const [isCssFullscreen, setIsCssFullscreen] = useState(false);
  const [isStreamPortrait, setIsStreamPortrait] = useState<boolean | null>(null);
  const [showClose, setShowClose] = useState(false);
  const [danmakuCollapsed, setDanmakuCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(DANMAKU_PANEL_COLLAPSE_KEY) === "1";
  });
  const isFollowed = useFollowStore((s) => s.isFollowed);
  const followStreamer = useFollowStore((s) => s.followStreamer);
  const unfollowStreamer = useFollowStore((s) => s.unfollowStreamer);
  const router = useRouter();
  const isSidebarOpen = useSidebarStore((s) => s.isOpen);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 1024 : window.innerWidth));
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window === "undefined" ? 1920 : window.innerHeight));
  const isMobile = viewportWidth <= 768;
  const isPortrait = viewportHeight >= viewportWidth;
  const isMobileLandscape = isMobile && (!isPortrait || isStreamPortrait === false);
  const sidebarWidth = isMobile ? 0 : isSidebarOpen ? 220 : 70;
  const showBubbleDanmaku = isPortrait || !isCssFullscreen;
  const closeVisible = isCssFullscreen ? true : isMobile || showClose;
  const title = useMemo(() => {
    if (streamMeta?.title) return streamMeta.title;
    if (initialTitle) return initialTitle;
    return `${platform} - ${roomId}`;
  }, [streamMeta?.title, initialTitle, platform, roomId]);

  const anchorDisplay = useMemo(() => {
    return streamMeta?.anchorName || initialAnchorName || "主播";
  }, [streamMeta?.anchorName, initialAnchorName]);

  const avatarDisplay = useMemo(() => {
    return streamMeta?.avatar || initialAvatar || "";
  }, [streamMeta?.avatar, initialAvatar]);

  const isAnchorFollowed = isFollowed(platform, roomId);

  const updateStreamOrientation = useCallback((media?: HTMLVideoElement | null) => {
    const target =
      media ??
      ((playerRef.current as XgMediaPlayer | null)?.video ?? (playerRef.current as XgMediaPlayer | null)?.media ?? null);
    if (!target || !target.videoWidth || !target.videoHeight) return;
    setIsStreamPortrait(target.videoHeight >= target.videoWidth);
  }, []);

  // keep overlay in sync when browser fullscreen changes (not only css fullscreen)
  useEffect(() => {
    const handleFsChange = () => {
      const fs = Boolean(document.fullscreenElement);
      setIsCssFullscreen(fs);
      onFullscreenChange?.(fs);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, [onFullscreenChange]);

  const scheduleHideClose = useCallback((delay = 1600) => {
    if (closeHideTimerRef.current) {
      clearTimeout(closeHideTimerRef.current);
      closeHideTimerRef.current = null;
    }
    closeHideTimerRef.current = setTimeout(() => setShowClose(false), delay);
  }, []);

  const handlePlayerPointerMove = useCallback(() => {
    if (isMobile) return;
    setShowClose(true);
    scheduleHideClose();
  }, [isMobile, scheduleHideClose]);

  const handlePlayerPointerLeave = useCallback(() => {
    if (isMobile) return;
    scheduleHideClose(400);
  }, [isMobile, scheduleHideClose]);

  useEffect(() => {
    if (isCssFullscreen) {
      setShowClose(true);
      scheduleHideClose(2000);
    }
  }, [isCssFullscreen, scheduleHideClose]);

  useEffect(() => {
    return () => {
      if (closeHideTimerRef.current) {
        clearTimeout(closeHideTimerRef.current);
        closeHideTimerRef.current = null;
      }
    };
  }, []);

  const destroyPlayer = () => {
    try {
      danmuOverlayRef.current?.destroy?.();
    } catch (e) {
      console.warn("[player] destroy danmu overlay failed", e);
    }
    danmuOverlayRef.current = null;
    try {
      playerRef.current?.destroy?.();
    } catch (e) {
      console.warn("[player] destroy failed", e);
    }
    playerRef.current = null;
    refreshControlRef.current = null;
    volumeControlRef.current = null;
    danmuToggleRef.current = null;
    danmuSettingsRef.current = null;
    qualityControlRef.current = null;
    lineControlRef.current = null;
    streamOrientationCleanupRef.current?.();
    streamOrientationCleanupRef.current = null;
    setIsStreamPortrait(null);
    setIsCssFullscreen(false);
    setIsPlaying(false);
    if (rotateObserverRef.current) {
      rotateObserverRef.current.disconnect();
      rotateObserverRef.current = null;
    }
  };

  const normalizeRotateWrapper = (root: HTMLElement | null) => {
    if (!root) return;
    const rotateParent = root.closest(".xgplayer-rotate-parent") as HTMLElement | null;
    if (rotateParent) {
      const host = rotateParent.parentElement;
      if (host) {
        host.insertBefore(root, rotateParent);
        rotateParent.remove();
      }
    }
    root.style.position = "relative";
    root.style.width = "100%";
    root.style.height = "100%";
    root.style.left = "0";
    root.style.top = "0";
    root.style.transform = "none";
  };

  const watchAndNormalizeRotateWrapper = (root: HTMLElement | null) => {
    if (!root || typeof MutationObserver === "undefined") return;
    const container = root.parentElement;
    if (!container) return;
    rotateObserverRef.current?.disconnect();
    const observer = new MutationObserver(() => {
      normalizeRotateWrapper(root);
    });
    observer.observe(container, { childList: true, subtree: true });
    rotateObserverRef.current = observer;
  };

  const setupPlayer = (config: StreamConfig & { streamUrl: string }) => {
    if (!containerRef.current) {
      throw new Error("播放器容器不存在");
    }
    destroyPlayer();

    const isHls = config.streamType === "hls";
    const videoFillMode = isMobile && isPortrait ? "cover" : "contain";
    const player = new Player({
      el: containerRef.current,
      url: config.streamUrl,
      isLive: true,
      autoplay: true,
      playsinline: true,
      lang: "zh-cn",
      height: "100%",
      width: "100%",
      videoFillMode,
      keyShortcut: true,
      volume: false as unknown as number,
      playbackRate: false,
      cssFullscreen: { index: 2 },
      icons: {
        play: ICONS.play,
        pause: ICONS.pause,
        fullscreen: ICONS.maximize2,
        exitFullscreen: ICONS.minimize2,
        cssFullscreen: ICONS.fullscreen,
        exitCssFullscreen: ICONS.minimize2,
      },
      plugins: [isHls ? HlsPlugin : FlvPlugin],
      ...(isHls
        ? {
            hls: {
              isLive: true,
              retryCount: 3,
              retryDelay: 2000,
              enableWorker: true,
              lowLatencyMode: false,
            },
          }
        : {
            flv: {
              isLive: true,
              cors: true,
              autoCleanupSourceBuffer: true,
              enableWorker: true,
              stashInitialSize: 128,
              lazyLoad: true,
              lazyLoadMaxDuration: 30,
              deferLoadAfterSourceOpen: true,
            },
      }),
    });

    streamOrientationCleanupRef.current?.();
    const mediaEl = (player as XgMediaPlayer).video ?? (player as XgMediaPlayer).media;
    const handleMeta = () => updateStreamOrientation(mediaEl ?? null);
    if (mediaEl) {
      mediaEl.addEventListener("loadedmetadata", handleMeta);
      mediaEl.addEventListener("resize", handleMeta);
      handleMeta();
      streamOrientationCleanupRef.current = () => {
        mediaEl.removeEventListener("loadedmetadata", handleMeta);
        mediaEl.removeEventListener("resize", handleMeta);
      };
    } else {
      streamOrientationCleanupRef.current = null;
    }

    refreshControlRef.current = player.registerPlugin(RefreshControl, {
      onClick: () => {
        reloadReasonRef.current = "refresh";
        void initStream("refresh");
      },
    }) as RefreshControl;

    volumeControlRef.current = player.registerPlugin(VolumeControl, {}) as VolumeControl;

    danmuToggleRef.current = player.registerPlugin(DanmuToggleControl, {
      getState: () => danmakuEnabled,
      onToggle: (enabled: boolean) => {
        setDanmakuEnabled(enabled);
      },
    }) as DanmuToggleControl;

    danmuSettingsRef.current = player.registerPlugin(DanmuSettingsControl, {
      getSettings: (): DanmuUserSettings => ({
        color: danmakuColor,
        strokeColor: danmakuStrokeColor,
        fontSize: `${danmakuFontSize}px`,
        duration: danmakuDuration,
        area: danmakuArea,
        mode: "scroll",
        opacity: danmakuOpacity,
      }),
      onChange: (partial: Partial<DanmuUserSettings>) => {
        if (partial.color) setDanmakuColor(partial.color);
        if (partial.strokeColor) setDanmakuStrokeColor(partial.strokeColor);
        if (partial.fontSize) {
          const size = Number.parseInt(partial.fontSize, 10);
          if (Number.isFinite(size)) setDanmakuFontSize(Math.min(30, Math.max(10, size)));
        }
        if (typeof partial.duration === "number") {
          setDanmakuDuration(Math.min(20000, Math.max(3000, partial.duration)));
        }
        if (typeof partial.area === "number") {
          setDanmakuArea(sanitizeDanmuArea(partial.area));
        }
        if (typeof partial.opacity === "number") {
          setDanmakuOpacity(sanitizeDanmuOpacity(partial.opacity));
        }
      },
    }) as DanmuSettingsControl;

    qualityControlRef.current = player.registerPlugin(QualityControl, {
      options: [...qualityOptions],
      getCurrent: () => quality,
      onSelect: async (option: string) => {
        if (option === quality) return;
        reloadReasonRef.current = "quality";
        qualityControlRef.current?.setSwitching(true);
        setQuality(option as (typeof qualityOptions)[number]);
      },
    }) as QualityControl;
    qualityControlRef.current?.setOptions([...qualityOptions]);
    qualityControlRef.current?.updateLabel(quality);

    const lineOptionsForPlatform = getLineOptionsForPlatform(platform);
    lineControlRef.current = player.registerPlugin(LineControl, {
      disable: lineOptionsForPlatform.length === 0,
      options: lineOptionsForPlatform,
      getCurrentKey: () => line ?? "",
      getCurrentLabel: () => getLineLabel(lineOptionsForPlatform, line),
      onSelect: async (optionKey: string) => {
        if (optionKey === line) return;
        reloadReasonRef.current = "line";
        lineControlRef.current?.setSwitching(true);
        setLine(optionKey || null);
      },
    }) as LineControl;
    lineControlRef.current?.setOptions(lineOptionsForPlatform);
    lineControlRef.current?.updateLabel(getLineLabel(lineOptionsForPlatform, line));

    arrangeControlClusters(player);
    normalizeRotateWrapper(player.root as HTMLElement | null);
    watchAndNormalizeRotateWrapper(player.root as HTMLElement | null);

    player.on("play", () => setIsPlaying(true));
    player.on("pause", () => {
      setIsPlaying(false);
      // 部分斗鱼线路会意外触发暂停，尝试自动恢复播放
      if (platform === Platform.DOUYU) {
        const media = (player as XgMediaPlayer).media ?? (player as XgMediaPlayer).video;
        const shouldResume = media && !media.ended;
        if (shouldResume) {
          void player.play().catch(() => {});
        }
      }
    });
    player.on("volumechange", () => {
      setVolume(player.volume ?? 1);
    });
    player.on("ready", () => {
      arrangeControlClusters(player);
      normalizeRotateWrapper(player.root as HTMLElement | null);
      watchAndNormalizeRotateWrapper(player.root as HTMLElement | null);
    });
    player.on("cssfullscreenchange", (status: boolean) => {
      const next = Boolean(status);
      setIsCssFullscreen(next);
      onFullscreenChange?.(next);
    });
    player.on("fullscreenchange", (status: boolean) => {
      const next = Boolean(status);
      setIsCssFullscreen(next);
      onFullscreenChange?.(next);
    });
    playerRef.current = player;
    normalizeRotateWrapper(player.root as HTMLElement | null);
    watchAndNormalizeRotateWrapper(player.root as HTMLElement | null);
    setupDanmuOverlay(player);
  };

  const setupDanmuOverlay = (player: Player | null) => {
    if (!player) return;
    const root = player.root as HTMLElement | null;
    if (!root) return;
    const videoContainer = root.querySelector("xg-video-container") as HTMLElement | null;
    let host = root.querySelector(".player-danmu-overlay") as HTMLElement | null;
    if (!host) {
      host = document.createElement("div");
      host.className = "player-danmu-overlay";
    }
    host.innerHTML = "";
    host.style.position = "absolute";
    host.style.inset = "0";
    host.style.pointerEvents = "none";
    host.style.overflow = "hidden";
    host.style.zIndex = "12";
    if (videoContainer) {
      videoContainer.style.position = videoContainer.style.position || "relative";
      videoContainer.appendChild(host);
    } else {
      root.style.position = root.style.position || "relative";
      root.appendChild(host);
    }

    try {
      const media = (player as XgMediaPlayer).video ?? (player as XgMediaPlayer).media;
      const overlay: DanmuOverlayInstance = new DanmuJs({
        container: host,
        player: media,
        comments: [],
        mouseControl: false,
        defaultOff: false,
        channelSize: 36,
        containerStyle: {
          pointerEvents: "none",
        },
      });
      overlay.start?.();
      overlay.setOpacity?.(!isPortrait && danmakuEnabled ? danmakuPanelOpacity : 0);
      overlay.setFontSize?.(danmakuFontSize);
      overlay.setArea?.({ start: 0, end: danmakuArea });
      overlay.setAllDuration?.("scroll", danmakuDuration);
      danmuOverlayRef.current = overlay;
      danmakuCountRef.current = danmakuMessages.length;
    } catch (error) {
      console.error("[player] 初始化弹幕层失败", error);
    }
  };

  const initStream = async (reason: "auto" | "refresh" | "quality" | "line" = "auto") => {
    reloadReasonRef.current = reason;
    if (reason === "refresh") refreshControlRef.current?.setLoading(true);
    if (reason === "quality") qualityControlRef.current?.setSwitching(true);
    if (reason === "line") lineControlRef.current?.setSwitching(true);
    setLoading(true);
    setError(null);
    setDanmakuMessages([]);
    try {
      const cfg = await getStreamConfig(platform, roomId, quality, line ?? undefined);
      if (!cfg?.streamUrl) {
        throw new Error("无法获取直播流，请稍后重试");
      }
      setStreamMeta(cfg);
      setupPlayer({ ...cfg, streamUrl: cfg.streamUrl });
    } catch (e) {
      const err = e as Error;
      setError(err.message || "加载失败");
    } finally {
      setLoading(false);
      refreshControlRef.current?.setLoading(false);
      qualityControlRef.current?.setSwitching(false);
      lineControlRef.current?.setSwitching(false);
      reloadReasonRef.current = "auto";
    }
  };

  useEffect(() => {
    void initStream(reloadReasonRef.current);
    return () => {
      destroyPlayer();
      void stopDanmaku(platform, roomId, danmakuUnlistenRef.current);
      danmakuUnlistenRef.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, roomId, quality, line]);

  const handleRetry = () => void initStream();

  const handleManualPlay = async () => {
    if (loading) return;
    const player = playerRef.current as XgMediaPlayer | null;
    const media = player?.video ?? player?.media;
    if (!player) {
      await initStream("refresh");
      return;
    }
    try {
      await (player.play?.() ?? media?.play?.());
      setIsPlaying(true);
    } catch (err) {
      console.warn("[player] mobile manual play failed", err);
      try {
        await media?.play?.();
        setIsPlaying(true);
      } catch {
        await initStream("refresh");
      }
    }
  };

  const danmakuPanelOpacity = useMemo(() => {
    return Math.min(1, Math.max(DANMU_OPACITY_MIN, danmakuOpacity));
  }, [danmakuOpacity]);

  useEffect(() => {
    if (line) persistLinePreference(platform, line);
  }, [line, platform]);

  useEffect(() => {
    // platform change -> sync stored line and volume/font prefs
    const storedLine = resolveStoredLine(platform);
    setLine((prev) => (prev === storedLine ? prev : storedLine));
    if (typeof window !== "undefined") {
      const vol = window.localStorage.getItem("player_volume");
      if (vol) {
        const parsed = Number(vol);
        if (!Number.isNaN(parsed)) setVolume(Math.min(1, Math.max(0, parsed)));
      }
      const font = window.localStorage.getItem("danmaku_font_size");
      if (font) {
        const parsed = Number(font);
        if (!Number.isNaN(parsed)) setDanmakuFontSize(Math.min(28, Math.max(10, parsed)));
      }
    }
  }, [platform]);

  useEffect(() => {
    const key = `quality_${platform}`;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, quality);
    }
  }, [quality, platform]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(DANMAKU_PANEL_COLLAPSE_KEY, danmakuCollapsed ? "1" : "0");
  }, [danmakuCollapsed]);

  useEffect(() => {
    const update = () => {
      if (typeof window === "undefined") return;
      const width = window.visualViewport?.width ?? window.innerWidth;
      const height = window.visualViewport?.height ?? window.innerHeight;
      setViewportWidth(width);
      setViewportHeight(height);
    };
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    qualityControlRef.current?.updateLabel(quality);
  }, [quality]);

  useEffect(() => {
    const el = (playerRef.current?.root as HTMLElement | null) ?? containerRef.current;
    if (!el) return;
    const orientation = isStreamPortrait === false ? "landscape" : "portrait";
    el.dataset.streamOrientation = orientation;
  }, [isStreamPortrait, isPortrait]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `quality_${platform}`;
    const saved = window.localStorage.getItem(key) as (typeof qualityOptions)[number] | null;
    if (saved && (qualityOptions as readonly string[]).includes(saved) && saved !== quality) {
      setQuality(saved as (typeof qualityOptions)[number]);
    }
  }, [platform, quality]);

  useEffect(() => {
    const options = getLineOptionsForPlatform(platform);
    lineControlRef.current?.setOptions(options);
    lineControlRef.current?.updateLabel(getLineLabel(options, line));
  }, [line, platform]);

  useEffect(() => {
    danmuToggleRef.current?.setState(danmakuEnabled);
  }, [danmakuEnabled]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("player_volume", String(volume));
    }
    if (playerRef.current) {
      playerRef.current.volume = volume;
      playerRef.current.muted = volume === 0 ? true : playerRef.current.muted;
    }
  }, [volume]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("danmaku_font_size", String(danmakuFontSize));
    }
  }, [danmakuFontSize]);

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

  // manage danmaku listener when toggle/platform/room changes
  useEffect(() => {
    let cancelled = false;
    const safeUnlisten = (fn: (() => void) | undefined) => {
      if (!fn) return;
      try {
        fn();
      } catch (e) {
        console.warn("[player] cleanup danmaku listener", e);
      }
    };
    const manageDanmaku = async () => {
      // stop existing
      safeUnlisten(danmakuUnlistenRef.current);
      danmakuUnlistenRef.current = undefined;
      await stopDanmaku(platform, roomId, undefined);
      if (!danmakuEnabled) return;
      try {
        const unlisten = await startDanmaku(platform, roomId, (msg) => {
          if (!danmakuEnabled) return;
          setDanmakuMessages((prev) => {
            const next = [...prev, msg];
            if (next.length > 200) next.shift();
            return next;
          });
        });
        if (!cancelled) {
          danmakuUnlistenRef.current = unlisten;
        } else {
          safeUnlisten(unlisten);
        }
      } catch (e) {
        console.warn("[player] 弹幕启动失败", e);
      }
    };
    void manageDanmaku();
    return () => {
      cancelled = true;
    };
  }, [danmakuEnabled, platform, roomId]);

  // push new messages into danmu.js overlay (landscape only)
  useEffect(() => {
    const overlay = danmuOverlayRef.current;
    if (!overlay) {
      danmakuCountRef.current = danmakuMessages.length;
      return;
    }
    if (!danmakuEnabled || isPortrait) {
      overlay.setOpacity?.(0);
      danmakuCountRef.current = danmakuMessages.length;
      return;
    }
    const prev = danmakuCountRef.current;
    if (danmakuMessages.length <= prev) {
      danmakuCountRef.current = danmakuMessages.length;
      return;
    }
    const newMsgs = danmakuMessages.slice(prev);
    danmakuCountRef.current = danmakuMessages.length;
    newMsgs.forEach((msg) => {
      overlay.sendComment?.({
        id: msg.id,
        txt: msg.content,
        duration: danmakuDuration,
        mode: "scroll",
        style: {
          color: msg.color || danmakuColor,
          "--danmu-stroke-color": danmakuStrokeColor,
        },
      });
    });
  }, [danmakuMessages, danmakuEnabled, danmakuDuration, danmakuColor, danmakuStrokeColor, isPortrait, isCssFullscreen]);

  // sync overlay opacity/font size when settings change
  useEffect(() => {
    const overlay = danmuOverlayRef.current;
    if (!overlay) return;
    overlay.setOpacity?.(!isPortrait && danmakuEnabled ? danmakuPanelOpacity : 0);
  }, [danmakuEnabled, danmakuPanelOpacity, isPortrait]);

  useEffect(() => {
    const overlay = danmuOverlayRef.current;
    if (!overlay) return;
    overlay.setFontSize?.(danmakuFontSize);
  }, [danmakuFontSize]);

  useEffect(() => {
    const overlay = danmuOverlayRef.current;
    if (!overlay) return;
    overlay.setArea?.({ start: 0, end: danmakuArea });
    overlay.setAllDuration?.("scroll", danmakuDuration);
  }, [danmakuArea, danmakuDuration]);

  useEffect(() => {
    onFullscreenChange?.(isCssFullscreen);
  }, [isCssFullscreen, onFullscreenChange]);

  return (
    <div
      className={cn(
        "player-view-page h-full min-h-0 flex justify-center px-0.5 sm:px-1.5 md:px-2 lg:px-3",
        isMobile && "mobile-player",
        isDark
          ? "bg-gradient-to-br from-black via-zinc-950 to-gray-900 text-white"
          : "bg-gradient-to-br from-[#e9f1ff] via-white to-[#f3f6fb] text-gray-900"
      )}
      style={{ ["--sidebar-offset" as string]: `${sidebarWidth}px` }}
    >
      <div className="w-full max-w-none flex-1 h-full flex flex-col">
        <div
          className={cn(
            "h-full flex flex-col rounded-3xl border shadow-2xl backdrop-blur-xl overflow-hidden",
            isDark ? "bg-slate-950/70 border-white/10 shadow-black/40" : "bg-white/85 border-gray-200 shadow-gray-300/60"
          )}
        >
          <div className="flex flex-col md:flex-row items-start md:items-stretch gap-2 md:gap-0 px-0 py-2 md:px-0 md:py-0 md:overflow-hidden h-full">
            <div
              className={cn(
                "flex-1 flex flex-col gap-3 min-h-0 pt-3 md:pt-5 md:h-full",
                isMobileLandscape && "items-center pt-12"
              )}
            >
              <div className="flex flex-col gap-3 px-2 md:px-3">
                <div className="w-full">
                  <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-5">
                    <div className="relative flex-shrink-0">
                      <div
                        className={cn(
                          "absolute -inset-1 rounded-full opacity-60 blur-[2px]",
                          isDark ? "bg-gradient-to-br from-pink-600/50 to-blue-600/60" : "bg-gradient-to-br from-gray-200 to-gray-300"
                        )}
                      />
                      <div
                        className={cn(
                          "relative w-16 h-16 rounded-full overflow-hidden border-2 shadow-sm",
                          isDark ? "border-[#1a1b26] bg-black/20" : "border-white bg-white"
                        )}
                      >
                        {avatarDisplay ? (
                          <img src={avatarDisplay} alt={anchorDisplay || roomId} className="w-full h-full object-cover" />
                        ) : (
                          <div
                            className={cn(
                              "w-full h-full flex items-center justify-center text-lg font-semibold",
                              isDark ? "text-white/80" : "text-gray-700"
                            )}
                          >
                            {(anchorDisplay || roomId).slice(0, 1)}
                          </div>
                        )}
                      </div>
                      <span
                        className={cn(
                          "absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 live-dot",
                          isDark ? "border-[#1a1b26]" : "border-white",
                          "bg-emerald-500"
                        )}
                        title="直播中"
                      />
                    </div>
                    <div className="flex-1 min-w-0 text-center sm:text-left flex flex-col justify-center gap-2">
                      <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                        <span
                          className={cn(
                            "text-lg sm:text-xl font-bold truncate leading-tight transition-colors",
                            isDark ? "text-gray-100 hover:text-blue-400" : "text-gray-900 hover:text-blue-600"
                          )}
                        >
                          {streamMeta?.title || title}
                        </span>
                        <span className="inline-flex items-center gap-1 bg-red-50 dark:bg-red-900/40 text-red-600 dark:text-red-400 text-[11px] px-2 py-0.5 rounded border border-red-100 dark:border-red-800/50 font-medium whitespace-nowrap">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
                          <span>直播中</span>
                        </span>
                      </div>
                      <div
                        className={cn(
                          "flex items-center justify-center sm:justify-start gap-4 text-xs sm:text-sm",
                          isDark ? "text-gray-400" : "text-gray-500"
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          <AtSign className="w-4 h-4 opacity-70" />
                          <span className={cn("truncate", isDark ? "text-gray-200" : "text-gray-800")}>{anchorDisplay}</span>
                        </span>
                        <span className={cn("w-px h-3", isDark ? "bg-gray-700" : "bg-gray-300")} />
                        <span className="flex items-center gap-1.5 font-mono">
                          <Hash className="w-4 h-4 opacity-70" />
                          <span className="truncate">{roomId}</span>
                        </span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 w-full sm:w-auto">
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        transition={{ type: "spring", stiffness: 260, damping: 18 }}
                        onClick={() => {
                          if (isAnchorFollowed) {
                            unfollowStreamer(platform, roomId);
                          } else {
                            followStreamer({
                              id: roomId,
                              platform,
                              nickname: streamMeta?.anchorName || roomId,
                              avatarUrl: streamMeta?.avatar || "",
                              displayName: streamMeta?.anchorName || streamMeta?.title || roomId,
                              isLive: true,
                            });
                          }
                        }}
                        className={cn(
                          "relative overflow-hidden w-full sm:w-auto px-6 sm:px-7 py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2",
                          isAnchorFollowed
                            ? isDark
                              ? "bg-emerald-500/15 text-emerald-100 border border-emerald-400/40"
                              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-blue-600 hover:bg-blue-700 text-white border border-blue-500/70"
                        )}
                        title={isAnchorFollowed ? "取消关注" : "关注主播"}
                      >
                        <AnimatePresence mode="popLayout" initial={false}>
                          <motion.span
                            key={isAnchorFollowed ? "followed" : "unfollowed"}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ duration: 0.16, ease: [0.25, 0.8, 0.4, 1] }}
                            className="flex items-center gap-2"
                          >
                            {isAnchorFollowed ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                            <span>{isAnchorFollowed ? "已关注" : "关注"}</span>
                          </motion.span>
                        </AnimatePresence>
                      </motion.button>
                    </div>
                  </div>
                </div>
              </div>
          <div
            className={cn(
              "relative flex-1 min-h-0 rounded-xl overflow-hidden shadow-lg",
              isDark ? "bg-black" : "bg-white",
              isMobile ? (isMobileLandscape ? "w-full h-auto max-h-[50vh] mx-auto" : "w-full h-[100vh]") : "aspect-video",
              isMobileLandscape && "mt-12 mb-3"
            )}
            style={{ aspectRatio: isMobileLandscape ? "16 / 9" : undefined }}
            onMouseMove={handlePlayerPointerMove}
            onMouseEnter={handlePlayerPointerMove}
            onMouseLeave={handlePlayerPointerLeave}
          >
            <button
              onClick={() => {
                if (onClose) onClose();
                else router.back();
              }}
              className={cn(
                "absolute top-3 left-3 z-30 inline-flex items-center justify-center w-10 h-10 rounded-full border transition-opacity transition-transform transition-colors duration-200 hover:scale-105",
                isDark ? "bg-black/40 border-white/20 text-white hover:bg-black/30" : "bg-white/80 border-gray-200 text-gray-900 hover:bg-white",
                closeVisible ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-1 pointer-events-none"
              )}
              title="返回"
              aria-label="返回"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div ref={containerRef} className="w-full h-full" />
          {isMobile && !error && (
            <>
              <div
                className={cn(
                  "flex items-start justify-between gap-3 pointer-events-none",
                  isMobileLandscape
                    ? "fixed top-3 left-3 right-3 z-30"
                    : "absolute top-3 left-3 right-3 md:left-4 md:right-4"
                )}
              >
                <div className={cn("flex-1 min-w-0 pointer-events-none", !isMobile && "md:max-w-[65%]")}>
                  <div className="flex items-center gap-3 px-3.5 py-2.5 w-full">
                    <div className="relative flex-shrink-0">
                      <div
                        className={cn(
                          "absolute -inset-1 rounded-full opacity-60 blur-[2px]",
                          isDark ? "bg-gradient-to-br from-pink-600/50 to-blue-600/60" : "bg-gradient-to-br from-gray-200 to-gray-300"
                        )}
                      />
                      <div
                        className={cn(
                          "relative w-12 h-12 rounded-full overflow-hidden border-2 shadow-sm",
                          isDark ? "border-[#1a1b26] bg-black/20" : "border-white bg-white"
                        )}
                      >
                        {avatarDisplay ? (
                          <img src={avatarDisplay} alt={anchorDisplay || roomId} className="w-full h-full object-cover" />
                        ) : (
                          <div
                            className={cn(
                              "w-full h-full flex items-center justify-center text-sm font-semibold",
                              isDark ? "text-white/80" : "text-gray-700"
                            )}
                          >
                            {(anchorDisplay || roomId).slice(0, 1)}
                          </div>
                        )}
                      </div>
                      <span
                        className={cn(
                          "absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 live-dot",
                          isDark ? "border-[#1a1b26]" : "border-white",
                          "bg-emerald-500"
                        )}
                      />
                    </div>
                    <div className="flex flex-col min-w-0 gap-1 text-left">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={cn(
                            "text-sm font-semibold truncate leading-tight transition-colors",
                            isDark ? "text-gray-100" : "text-gray-900"
                          )}
                        >
                          {streamMeta?.title || title}
                        </span>
                        <span className="inline-flex items-center gap-1 bg-red-50 dark:bg-red-900/40 text-red-600 dark:text-red-400 text-[10px] px-2 py-0.5 rounded border border-red-100 dark:border-red-800/50 font-medium whitespace-nowrap">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
                          <span>直播中</span>
                        </span>
                      </div>
                      <div
                        className={cn(
                          "flex items-center gap-3 flex-wrap text-[11px]",
                          isDark ? "text-gray-400" : "text-gray-500"
                        )}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <AtSign className="w-3.5 h-3.5 opacity-70" />
                          <span className={cn("truncate", isDark ? "text-gray-200" : "text-gray-800")}>{anchorDisplay}</span>
                        </span>
                        <span className={cn("w-px h-3", isDark ? "bg-gray-700" : "bg-gray-300")} />
                        <span className="inline-flex items-center gap-1.5 font-mono">
                          <Hash className="w-3.5 h-3.5 opacity-70" />
                          <span className="truncate">{roomId}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pointer-events-auto">
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 260, damping: 18 }}
                    onClick={() => {
                      if (isAnchorFollowed) {
                        unfollowStreamer(platform, roomId);
                      } else {
                        followStreamer({
                          id: roomId,
                          platform,
                          nickname: streamMeta?.anchorName || roomId,
                          avatarUrl: streamMeta?.avatar || "",
                          displayName: streamMeta?.anchorName || streamMeta?.title || roomId,
                          isLive: true,
                        });
                      }
                    }}
                    className={cn(
                      "relative overflow-hidden px-4 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2",
                      isAnchorFollowed
                        ? isDark
                          ? "bg-emerald-500/15 text-emerald-100 border border-emerald-400/40"
                          : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-blue-600 hover:bg-blue-700 text-white border border-blue-500/70"
                    )}
                  >
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.span
                        key={isAnchorFollowed ? "followed-m" : "unfollowed-m"}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.16, ease: [0.25, 0.8, 0.4, 1] }}
                        className="flex items-center gap-2"
                      >
                        {isAnchorFollowed ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                        <span>{isAnchorFollowed ? "已关注" : "关注"}</span>
                      </motion.span>
                    </AnimatePresence>
                  </motion.button>
                </div>
              </div>

              {showBubbleDanmaku && !isMobileLandscape && (
                <div className="absolute bottom-14 left-3 right-[18%] flex flex-col items-start gap-1 pointer-events-none">
                  {danmakuMessages.slice(-5).map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        "inline-grid w-auto max-w-full grid-cols-[auto_1fr] items-start gap-x-2 text-sm leading-5 drop-shadow rounded-2xl px-3 py-1.5 border pointer-events-none",
                        isDark
                          ? "text-white bg-gray-900/65 border-white/10"
                          : "text-gray-900 bg-white/90 border-gray-200 shadow"
                      )}
                    >
                      <span className={cn("font-semibold whitespace-nowrap", isDark ? "text-white" : "text-gray-900")}>
                        @{msg.nickname}
                      </span>
                      <span className={cn("whitespace-normal break-words min-w-0", isDark ? "text-white/90" : "text-gray-800")}>
                        {msg.content}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {isMobile && !loading && !error && !isPlaying && (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 backdrop-blur-sm">
              <button
                onClick={handleManualPlay}
                className={cn(
                  "px-4 py-2 rounded-full border flex items-center gap-2 text-sm font-semibold shadow-lg",
                  isDark
                    ? "border-white/30 bg-white/10 text-white hover:bg-white/15"
                    : "border-gray-300 bg-white/90 text-gray-900 hover:bg-gray-100"
                )}
              >
                <Play className="w-4 h-4" />
                <span>点击播放</span>
              </button>
            </div>
          )}
          {loading && (
            <div
              className={cn(
                "absolute inset-0 flex flex-col items-center justify-center gap-3 backdrop-blur-sm",
                isDark ? "bg-black/60" : "bg-white/80"
              )}
            >
              <Loader2 className="w-7 h-7 animate-spin" />
              <p className={cn("text-sm", isDark ? "text-gray-300" : "text-gray-700")}>加载直播流...</p>
            </div>
          )}
          {error && !loading && (
            <div
              className={cn(
                "absolute inset-0 flex flex-col items-center justify-center gap-3 backdrop-blur-sm text-center px-4",
                isDark ? "bg-black/70" : "bg-white/85"
              )}
            >
              <AlertTriangle className={cn("w-8 h-8", isDark ? "text-amber-400" : "text-amber-500")} />
              <p className={cn("text-sm", isDark ? "text-gray-200" : "text-gray-700")}>{error}</p>
              <button
                onClick={handleRetry}
                className={cn(
                  "px-4 py-2 rounded-full border transition-colors text-sm flex items-center gap-2",
                  isDark
                    ? "border-white/20 bg-white/10 hover:bg-white/20 text-white"
                    : "border-gray-200 bg-white hover:bg-gray-100 text-gray-900"
                )}
              >
                <RotateCw className="w-4 h-4" /> 再试一次
              </button>
            </div>
          )}
        </div>

        {isMobileLandscape && showBubbleDanmaku && (
          <div className="mt-2 px-3 space-y-1">
            {danmakuMessages.slice(-6).map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "inline-grid w-auto max-w-full grid-cols-[auto_1fr] items-start gap-x-2 text-sm leading-5 drop-shadow rounded-2xl px-3 py-1.5 border",
                  isDark ? "text-white bg-gray-900/55 border-white/10" : "text-gray-900 bg-white/90 border-gray-200 shadow"
                )}
              >
                <span className={cn("font-semibold whitespace-nowrap", isDark ? "text-white" : "text-gray-900")}>
                  @{msg.nickname}
                </span>
                <span className={cn("whitespace-normal break-words min-w-0", isDark ? "text-white/90" : "text-gray-800")}>
                  {msg.content}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {!isMobile && (
        <div
          className={cn(
            "relative h-full flex-shrink-0 transition-[width] duration-300 ease-out overflow-visible",
            danmakuCollapsed ? "w-[64px]" : "w-[208px] lg:w-[224px]"
          )}
        >
          <button
            onClick={() => setDanmakuCollapsed((v) => !v)}
            className={cn(
              "absolute -left-3 top-1/2 -translate-y-1/2 z-20 inline-flex items-center justify-center w-9 h-9 rounded-full shadow-lg border backdrop-blur",
              isDark
                ? "bg-slate-900/80 border-white/10 text-gray-100 hover:bg-slate-800/90"
                : "bg-white/90 border-gray-200 text-gray-800 hover:bg-white"
            )}
            title={danmakuCollapsed ? "展开弹幕列表" : "收起弹幕列表"}
            aria-label="折叠弹幕列表"
          >
            <ChevronRight className={cn("w-4 h-4 transition-transform duration-200", danmakuCollapsed ? "-rotate-180" : "rotate-0")} />
          </button>
          <div
            className={cn(
              "flex flex-col h-full border-l rounded-none transition-opacity duration-200",
              isDark ? "border-white/5 bg-white/5" : "border-gray-200/70 bg-gray-50/80",
              danmakuCollapsed ? "opacity-0 pointer-events-none" : "opacity-100"
            )}
          >
            <div
              className={cn(
                "px-4 pt-4 pb-2 text-sm font-semibold tracking-wide uppercase flex items-center gap-2",
                isDark ? "text-gray-100" : "text-gray-700"
              )}
            >
              弹幕
                <span
                  className={cn(
                    "text-[11px] font-semibold px-2.5 py-0.5 rounded-full border",
                    isDark
                      ? "bg-emerald-500/20 text-emerald-100 border-emerald-400/40"
                      : "bg-emerald-50 text-emerald-700 border-emerald-200"
                  )}
                >
                  已连接
                </span>
            </div>
            <div className="flex-1 min-h-0 flex">
              <DanmakuPanel
                messages={danmakuMessages}
                className="transition-opacity flex-1 h-full w-full"
                style={{ opacity: danmakuPanelOpacity, fontSize: `${danmakuFontSize}px` }}
                theme={isDark ? "dark" : "light"}
              />
            </div>
          </div>
        </div>
      )}
          </div>
        </div>
      </div>
      {isCssFullscreen ? (
        <button
          onClick={() => {
            if (onClose) onClose();
            else router.back();
          }}
          className={cn(
            "fixed top-3 left-3 z-[140] inline-flex items-center justify-center w-10 h-10 rounded-full border transition-opacity transition-transform transition-colors duration-200 hover:scale-105",
            isDark ? "bg-black/40 border-white/20 text-white hover:bg-black/30" : "bg-white/80 border-gray-200 text-gray-900 hover:bg-white",
            closeVisible ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-1 pointer-events-none"
          )}
          title="返回"
          aria-label="返回"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      ) : null}
    </div>
  );
}
