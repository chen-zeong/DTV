import { useCallback, useEffect, useRef, useState } from "react";
import Player from "xgplayer";
import "xgplayer/dist/index.min.css";
import { loadRaw, saveRaw, STORAGE_KEYS } from "@/lib/storage";

export interface PlayerSource {
  url: string;
  format: "flv" | "hls";
}

/**
 * 播放器状态。
 *
 * idle = 没有可播地址（未开播 / 还在等房间信息）：此时没有实例，
 * 任何"加载中"的 UI（比如刷新按钮转圈）都不应该出现。
 */
export type PlayState = "idle" | "loading" | "buffering" | "playing" | "paused" | "error";

export interface UseXgPlayerResult {
  state: PlayState;
  error: string | null;
  /** 每次真实的 error 事件 +1（用于"只自动换一条线"之类的逻辑） */
  errorNonce: number;
  volume: number;
  togglePlay: () => void;
  toggleMute: () => void;
  setVolume: (v: number) => void;
  /** 当前环境是否支持画中画小窗（不支持时不显示按钮） */
  pipSupported: boolean;
  /** 是否已经处于小窗状态 */
  pipActive: boolean;
  /** 进入 / 退出画中画小窗 */
  togglePip: () => void;
}

const DEFAULT_VOLUME = 0.7;
const VOLUME_KEY = STORAGE_KEYS.playerVolume;

/**
 * 把 `<video>` 收缩成「画面内容矩形」，把黑边让给舞台背景去画。
 *
 * 为什么必须这么做：xgplayer 默认让 video 元素铺满整个舞台，再用
 * `object-fit: contain` 在**元素内部**留黑边。WebView2 会把视频提升成硬件叠加
 * 平面（DirectComposition overlay），这块平面连同元素区域里的黑色一起盖在网页
 * 内容之上 —— 于是落在黑边里的弹幕被那层黑挡住：
 *   - 弹幕全在黑边里（画面上没内容压着视频）→ 浏览器放心用叠加平面 → 看不见；
 *   - 有弹幕压在画面上 / 玻璃胶囊的 backdrop-filter 在场 → 叠加平面用不了
 *     → 正常合成 → 黑边里的弹幕也看得见。
 * 元素只占画面矩形后，黑边由 `.stage` 自己的黑背景来画，那一层永远不会盖住弹幕。
 */
function updateVideoBox(host: HTMLElement, media: HTMLVideoElement): void {
  const viewWidth = media.videoWidth;
  const viewHeight = media.videoHeight;
  const hostWidth = host.clientWidth;
  const hostHeight = host.clientHeight;

  if (viewWidth <= 0 || viewHeight <= 0 || hostWidth <= 0 || hostHeight <= 0) {
    // 元数据/尺寸还没准备好：回到 CSS 兜底（铺满 + object-fit: contain）
    for (const prop of ["position", "inset", "margin", "width", "height"]) {
      media.style.removeProperty(prop);
    }
    return;
  }

  const scale = Math.min(hostWidth / viewWidth, hostHeight / viewHeight);
  // 用 inset + margin:auto 居中：不依赖 video 的直接父节点是谁、多大
  media.style.position = "absolute";
  media.style.inset = "0";
  media.style.margin = "auto";
  media.style.width = `${viewWidth * scale}px`;
  media.style.height = `${viewHeight * scale}px`;
}

