"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { listen, type Event as TauriEvent } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { v4 as uuidv4 } from "uuid";
import { AnimatePresence, m } from "framer-motion";
import { POSITIONS } from "xgplayer/es/plugin/plugin.js";

import "xgplayer/dist/index.min.css";
import "./player.css";

import type { DanmakuMessage, DanmuOverlayInstance, RustGetStreamUrlPayload } from "@/components/player/types";
import type { DanmuUserSettings } from "@/components/player/constants";
import {
  applyDanmuFontFamilyForOS,
  ICONS,
  loadDanmuPreferences,
  loadStoredVolume,
  persistDanmuPreferences,
  sanitizeDanmuArea,
  sanitizeDanmuOpacity
} from "@/components/player/constants";
import { arrangeControlClusters } from "@/components/player/controlLayout";
import { Platform } from "@/platforms/common/types";
import { getDouyuStreamConfig, stopDouyuProxy } from "@/platforms/douyu/playerHelper";
import { fetchAndPrepareDouyinStreamConfig } from "@/platforms/douyin/playerHelper";
import { getHuyaStreamConfig } from "@/platforms/huya/playerHelper";
import { getBilibiliStreamConfig } from "@/platforms/bilibili/playerHelper";
import { useImageProxy } from "@/hooks/useImageProxy";
import { useFollow, type FollowedStreamer, type Platform as FollowPlatform } from "@/state/follow/FollowProvider";
import { usePlayerUi } from "@/state/playerUi/PlayerUiProvider";

const qualityOptions = ["原画", "高清", "标清"] as const;

const DEFAULT_DANMU_SETTINGS: DanmuUserSettings = {
  color: "#ffffff",
  strokeColor: "#444444",
  fontSize: "20px",
  duration: 10000,
  area: 0.5,
  mode: "scroll",
  opacity: 1
};

function resolveStoredQuality(platform: Platform) {
  try {
    const saved = window.localStorage.getItem(`${platform}_preferred_quality`);
    if (saved && (qualityOptions as readonly string[]).includes(saved)) return saved;
  } catch {
    // ignore
  }
  return "原画";
}

function isOfflineMessage(msg: string) {
  const s = (msg || "").toLowerCase();
  return s.includes("未开播") || s.includes("主播未开播") || s.includes("房间不存在");
}

function supportsMseType(mime: string) {
  try {
    return typeof MediaSource !== "undefined" && typeof MediaSource.isTypeSupported === "function" && MediaSource.isTypeSupported(mime);
  } catch {
    return false;
  }
}

function maybeAppendHevcInstallHint(rawMessage: string) {
  const msg = String(rawMessage || "");
  const lower = msg.toLowerCase();
  const looksLikeHevcCodecUnsupported =
    (lower.includes("video/mp4") && (lower.includes("hev1") || lower.includes("hvc1"))) ||
    lower.includes("hevc") ||
    lower.includes("h.265") ||
    lower.includes("h265");
  if (!looksLikeHevcCodecUnsupported) return msg;

  const hev1 = 'video/mp4; codecs="hev1.1.6.L93.B0"';
  const hvc1 = 'video/mp4; codecs="hvc1.1.6.L93.B0"';
  const hev1Supported = supportsMseType(hev1);
  const hvc1Supported = supportsMseType(hvc1);

  if (!hev1Supported && !hvc1Supported) {
    return `${msg}\n\n提示：检测到当前环境不支持 HEVC(H.265) 解码（hev1/hvc1 均不支持）。\n请安装 Microsoft.HEVCVideoExtension 插件后重启软件。\n下载地址：https://github.com/chen-zeong/DTV/releases\n（按 release 提示下载并安装对应插件）`;
  }

  return msg;
}

type UnifiedRustDanmakuPayload = {
  room_id?: string;
  user: string;
  content: string;
  user_level: number;
  fans_club_level: number;
};

type LineOption = { key: string; label: string };
const lineOptionsByPlatform: Partial<Record<Platform, LineOption[]>> = {
  [Platform.DOUYU]: [
    { key: "ws-h5", label: "主线路" },
    { key: "tct-h5", label: "线路5" },
    { key: "ali-h5", label: "线路6" },
    { key: "hs-h5", label: "线路13" }
  ],
  [Platform.HUYA]: [
    { key: "tx", label: "腾讯线路" },
    { key: "al", label: "阿里线路" },
    { key: "hs", label: "字节线路" }
  ]
};

