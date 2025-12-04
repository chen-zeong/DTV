"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Player from "xgplayer";
import FlvPlugin from "xgplayer-flv";
import HlsPlugin from "xgplayer-hls.js";
import "xgplayer/dist/index.min.css";
import { Loader2, RotateCw, AlertTriangle, Play, Pause, Maximize2, Minimize2 } from "lucide-react";
import DanmuJs from "danmu.js";
import { Platform } from "@/types/platform";
import { DanmakuMessage } from "@/types/danmaku";
import { DanmakuPanel } from "@/components/player/danmaku-panel";
import { getStreamConfig, startDanmaku, stopDanmaku, StreamConfig } from "@/services/streams";
import { cn } from "@/utils/cn";
import { useFollowStore } from "@/stores/follow-store";
import { platformSlugMap } from "@/utils/platform";
import Link from "next/link";
import { getLineLabel, getLineOptionsForPlatform, persistLinePreference, resolveStoredLine } from "@/types/line";

type PlayerViewProps = {
  platform: Platform;
  roomId: string;
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

export function PlayerView({ platform, roomId }: PlayerViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<Player | null>(null);
  const danmakuUnlistenRef = useRef<(() => void) | undefined>();
  const danmuOverlayRef = useRef<DanmuOverlayInstance | null>(null);
  const danmakuCountRef = useRef(0);

  const [quality, setQuality] = useState<(typeof qualityOptions)[number]>("原画");
  const [line, setLine] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamMeta, setStreamMeta] = useState<StreamConfig | null>(null);
  const [danmakuMessages, setDanmakuMessages] = useState<DanmakuMessage[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [danmakuEnabled, setDanmakuEnabled] = useState(true);
  const [danmakuOpacity, setDanmakuOpacity] = useState(0.8);
  const [danmakuFontSize, setDanmakuFontSize] = useState(14);
  const [volume, setVolume] = useState(0.7);
  const isFollowed = useFollowStore((s) => s.isFollowed);
  const followStreamer = useFollowStore((s) => s.followStreamer);
  const unfollowStreamer = useFollowStore((s) => s.unfollowStreamer);

  const title = useMemo(() => {
    if (streamMeta?.title) return streamMeta.title;
    return `${platform} - ${roomId}`;
  }, [streamMeta?.title, platform, roomId]);

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
  };

  const setupPlayer = (config: StreamConfig) => {
    if (!containerRef.current) {
      throw new Error("播放器容器不存在");
    }
    destroyPlayer();

    const isHls = config.streamType === "hls";
    const player = new Player({
      el: containerRef.current,
      url: config.streamUrl,
      isLive: true,
      autoplay: true,
      playsinline: true,
      lang: "zh-cn",
      height: "100%",
      width: "100%",
      videoFillMode: "contain",
      keyShortcut: true,
      cssFullscreen: { index: 2 },
      icons: {
        play: Play,
        pause: Pause,
        fullscreen: Maximize2,
        exitFullscreen: Minimize2,
        cssFullscreen: Maximize2,
        exitCssFullscreen: Minimize2,
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

    player.on("play", () => setIsPlaying(true));
    player.on("pause", () => setIsPlaying(false));
    playerRef.current = player;
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
      overlay.setOpacity?.(danmakuEnabled ? danmakuPanelOpacity : 0);
      overlay.setFontSize?.(danmakuFontSize);
      overlay.setArea?.({ start: 0, end: 0.8 });
      overlay.setAllDuration?.("scroll", 12000);
      danmuOverlayRef.current = overlay;
      danmakuCountRef.current = danmakuMessages.length;
    } catch (error) {
      console.error("[player] 初始化弹幕层失败", error);
    }
  };

  const initStream = async () => {
    setLoading(true);
    setError(null);
    setDanmakuMessages([]);
    try {
      const cfg = await getStreamConfig(platform, roomId, quality, line ?? undefined);
      setStreamMeta(cfg);
      setupPlayer(cfg);

    } catch (e) {
      const err = e as Error;
      setError(err.message || "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void initStream();
    return () => {
      destroyPlayer();
      void stopDanmaku(platform, roomId, danmakuUnlistenRef.current);
      danmakuUnlistenRef.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, roomId, quality, line]);

  const handleRetry = () => void initStream();

  const danmakuPanelOpacity = useMemo(() => {
    return Math.min(1, Math.max(0.3, danmakuOpacity));
  }, [danmakuOpacity]);

  useEffect(() => {
    setLine(resolveStoredLine(platform));
  }, [platform]);

  useEffect(() => {
    if (line) persistLinePreference(platform, line);
  }, [line, platform]);

  useEffect(() => {
    // restore quality preference
    const key = `quality_${platform}`;
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem(key) as (typeof qualityOptions)[number] | null;
      if (saved && qualityOptions.includes(saved as (typeof qualityOptions)[number])) {
        setQuality(saved as (typeof qualityOptions)[number]);
      }
    }
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

  // manage danmaku listener when toggle/platform/room changes
  useEffect(() => {
    let cancelled = false;
    const manageDanmaku = async () => {
      // stop existing
      if (danmakuUnlistenRef.current) {
        try {
          danmakuUnlistenRef.current();
        } catch (e) {
          console.warn("[player] stop danmaku unlisten failed", e);
        }
        danmakuUnlistenRef.current = undefined;
      }
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
        } else if (unlisten) {
          try {
            unlisten();
          } catch (e) {
            console.warn("[player] cleanup danmaku listener", e);
          }
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

  // push new messages into danmu.js overlay
  useEffect(() => {
    const overlay = danmuOverlayRef.current;
    if (!overlay) {
      danmakuCountRef.current = danmakuMessages.length;
      return;
    }
    if (!danmakuEnabled) {
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
        txt: `${msg.nickname}: ${msg.content}`,
        duration: 12000,
        mode: "scroll",
        style: {
          color: msg.color || "#fff",
          "--danmu-stroke-color": "#222",
        },
      });
    });
  }, [danmakuMessages, danmakuEnabled]);

  // sync overlay opacity/font size when settings change
  useEffect(() => {
    const overlay = danmuOverlayRef.current;
    if (!overlay) return;
    overlay.setOpacity?.(danmakuEnabled ? danmakuPanelOpacity : 0);
  }, [danmakuEnabled, danmakuPanelOpacity]);

  useEffect(() => {
    const overlay = danmuOverlayRef.current;
    if (!overlay) return;
    overlay.setFontSize?.(danmakuFontSize);
  }, [danmakuFontSize]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-zinc-950 to-gray-900 text-white flex flex-col md:flex-row gap-4 p-4">
      <div className="flex-1 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-gray-400">{platform}</p>
            <h1 className="text-2xl font-semibold">{title}</h1>
            {streamMeta?.anchorName && <p className="text-sm text-gray-400">{streamMeta.anchorName}</p>}
          </div>
          <div className="flex items-center gap-3 flex-wrap justify-end">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">{getLineLabel(getLineOptionsForPlatform(platform), line)}</span>
              <select
                className="bg-white/10 border border-white/10 rounded-lg px-3 py-1 text-sm"
                value={line ?? ""}
                onChange={(e) => setLine(e.target.value || null)}
              >
                {getLineOptionsForPlatform(platform).map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              className={cn(
                "px-3 py-2 rounded-full border text-sm transition-colors",
                danmakuEnabled ? "border-white/30 text-white bg-white/10" : "border-white/10 text-gray-400"
              )}
              onClick={() => setDanmakuEnabled((v) => !v)}
            >
              {danmakuEnabled ? "弹幕开" : "弹幕关"}
            </button>
            <button
              className={cn(
                "px-4 py-2 rounded-full border text-sm transition-colors",
                isFollowed(platform, roomId)
                  ? "border-emerald-500/60 text-emerald-100 bg-emerald-500/10 hover:bg-emerald-500/20"
                  : "border-white/20 text-white hover:bg-white/10"
              )}
              onClick={() => {
                if (isFollowed(platform, roomId)) {
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
            >
              {isFollowed(platform, roomId) ? "已关注" : "关注"}
            </button>
            <select
              className="bg-white/10 border border-white/10 rounded-lg px-3 py-1 text-sm"
              value={quality}
              onChange={(e) => setQuality(e.target.value as (typeof qualityOptions)[number])}
            >
              {qualityOptions.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black aspect-video">
          <div ref={containerRef} className="w-full h-full" />
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 backdrop-blur-sm">
              <Loader2 className="w-7 h-7 animate-spin" />
              <p className="text-sm text-gray-300">加载直播流...</p>
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm text-center px-4">
              <AlertTriangle className="w-8 h-8 text-amber-400" />
              <p className="text-sm text-gray-200">{error}</p>
              <button
                onClick={handleRetry}
                className="px-4 py-2 rounded-full border border-white/20 bg-white/10 hover:bg-white/20 transition-colors text-sm flex items-center gap-2"
              >
                <RotateCw className="w-4 h-4" /> 再试一次
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="w-full md:w-[360px] flex flex-col gap-3">
        <div className="space-y-2">
          <DanmakuPanel
            messages={danmakuMessages}
            className="transition-opacity"
            style={{ opacity: danmakuPanelOpacity, fontSize: `${danmakuFontSize}px` }}
          />
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>弹幕透明度/字号</span>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0.3}
                max={1}
                step={0.05}
                value={danmakuOpacity}
                onChange={(e) => setDanmakuOpacity(parseFloat(e.target.value))}
                className="w-32 accent-white"
              />
              <input
                type="range"
                min={10}
                max={28}
                step={1}
                value={danmakuFontSize}
                onChange={(e) => setDanmakuFontSize(parseInt(e.target.value, 10))}
                className="w-32 accent-white"
              />
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>音量</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-40 accent-white"
            />
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-lg text-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-[0.2em] text-gray-400">状态</span>
            <span
              className={cn(
                "px-3 py-1 rounded-full text-xs border",
                isPlaying ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-200" : "bg-gray-500/20 border-gray-400/30 text-gray-200"
              )}
            >
              {isPlaying ? "播放中" : "暂停"}
            </span>
          </div>
          <div className="space-y-1 text-gray-300">
            <div>房间：{roomId}</div>
            <div>画质：{quality}</div>
            <div>线路：默认</div>
            {streamMeta?.streamUrl && (
              <div className="text-[12px] text-gray-500 break-all leading-relaxed">URL: {streamMeta.streamUrl}</div>
            )}
            <div className="text-xs text-gray-500">
              <span>平台入口：</span>
              <Link
                className="underline hover:text-white"
                href={`/${platformSlugMap[platform]}`}
              >
                {platformSlugMap[platform]}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