function readVolume(): number {
  const raw = loadRaw(VOLUME_KEY, String(DEFAULT_VOLUME));
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_VOLUME;
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
  const [state, setState] = useState<PlayState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorNonce, setErrorNonce] = useState(0);
  const [volume, setVolumeState] = useState(readVolume);
  const lastVolumeRef = useRef(volume > 0 ? volume : DEFAULT_VOLUME);
  /** 画中画（小窗）：能力检测 + 状态同步 */
  const [pipSupported, setPipSupported] = useState(false);
  const [pipActive, setPipActive] = useState(false);

  const url = source?.url ?? "";
  const format = source?.format ?? "hls";

  /** 真正写实例音量 + 持久化 */
  const applyVolume = useCallback((next: number) => {
    const clamped = Math.min(1, Math.max(0, next));
    setVolumeState(clamped);
    if (clamped > 0) {
      lastVolumeRef.current = clamped;
      saveRaw(VOLUME_KEY, String(clamped));
    }
    const player = playerRef.current;
    if (player) {
      player.volume = clamped;
      try {
        player.muted = clamped === 0;
      } catch {
        /* 某些内核不支持直接改 muted */
      }
    }
    return clamped;
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !url) {
      // 没有可播地址（未开播）：回到 idle，避免"加载中"状态一直挂着
      if (!url) setState("idle");
      return;
    }

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    /** 画中画事件的清理函数（player 创建后才能确定 media 元素） */
    let detachPip: (() => void) | null = null;
    /** 画面矩形同步的清理函数 */
    let detachVideoBox: (() => void) | null = null;
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
        // 关键：xgplayer 的默认尺寸是 600×337.5（不是 100%）。
        // 不显式给百分比时，播放器只会占容器左上角约 1/4 的面积。
        width: "100%",
        height: "100%",
        // 舞台不再是固定 16:9：画面用 contain 自适应，宁可留黑边也不要拉伸变形
        videoFillMode: "contain",
        autoplay: true,
        controls: false,
        lang: "zh",
        volume,
        // 直播间默认有声音；不做"自动静音再试"的兜底。
        autoplayMuted: false,
        closeVideoClick: true,
        closeVideoDblclick: false,
        screenShot: false,
        download: false,
      };
      if (plugin) options.plugins = [plugin];

      const player = new Player(options as unknown as ConstructorParameters<typeof Player>[0]);
      playerRef.current = player;

      player.on("playing", () => {
        setState("playing");
        setError(null);
      });
      player.on("canplay", () => {
        setState((prev) => (prev === "loading" || prev === "buffering" ? "playing" : prev));
      });
      player.on("pause", () => setState((prev) => (prev === "error" ? prev : "paused")));
      // U-06：缓冲/卡顿时给出真实状态，不一直停在 playing
      player.on("waiting", () => setState((prev) => (prev === "error" ? prev : "buffering")));
      player.on("stalled", () => setState((prev) => (prev === "error" ? prev : "buffering")));
      player.on("error", () => {
        if (disposed) return;
        setError("流加载失败，可能已下播、线路不可用或平台风控。");
        setState("error");
        setErrorNonce((n) => n + 1);
      });

      // ------------------------------------------------ 画面矩形（去掉元素内黑边）
      // 让 <video> 元素正好等于"按比例缩放到容器里的那块画面"，黑边交给舞台背景。
      // 原因见 updateVideoBox 的注释：元素自己留黑边时，WebView2 的视频叠加平面
      // 会连黑边一起盖住网页内容，落在黑边里的弹幕就看不见了。
      const media = player.media as HTMLVideoElement | null;
      const syncVideoBox = () => {
        if (disposed || !media) return;
        updateVideoBox(el, media);
      };
      syncVideoBox();
      if (media) {
        const onLoaded = () => syncVideoBox();
        media.addEventListener("loadedmetadata", onLoaded);
        media.addEventListener("resize", onLoaded);
        media.addEventListener("playing", onLoaded);
        detachVideoBox = () => {
          media.removeEventListener("loadedmetadata", onLoaded);
          media.removeEventListener("resize", onLoaded);
          media.removeEventListener("playing", onLoaded);
        };
      }

      // 容器尺寸变化（侧栏折叠、进出全屏、窗口缩放）后重新贴合画面。
      // 没有这一步时，resize 之后 video 仍按旧尺寸渲染，画面会留黑边。
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          if (disposed) return;
          try {
            player.resize();
          } catch {
            /* 播放器销毁过程中 resize 可能抛错，忽略 */
          }
          syncVideoBox();
        });
        resizeObserver.observe(el);
      }

      // ------------------------------------------------ 画中画（小窗）
      // 用原生 Picture-in-Picture API：xgplayer 自带的 pip 插件底层也是它，
      // 但我们的控制栏是 React 自绘的，直接操作 media 更省事。
      const canPip =
        !!media &&
        typeof media.requestPictureInPicture === "function" &&
        document.pictureInPictureEnabled !== false;
      setPipSupported(canPip);
      if (canPip && media) {
        const onEnter = () => setPipActive(true);
        const onLeave = () => setPipActive(false);
        media.addEventListener("enterpictureinpicture", onEnter);
        media.addEventListener("leavepictureinpicture", onLeave);
        detachPip = () => {
          media.removeEventListener("enterpictureinpicture", onEnter);
          media.removeEventListener("leavepictureinpicture", onLeave);
        };
      }
    })();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      resizeObserver = null;
      detachPip?.();
      detachPip = null;
      detachVideoBox?.();
      detachVideoBox = null;
      setPipActive(false);
      setPipSupported(false);

      // 彻底停掉旧房间的播放器：pause + destroy + 摘掉 src。
      // 只靠 destroy 时，个别 WebView 会晚一帧才停掉音频/连接；
      // 切房间时就会出现"旧直播间还在响"的残留。
      const active = playerRef.current;
      const media = active?.media as HTMLVideoElement | null;
      try {
        active?.pause();
      } catch {
        /* 实例可能已销毁 */
      }
      try {
        active?.destroy();
      } catch {
        /* 忽略销毁异常 */
      }
      playerRef.current = null;
      if (media) {
        try {
          media.pause();
        } catch {
          /* ignore */
        }
        try {
          media.removeAttribute("src");
          media.load();
        } catch {
          /* 元素可能已被 destroy 移除 */
        }
      }
    };
    // volume 只在创建时用一次，后续由 applyVolume 直接改实例
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, format, isLive]);

  // 实例重建后重新套用当前音量（避免每个新房间都回到 0.7）
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.volume = volume;
    try {
      player.muted = volume === 0;
    } catch {
      /* ignore */
    }
  }, [url, volume]);

  const togglePlay = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (player.paused) void player.play();
    else player.pause();
  }, []);

  const setVolume = useCallback(
    (next: number) => {
      applyVolume(next);
    },
    [applyVolume],
  );

  const toggleMute = useCallback(() => {
    if (volume === 0) applyVolume(lastVolumeRef.current || DEFAULT_VOLUME);
    else applyVolume(0);
  }, [applyVolume, volume]);

  const togglePip = useCallback(() => {
    const media = playerRef.current?.media as HTMLVideoElement | null;
    if (!media || typeof media.requestPictureInPicture !== "function") return;
    void (async () => {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await media.requestPictureInPicture();
      } catch (error) {
        console.warn("[player] 小窗切换失败", error);
      }
    })();
  }, []);

  return {
    state,
    error,
    errorNonce,
    volume,
    togglePlay,
    toggleMute,
    setVolume,
    pipSupported,
    pipActive,
    togglePip,
  };
}
