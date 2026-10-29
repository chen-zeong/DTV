import { useCallback, useEffect, useRef, useState } from "react";
import Player from "xgplayer";
import "xgplayer/dist/index.min.css";

export interface PlayerSource {
  url: string;
  format: "flv" | "hls";
}

export type PlayState = "loading" | "playing" | "paused" | "error";

export interface UseXgPlayerResult {
  state: PlayState;
  error: string | null;
  volume: number;
  togglePlay: () => void;
  setVolume: (v: number) => void;
  seekToLive: () => void;
}

/**
 * xgplayer 实例封装。
 *
 * 旧项目把"播放器实例 + 四平台拉流 + 7 个自定义插件 + 窗口拖拽 + chrome 自动隐藏"
 * 全塞在 1459 行的 MainPlayer 里，插件之间靠 ref 镜像互相读状态。
 * 这里只做一件事：按 source 创建/销毁实例，并把状态回调出去。
 * UI 控制条用自己的 React 组件（见 PlayerControls），不再往 xgplayer 里注册插件。
 */
export function useXgPlayer(
  containerRef: React.RefObject<HTMLDivElement | null>,
  source: PlayerSource | null,
  isLive = true,
): UseXgPlayerResult {
  const playerRef = useRef<Player | null>(null);
  const [state, setState] = useState<PlayState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolumeState] = useState(0.7);

  const url = source?.url ?? "";
  const format = source?.format ?? "hls";

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !url) return;

    let disposed = false;
    setState("loading");
    setError(null);

    void (async () => {
      let plugin: unknown = null;
      try {
        if (format === "flv") {
          const mod = await import("xgplayer-flv");
          plugin = mod.default;
        } else {
          const mod = await import("xgplayer-hls.js");
          plugin = mod.default;
        }
      } catch {
        // 插件缺失时退化为原生播放（HLS 在部分 WebView 里不支持，会走 error 分支）
      }
      if (disposed) return;

      const options: Record<string, unknown> = {
        el,
        url,
        isLive,
        autoplay: true,
        controls: false,
        lang: "zh",
        volume,
        autoplayMuted: false,
        closeVideoClick: true,
        closeVideoDblclick: false,
        screenShot: false,
        download: false,
      };
      if (plugin) options.plugins = [plugin];

      const player = new Player(options as unknown as ConstructorParameters<typeof Player>[0]);
      playerRef.current = player;

      player.on("playing", () => setState("playing"));
      player.on("pause", () => setState("paused"));
      player.on("error", () => {
        if (disposed) return;
        setError("流加载失败，可能已下播或线路不可用。");
        setState("error");
      });
    })();

    return () => {
      disposed = true;
      try {
        playerRef.current?.destroy();
      } catch {
        /* 忽略销毁异常 */
      }
      playerRef.current = null;
    };
    // volume 只在创建时用一次，后续由 setVolume 直接改实例
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, format, isLive]);

  const togglePlay = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (player.paused) void player.play();
    else player.pause();
  }, []);

  const setVolume = useCallback((v: number) => {
    const next = Math.min(1, Math.max(0, v));
    setVolumeState(next);
    const player = playerRef.current;
    if (player) {
      player.volume = next;
      try {
        player.muted = next === 0;
      } catch {
        /* 某些内核不支持直接改 muted */
      }
    }
  }, []);

  const seekToLive = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    void player.play();
  }, []);

  return { state, error, volume, togglePlay, setVolume, seekToLive };
}