function resolveStoredLine(platform: Platform, options: LineOption[]) {
  if (!options.length) return null;
  try {
    const saved = window.localStorage.getItem(`${platform}_preferred_line`);
    if (saved && options.some((o) => o.key === saved)) return saved;
  } catch {
    // ignore
  }
  return options[0]?.key ?? null;
}

function persistLinePreference(platform: Platform, lineKey: string) {
  try {
    window.localStorage.setItem(`${platform}_preferred_line`, lineKey);
  } catch {
    // ignore
  }
}

function resolveCurrentLineFor(options: LineOption[], currentLine: string | null) {
  if (!options.length) return null;
  if (currentLine && options.some((o) => o.key === currentLine)) return currentLine;
  return options[0]?.key ?? null;
}

export function MainPlayer({
  platform,
  roomId,
  onRequestClose
}: {
  platform: Platform;
  roomId: string;
  onRequestClose?: () => void;
}) {
  const router = useRouter();
  const follow = useFollow();
  const { setIsland, clearIsland, setFullscreen } = usePlayerUi();
  const { ensureProxyStarted, getAvatarSrc } = useImageProxy();
  const pageRef = useRef<HTMLDivElement | null>(null);

  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const danmuOverlayRef = useRef<DanmuOverlayInstance | null>(null);
  const unlistenRef = useRef<null | (() => void)>(null);
  const danmakuActiveRef = useRef(false);
  const danmakuActiveKeyRef = useRef<string | null>(null);

  const refreshPluginRef = useRef<any>(null);
  const volumePluginRef = useRef<any>(null);
  const danmuTogglePluginRef = useRef<any>(null);
  const danmuSettingsPluginRef = useRef<any>(null);
  const qualityPluginRef = useRef<any>(null);
  const linePluginRef = useRef<any>(null);
  const hevcBrandPatchedRef = useRef(false);

  const [isLoadingStream, setIsLoadingStream] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isOfflineError, setIsOfflineError] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  const [playerTitle, setPlayerTitle] = useState<string | null>(null);
  const [playerAnchorName, setPlayerAnchorName] = useState<string | null>(null);
  const [playerAvatar, setPlayerAvatar] = useState<string | null>(null);
  const [playerIsLive, setPlayerIsLive] = useState<boolean | null>(null);

  const lineOptions: LineOption[] = useMemo(() => lineOptionsByPlatform[platform] ?? [], [platform]);
  const [currentQuality, setCurrentQuality] = useState<string>(() =>
    typeof window === "undefined" ? "原画" : resolveStoredQuality(platform)
  );
  const [currentLine, setCurrentLine] = useState<string | null>(() =>
    typeof window === "undefined" ? null : resolveStoredLine(platform, lineOptionsByPlatform[platform] ?? [])
  );

  const [isDanmuEnabled, setIsDanmuEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = loadDanmuPreferences();
    return stored?.enabled ?? true;
  });
  const [danmuSettings, setDanmuSettings] = useState<DanmuUserSettings>(() => {
    if (typeof window === "undefined") return DEFAULT_DANMU_SETTINGS;
    const stored = loadDanmuPreferences();
    return stored?.settings ?? DEFAULT_DANMU_SETTINGS;
  });

  const [chromeVisible, setChromeVisible] = useState(true);
  const hideChromeTimerRef = useRef<number | null>(null);
  const moveRafRef = useRef(0);

  useEffect(() => {
    const armHide = () => {
      if (hideChromeTimerRef.current) window.clearTimeout(hideChromeTimerRef.current);
      hideChromeTimerRef.current = window.setTimeout(() => {
        setChromeVisible(false);
      }, 3000);
    };

    // Start hidden-after-idle behavior immediately on mount.
    setChromeVisible(true);
    armHide();

    const onMove = () => {
      if (moveRafRef.current) return;
      moveRafRef.current = window.requestAnimationFrame(() => {
        moveRafRef.current = 0;
        setChromeVisible(true);
        armHide();
      });
    };

    // Listen on `window` to avoid WebView/video layers swallowing pointer events.
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove as any);
      window.removeEventListener("pointermove", onMove as any);
      if (hideChromeTimerRef.current) window.clearTimeout(hideChromeTimerRef.current);
      if (moveRafRef.current) window.cancelAnimationFrame(moveRafRef.current);
      hideChromeTimerRef.current = null;
      moveRafRef.current = 0;
    };
  }, []);

  const chromeHiddenClass = chromeVisible ? "" : " player-chrome-hidden";

  const reloadStreamRef = useRef<
    | null
    | ((
        trigger: "refresh" | "quality" | "line",
        overrides?: { quality?: string; line?: string | null }
      ) => Promise<void>)
  >(null);
  const qualityReloadArmedRef = useRef(false);
  const reloadInFlightRef = useRef(false);
  const pendingReloadRef = useRef<null | { trigger: "refresh" | "quality" | "line"; overrides?: { quality?: string; line?: string | null } }>(
    null
  );
  const delayedStopTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (platform === Platform.BILIBILI || platform === Platform.HUYA) {
      void ensureProxyStarted();
    }
  }, [ensureProxyStarted, platform]);

  useEffect(() => {
    setIsland({
      platform,
      roomId,
      anchorName: playerAnchorName,
      title: playerTitle,
      avatarUrl: getAvatarSrc(platform, playerAvatar)
    });
    return () => clearIsland();
  }, [clearIsland, getAvatarSrc, platform, playerAvatar, playerAnchorName, playerTitle, roomId, setIsland]);

  useEffect(() => {
    setFullscreen(isFullScreen);
    return () => setFullscreen(false);
  }, [isFullScreen, setFullscreen]);

  const isFollowed = useMemo(() => {
    const fp: FollowPlatform =
      platform === Platform.DOUYU
        ? "DOUYU"
        : platform === Platform.DOUYIN
          ? "DOUYIN"
          : platform === Platform.HUYA
            ? "HUYA"
            : "BILIBILI";
    return follow.isFollowed(fp, roomId);
  }, [follow, platform, roomId]);

  const destroyPlayer = useCallback(() => {
    try {
      unlistenRef.current?.();
    } catch {
      // ignore
    }
    unlistenRef.current = null;

    try {
      danmuOverlayRef.current?.stop?.();
    } catch {
      // ignore
    }
    danmuOverlayRef.current = null;

    try {
      playerRef.current?.destroy();
    } catch {
      // ignore
    }
    playerRef.current = null;

    refreshPluginRef.current = null;
    volumePluginRef.current = null;
    danmuTogglePluginRef.current = null;
    danmuSettingsPluginRef.current = null;
    qualityPluginRef.current = null;
    linePluginRef.current = null;

    setIsFullScreen(false);
  }, []);

  const stopDanmakuBackend = useCallback(async () => {
    try {
      if (platform === Platform.DOUYU) {
        await invoke("stop_danmaku_listener", { roomId });
      } else if (platform === Platform.DOUYIN) {
        const payload: RustGetStreamUrlPayload = { args: { room_id_str: "stop_listening" }, platform: Platform.DOUYIN };
        await invoke("start_douyin_danmu_listener", { payload });
      } else if (platform === Platform.HUYA) {
        await invoke("stop_huya_danmaku_listener", { roomId });
      } else if (platform === Platform.BILIBILI) {
        await invoke("stop_bilibili_danmaku_listener");
      }
    } catch {
      // ignore
    } finally {
      danmakuActiveRef.current = false;
      danmakuActiveKeyRef.current = null;
    }
  }, [platform, roomId]);

  const startDanmaku = useCallback(
    async (overlay: DanmuOverlayInstance | null, platformToStart: Platform, roomIdToStart: string) => {
      try {
        unlistenRef.current?.();
      } catch {
        // ignore
      }
      unlistenRef.current = null;

      if (!roomIdToStart) return;

      const activeKey = `${platformToStart}:${roomIdToStart}`;
      const shouldStartBackend = !danmakuActiveRef.current || danmakuActiveKeyRef.current !== activeKey;

      try {
        if (shouldStartBackend) {
          if (platformToStart === Platform.DOUYU) {
            await invoke("start_danmaku_listener", { roomId: roomIdToStart });
          } else if (platformToStart === Platform.DOUYIN) {
            const payload: RustGetStreamUrlPayload = { args: { room_id_str: roomIdToStart }, platform: Platform.DOUYIN };
            await invoke("start_douyin_danmu_listener", { payload });
          } else if (platformToStart === Platform.HUYA) {
            await invoke("start_huya_danmaku_listener", { payload: { args: { room_id_str: roomIdToStart } } });
          } else if (platformToStart === Platform.BILIBILI) {
            const cookie = typeof localStorage !== "undefined" ? localStorage.getItem("bilibili_cookie") : null;
            await invoke("start_bilibili_danmaku_listener", {
              payload: { args: { room_id_str: roomIdToStart } },
              cookie: cookie || null
            });
          }

          danmakuActiveRef.current = true;
          danmakuActiveKeyRef.current = activeKey;
        }
      } catch (e) {
        console.warn("[Player] start danmaku backend failed:", e);
        danmakuActiveRef.current = false;
        danmakuActiveKeyRef.current = null;
      }

      const unlisten = await listen<UnifiedRustDanmakuPayload>("danmaku-message", (event: TauriEvent<UnifiedRustDanmakuPayload>) => {
        const p = event.payload;
        if (!p) return;
        // Douyin 后端 emit 的 room_id 是解析后的“真实 room_id”（与用户输入的短 roomId 不同），
        // 这里不能用 room_id 做过滤，否则会把所有抖音弹幕丢掉。
        if (platformToStart !== Platform.DOUYIN) {
          if (p.room_id && p.room_id !== roomIdToStart) return;
        }

        const msg: DanmakuMessage = {
          id: uuidv4(),
          nickname: p.user || "未知用户",
          content: p.content || "",
          level: String(p.user_level || 0),
          badgeLevel: p.fans_club_level > 0 ? String(p.fans_club_level) : undefined,
          room_id: p.room_id || roomIdToStart
        };

        if (isDanmuEnabled && overlay?.sendComment) {
          try {
            overlay.sendComment({
              id: msg.id,
              txt: msg.content,
              duration: 12000,
              mode: "scroll",
              style: {
                color: msg.color || "#FFFFFF"
              }
            });
          } catch {
            // ignore
          }
        }
      });

      unlistenRef.current = unlisten;
    },
    [isDanmuEnabled, stopDanmakuBackend]
  );

  const mountPlayer = useCallback(
    async (url: string, streamType: string | undefined) => {
      // 等待 DOM 渲染完成，确保 ref 可用
      let attempts = 0;
      while (!playerContainerRef.current && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 50));
        attempts++;
      }
      
      if (!playerContainerRef.current) {
        console.error("[Player] Player container ref is not available after waiting");
        throw new Error("播放器容器初始化失败，请刷新页面重试。");
      }

      const isHlsPlayback = (streamType || "").toLowerCase() === "hls" || url.toLowerCase().includes(".m3u8");

      const [{ default: PlayerCtor }, flvMod, hlsMod, overlayMod, pluginsMod] = await Promise.all([
        import("xgplayer"),
        import("xgplayer-flv"),
        import("xgplayer-hls.js"),
        import("@/components/player/danmuOverlay"),
        import("@/components/player/plugins")
      ]);

      const FlvPlugin: any = (flvMod as any).default ?? flvMod;
      const HlsPlugin: any = (hlsMod as any).default ?? hlsMod;
      const { applyDanmuOverlayPreferences, createDanmuOverlay, syncDanmuEnabledState } = overlayMod as any;
      const { DanmuSettingsControl, DanmuToggleControl, LineControl, QualityControl, RefreshControl, VolumeControl } =
        pluginsMod as any;

      const playerOptions: any = {
        el: playerContainerRef.current,
        url,
        autoplay: true,
        isLive: true,
        playsinline: true,
        lang: "zh-cn",
        videoFillMode: "contain",
        closeVideoClick: true,
        closeVideoTouch: true,
        keyShortcut: true,
        width: "100%",
        height: "100%",
        volume: false as unknown as number,
        pip: {
          position: POSITIONS.CONTROLS_RIGHT,
          index: 3,
          showIcon: true
        },
        cssFullscreen: {
          index: 2
        },
        playbackRate: false,
        controls: {
          mode: "normal"
        },
        icons: {
          play: ICONS.play,
          pause: ICONS.pause,
          fullscreen: ICONS.maximize2,
          exitFullscreen: ICONS.minimize2,
          cssFullscreen: ICONS.fullscreen,
          exitCssFullscreen: ICONS.minimize2,
          pipIcon: ICONS.pictureInPicture2,
          pipIconExit: ICONS.pictureInPicture2
        }
      };

      if (isHlsPlayback) {
        const hlsFetchOptions: RequestInit = {
          referrer: "https://live.bilibili.com/",
          referrerPolicy: "no-referrer-when-downgrade",
          credentials: "omit",
          mode: "cors"
        };

        playerOptions.plugins = [HlsPlugin];
        playerOptions.useHlsPlugin = true;
        playerOptions.hls = {
          isLive: true,
          retryCount: 3,
          retryDelay: 2000,
          enableWorker: true,
          withCredentials: false,
          lowLatencyMode: false,
          fetchOptions: hlsFetchOptions,
          xhrSetup: (xhr: XMLHttpRequest) => {
            try {
              xhr.withCredentials = false;
              xhr.setRequestHeader("Referer", "https://live.bilibili.com/");
              xhr.setRequestHeader("Origin", "https://live.bilibili.com");
            } catch {
              // ignore
            }
          }
        };
      } else {
        // 弱网/兼容性兜底：部分 WebView2 环境对 `hev1` codec 字符串不支持，但对 `hvc1` 支持。
        // xgplayer-transmuxer 默认会生成 `hev1.*`，这里在运行时探测后做一次 monkey patch。
        const hev1 = 'video/mp4; codecs="hev1.1.6.L93.B0"';
        const hvc1 = 'video/mp4; codecs="hvc1.1.6.L93.B0"';
        if (!hevcBrandPatchedRef.current && !supportsMseType(hev1) && supportsMseType(hvc1)) {
          try {
            const mod: any = await import("xgplayer-transmuxer/es/codec/hevc.js");
            const HEVC: any = mod?.HEVC;
            const orig = HEVC?.parseHEVCDecoderConfigurationRecord;
            if (HEVC && typeof orig === "function") {
              HEVC.parseHEVCDecoderConfigurationRecord = function (data: any, hvcC?: any) {
                const ret = orig.call(this, data, hvcC);
                if (ret && typeof ret.codec === "string" && ret.codec.startsWith("hev1")) {
                  ret.codec = `hvc1${ret.codec.slice(4)}`;
                }
                return ret;
              };
              hevcBrandPatchedRef.current = true;
              console.info("[Player] Patched HEVC codec brand: hev1 -> hvc1 (MSE compatibility).");
            }
          } catch (e) {
            console.warn("[Player] Failed to patch HEVC codec brand:", e);
          }
        }

        playerOptions.plugins = [FlvPlugin];
        playerOptions.flv = {
          isLive: true,
          cors: true,
          autoCleanupSourceBuffer: true,
          enableWorker: true,
          stashInitialSize: 128,
          lazyLoad: true,
          lazyLoadMaxDuration: 30,
          deferLoadAfterSourceOpen: true
        };
      }

      const player = new (PlayerCtor as any)(playerOptions);
      playerRef.current = player;

      try {
        const storedPlayerVolume = loadStoredVolume();
        if (storedPlayerVolume !== null) {
          player.volume = storedPlayerVolume;
          player.muted = storedPlayerVolume === 0 ? true : player.muted;
        }
      } catch {
        // ignore
      }

      try {
        const onFull = (value: boolean) => setIsFullScreen(!!value);
        const onCssFull = (value: boolean) => setIsFullScreen(!!value || !!player.fullscreen);
        player.on?.("fullscreen_change", onFull);
        player.on?.("cssFullscreen_change", onCssFull);
        player.on?.("destroy", () => setIsFullScreen(false));
      } catch {
        // ignore
      }

      refreshPluginRef.current = player.registerPlugin?.(RefreshControl, {
        position: POSITIONS.CONTROLS_LEFT,
        index: 2,
        onClick: () => void reloadStreamRef.current?.("refresh")
      });

      volumePluginRef.current = player.registerPlugin?.(VolumeControl, {
        position: POSITIONS.CONTROLS_LEFT,
        index: 3
      });

      danmuTogglePluginRef.current = player.registerPlugin?.(DanmuToggleControl, {
        position: POSITIONS.CONTROLS_RIGHT,
        index: 4,
        getState: () => isDanmuEnabled,
        onToggle: (enabled: boolean) => setIsDanmuEnabled(enabled)
      });

      danmuSettingsPluginRef.current = player.registerPlugin?.(DanmuSettingsControl, {
        position: POSITIONS.CONTROLS_RIGHT,
        index: 4.2,
        getSettings: () => danmuSettings,
        onChange: (partial: Partial<DanmuUserSettings>) => {
          setDanmuSettings((prev) => {
            const next: DanmuUserSettings = { ...prev, ...partial };
            next.area = sanitizeDanmuArea(next.area);
            next.opacity = sanitizeDanmuOpacity(next.opacity);
            if (typeof next.strokeColor !== "string") next.strokeColor = "#444444";
            return next;
          });
        }
      });

      qualityPluginRef.current = player.registerPlugin?.(QualityControl, {
        position: POSITIONS.CONTROLS_RIGHT,
        index: 5,
        options: [...qualityOptions],
        getCurrent: () => currentQuality,
        onSelect: (value: string) => {
          if (value === currentQuality) return;
          setCurrentQuality(value);
          try {
            window.localStorage.setItem(`${platform}_preferred_quality`, value);
          } catch {
            // ignore
          }
        }
      });

      linePluginRef.current = player.registerPlugin?.(LineControl, {
        position: POSITIONS.CONTROLS_RIGHT,
        index: 5.2,
        options: [...lineOptions],
        getCurrentKey: () => resolveCurrentLineFor(lineOptions, currentLine) ?? "",
        getCurrentLabel: () => {
          const key = resolveCurrentLineFor(lineOptions, currentLine);
          return lineOptions.find((o) => o.key === key)?.label ?? "线路";
        },
        onSelect: (lineKey: string) => {
          if (lineKey === currentLine) return;
          setCurrentLine(lineKey);
          persistLinePreference(platform, lineKey);
        }
      });

      arrangeControlClusters(player);

      // danmu overlay
      const overlay = createDanmuOverlay(player, danmuSettings, isDanmuEnabled) as DanmuOverlayInstance | null;
      danmuOverlayRef.current = overlay;
      try {
        applyDanmuOverlayPreferences?.(overlay, danmuSettings, isDanmuEnabled, player.root as any);
        syncDanmuEnabledState(overlay, danmuSettings, isDanmuEnabled, player.root as any);
      } catch {
        // ignore
      }

      await startDanmaku(overlay, platform, roomId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentLine, currentQuality, danmuSettings, isDanmuEnabled, lineOptions, platform, roomId, startDanmaku]
  );

  const reloadStream = useCallback(
    async (_trigger: "refresh" | "quality" | "line", overrides?: { quality?: string; line?: string | null }) => {
      if (reloadInFlightRef.current) {
        pendingReloadRef.current = { trigger: _trigger, overrides };
        return;
      }
      reloadInFlightRef.current = true;

      setIsLoadingStream(true);
      setStreamError(null);
      setIsOfflineError(false);
      setPlayerIsLive(null);
      setPlayerTitle(null);
      setPlayerAnchorName(null);
      setPlayerAvatar(null);

      const effectiveQuality = overrides?.quality ?? currentQuality;
      const effectiveLine = typeof overrides?.line !== "undefined" ? overrides.line : currentLine;

      destroyPlayer();
      await stopDanmakuBackend();
      if (platform === Platform.DOUYU) {
        await stopDouyuProxy();
      }

      try {
        await applyDanmuFontFamilyForOS();
      } catch {
        // ignore
      }

      try {
        if (platform === Platform.DOUYU) {
          const resolvedLine = resolveCurrentLineFor(lineOptions, effectiveLine);
          try {
            const info = await invoke<any>("fetch_douyu_room_info", { roomId });
            setPlayerTitle(info?.room_name ?? null);
            setPlayerAnchorName(info?.nickname ?? null);
            setPlayerAvatar(info?.avatar_url ?? null);
          } catch {
            // ignore meta fetch failures
          }
          const { streamUrl, streamType } = await getDouyuStreamConfig(roomId, effectiveQuality, resolvedLine);
          setPlayerIsLive(true);
          await mountPlayer(streamUrl, streamType);
        } else if (platform === Platform.DOUYIN) {
          const resp = await fetchAndPrepareDouyinStreamConfig(roomId, effectiveQuality);
          setPlayerTitle(resp.title ?? null);
          setPlayerAnchorName(resp.anchorName ?? null);
          setPlayerAvatar(resp.avatar ?? null);
          setPlayerIsLive(resp.isLive);
          if (!resp.streamUrl) throw new Error(resp.initialError || "主播未开播或无法获取直播流");
          await mountPlayer(resp.streamUrl, resp.streamType);
        } else if (platform === Platform.HUYA) {
          const resolvedLine = resolveCurrentLineFor(lineOptions, effectiveLine);
          const { streamUrl, streamType, title, anchorName, avatar, isLive } = await getHuyaStreamConfig(
            roomId,
            effectiveQuality,
            resolvedLine
          );
          setPlayerTitle(title ?? null);
          setPlayerAnchorName(anchorName ?? null);
          setPlayerAvatar(avatar ?? null);
          setPlayerIsLive(isLive ?? true);
          await mountPlayer(streamUrl, streamType);
        } else if (platform === Platform.BILIBILI) {
          const cookie = typeof localStorage !== "undefined" ? localStorage.getItem("bilibili_cookie") : null;
          try {
            const payload = { platform, args: { room_id_str: roomId } };
            const info = await invoke<any>("fetch_bilibili_streamer_info", { payload, cookie: cookie || null });
            setPlayerTitle(info?.title ?? null);
            setPlayerAnchorName(info?.anchor_name ?? null);
            setPlayerAvatar(info?.avatar ?? null);
          } catch {
            // ignore meta fetch failures
          }
          const { streamUrl, streamType } = await getBilibiliStreamConfig(roomId, effectiveQuality, cookie || undefined);
          setPlayerIsLive(true);
          await mountPlayer(streamUrl, streamType);
        }
      } catch (e: any) {
        const msg = e?.message ? String(e.message) : String(e);
        setStreamError(maybeAppendHevcInstallHint(msg));
        setIsOfflineError(isOfflineMessage(msg));
      } finally {
        setIsLoadingStream(false);
        reloadInFlightRef.current = false;
        const pending = pendingReloadRef.current;
        pendingReloadRef.current = null;
        if (pending) {
          void reloadStream(pending.trigger, pending.overrides);
        }
      }
    },
    [currentLine, currentQuality, destroyPlayer, lineOptions, mountPlayer, platform, roomId, stopDanmakuBackend]
  );

  useEffect(() => {
    reloadStreamRef.current = reloadStream;
  }, [reloadStream]);

  useEffect(() => {
    if (delayedStopTimerRef.current != null) {
      window.clearTimeout(delayedStopTimerRef.current);
      delayedStopTimerRef.current = null;
    }
    void reloadStream("refresh");
    return () => {
      // React StrictMode(dev) 会触发“卸载→立即重新挂载”，这里延迟 stop，避免误杀新连接。
      delayedStopTimerRef.current = window.setTimeout(() => {
        delayedStopTimerRef.current = null;
        void stopDanmakuBackend();
        if (platform === Platform.DOUYU) {
          void stopDouyuProxy();
        }
      }, 200);
      if (platform === Platform.DOUYU) {
        // proxy stop moved into delayed stop
      }
      destroyPlayer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, roomId]);

  useEffect(() => {
    // Keep danmu overlay + controls in sync
    import("@/components/player/danmuOverlay")
      .then((mod: any) => {
        mod.applyDanmuOverlayPreferences?.(danmuOverlayRef.current, danmuSettings, isDanmuEnabled, playerRef.current?.root as any);
        mod.syncDanmuEnabledState?.(danmuOverlayRef.current, danmuSettings, isDanmuEnabled, playerRef.current?.root as any);
      })
      .catch(() => {});

    try {
      persistDanmuPreferences({ enabled: isDanmuEnabled, settings: danmuSettings });
    } catch {
      // ignore
    }

    try {
      danmuTogglePluginRef.current?.setState?.(isDanmuEnabled);
      danmuSettingsPluginRef.current?.setSettings?.(danmuSettings);
    } catch {
      // ignore
    }
  }, [danmuSettings, isDanmuEnabled]);

  useEffect(() => {
    try {
      qualityPluginRef.current?.setOptions?.([...qualityOptions]);
      qualityPluginRef.current?.updateLabel?.(currentQuality);
      linePluginRef.current?.setOptions?.([...lineOptions]);
      linePluginRef.current?.updateLabel?.(lineOptions.find((o) => o.key === resolveCurrentLineFor(lineOptions, currentLine))?.label ?? "线路");
    } catch {
      // ignore
    }
  }, [currentLine, currentQuality, lineOptions]);

  useEffect(() => {
    // quality / line change triggers reload (debounced a bit)
    if (!qualityReloadArmedRef.current) {
      qualityReloadArmedRef.current = true;
      return;
    }
    const id = window.setTimeout(() => void reloadStream("quality"), 80);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuality, currentLine]);

  const followPayload = useMemo<FollowedStreamer>(() => {
    const fp: FollowPlatform =
      platform === Platform.DOUYU
        ? "DOUYU"
        : platform === Platform.DOUYIN
          ? "DOUYIN"
          : platform === Platform.HUYA
            ? "HUYA"
            : "BILIBILI";

    return {
      id: roomId,
      platform: fp,
      nickname: playerAnchorName || roomId,
      avatarUrl: playerAvatar || "",
      roomTitle: playerTitle || "",
      currentRoomId: roomId,
      liveStatus: "UNKNOWN"
    };
  }, [platform, playerAnchorName, playerAvatar, playerTitle, roomId]);

  return (
    <div className={`player-page${chromeHiddenClass}`} ref={pageRef}>
      <div className="player-layout">
        <div className="main-content">
          <div className="player-container player-container--solo">
            <div className="video-container">
              <div className="player-topbar">
                <div className="player-topbar-left">
                  <button
                    type="button"
                    className="player-close-btn"
                    title="关闭"
                    aria-label="关闭"
                    onClick={() => {
                      if (onRequestClose) onRequestClose();
                      else router.back();
                    }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>

                  <div className="player-topbar-streamer" title={playerTitle || roomId}>
                    <div className="player-topbar-avatar">
                      {playerAvatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={getAvatarSrc(platform, playerAvatar)} alt={playerAnchorName ?? roomId} />
                      ) : (
                        <div className="player-topbar-avatarFallback">{(playerAnchorName || roomId || "D").charAt(0).toUpperCase()}</div>
                      )}
                    </div>
                    <div className="player-topbar-meta">
                      <div className="player-topbar-title">{playerTitle || roomId}</div>
                      <div className="player-topbar-sub">
                        {playerAnchorName || "未知主播"} · ID:{roomId}
                      </div>
                    </div>
                    <div className={`player-topbar-status ${playerIsLive === false ? "is-offline" : "is-live"}`}>
                      {playerIsLive === false ? "未开播" : "直播中"}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className={`player-topbar-follow ${isFollowed ? "is-following" : ""}`}
                  onClick={() => {
                    if (isFollowed) follow.unfollowStreamer(followPayload.platform, followPayload.id);
                    else follow.followStreamer(followPayload);
                  }}
                >
                  {isFollowed ? "取关" : "关注"}
                </button>
              </div>

              <div ref={playerContainerRef} className="video-player" />

              {isLoadingStream ? (
                <div className="loading-player" style={{ position: "absolute", inset: 0, zIndex: 20 }}>
                  <div style={{ padding: 18, color: "var(--secondary-text)", fontWeight: 700 }}>加载中...</div>
                </div>
              ) : null}

              {streamError ? (
                <div className={isOfflineError ? "offline-player" : "error-player"} style={{ position: "absolute", inset: 0, zIndex: 20 }}>
                  <div style={{ padding: 18 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>{isOfflineError ? "主播未开播" : "加载失败"}</div>
                    <div style={{ color: "var(--secondary-text)", fontWeight: 600, whiteSpace: "pre-wrap" }}>{streamError}</div>
                    <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                      <button className="retry-btn" onClick={() => void reloadStream("refresh")}>
                        再试一次
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
