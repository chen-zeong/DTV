import {
  MonitorOff,
  RotateCw,
  Star,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  api,
  PLATFORM_LABEL,
  type DanmakuMessage,
  type LivePlatform,
  type Streamer,
  type StreamInfo,
} from "@/api";
import { SmoothImage } from "@/components/common/SmoothImage";
import { SignalMark } from "@/components/common/SignalMark";
import { Modal } from "@/components/ui/Modal";
import { BilibiliLoginButton } from "@/features/bilibili/BilibiliLoginButton";
import { DouyuLoginButton } from "@/features/douyu/DouyuLoginButton";
import { DanmuOverlay } from "@/features/player/DanmuOverlay";
import {
  DanmuPanel,
  DEFAULT_PANEL_WIDTH,
  PANEL_WIDTH_MAX,
  PANEL_WIDTH_MIN,
} from "@/features/player/DanmuPanel";
import { PlayerCaptionButtons } from "@/features/player/PlayerCaptionButtons";
import { PlayerControls } from "@/features/player/PlayerControls";
import { isDanmuBlocked } from "@/features/player/danmuSettings";
import { useDanmuBlock } from "@/features/player/useDanmuBlock";
import { useDanmuPreferences } from "@/features/player/useDanmuPreferences";
import { useXgPlayer, type PlayerSource } from "@/features/player/useXgPlayer";
import { cn } from "@/lib/cn";
import { platformHomePath } from "@/lib/navigation";
import { loadJSON, loadRaw, saveJSON, saveRaw, STORAGE_KEYS } from "@/lib/storage";
import { prepareStreamRelay, supportsStreamRelay } from "@/lib/streamRelay";
import { exitWindowFullscreen, isWindowFullscreen, onWindowFullscreenChange } from "@/lib/window";
import { useFollow } from "@/state/FollowProvider";
import { BILIBILI_AUTH_EVENT } from "@/state/BilibiliAuthProvider";
import { DOUYU_AUTH_EVENT } from "@/state/DouyuAuthProvider";
import { usePlayerUi } from "@/state/PlayerUiProvider";
import { useToast } from "@/state/ToastProvider";
import styles from "./PlayerPage.module.css";

const MAX_MESSAGES = 300;
/** 弹幕缓冲刷新间隔：约 8Hz，既跟得上又不让每条消息都触发一次渲染 */
const MESSAGE_FLUSH_MS = 120;
/** 全屏下鼠标静止多久后自动隐藏悬浮的控制栏 / 主播信息 */
const CHROME_IDLE_MS = 2800;

/**
 * 弹幕接口里带平台原生颜色的平台。
 *
 * 对应 Go 侧 internal/platforms/{douyu,huya,bilibili}/danmaku.go 里的颜色解析；
 * 抖音的聊天弹幕不返回颜色（恒为白色），所以不显示"彩色弹幕"开关。
 */
const COLORFUL_DANMU_PLATFORMS: readonly LivePlatform[] = ["douyu", "huya", "bilibili"];

function parsePlatform(raw: string | null): LivePlatform {
  switch (raw) {
    case "huya":
    case "douyin":
    case "bilibili":
    case "douyu":
      return raw;
    default:
      return "douyu";
  }
}

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

/**
 * 是否有弹层正在打开（对话框 / 下拉菜单 / 右键菜单）。
 *
 * Escape 必须先交给弹层关闭自己，不能直接退出全屏或返回列表。
 * 玩家控制条里的弹层把自己的 Esc 监听改成了捕获阶段，
 * 所以这里直接 return 后，它们仍然能收到这一次按键。
 */
function hasOpenOverlay(): boolean {
  return Boolean(
    document.querySelector('[role="dialog"], [role="menu"], [class*="menuBackdrop"]'),
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ["Space / K", "播放 / 暂停"],
  ["F", "进入 / 退出全屏"],
  ["M", "静音 / 取消静音"],
  ["Esc", "退出全屏，或返回上一页"],
  ["?", "打开 / 关闭本说明"],
];

export function PlayerPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const platform = parsePlatform(params.get("platform"));
  const roomId = params.get("roomId") ?? "";

  const stageRef = useRef<HTMLDivElement>(null);
  const playerHostRef = useRef<HTMLDivElement>(null);
  /** 轻量房间信息已确认未开播：此时忽略取流接口的失败，避免覆盖成错误态 */
  const roomOfflineRef = useRef(false);
  /** 最近一次退出全屏的时间（Esc 可能先被浏览器/原生窗口消费，避免同一次按键又触发返回） */
  const lastFullscreenExitRef = useRef(0);
  /** 断流自动重连：定时器 / 连续失败次数 */
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);

  const {
    nativeFullscreen,
    cssFullscreen,
    setNativeFullscreen,
    setCssFullscreen,
    isFullscreen,
  } = usePlayerUi();
  const { isFollowing, toggleFollow } = useFollow();
  const { toast } = useToast();

  const [info, setInfo] = useState<StreamInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [infoError, setInfoError] = useState<string | null>(null);
  /** 重新拉取房间信息 / 取流地址；自动重连也靠它触发 */
  const [reloadKey, setReloadKey] = useState(0);
  const [danmuPanelOpen, setDanmuPanelOpen] = useState<boolean>(
    () => !loadJSON<boolean>(STORAGE_KEYS.danmuPanelCollapsed, false),
  );
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const raw = Number(loadRaw(STORAGE_KEYS.danmuPanelWidth, String(DEFAULT_PANEL_WIDTH)));
    return Number.isFinite(raw)
      ? Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, raw))
      : DEFAULT_PANEL_WIDTH;
  });
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  /* ---------------------------------------------------- 直播流断流自动重连 */
  /** 每次成功取流 +1：强制播放器重建（断流后即使 URL 没变也要换实例） */
  const [streamRevision, setStreamRevision] = useState(0);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  /** 当前是否已确认“主播未开播”；重连期间不再误判 */
  const offline = Boolean(info && !info.isLive);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  /** 停掉自动重连并恢复普通状态（成功播放 / 确认下播 / 离开房间时调用） */
  const stopReconnect = useCallback(() => {
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    setRetryAttempt(0);
    setReconnecting(false);
  }, [clearReconnectTimer]);

  /** 上游已确认未开播：落空态并停止重连 */
  const enterOffline = useCallback(
    (room?: Streamer) => {
      roomOfflineRef.current = true;
      stopReconnect();
      setInfo((prev) => {
        if (prev && !prev.isLive && !room) return prev;
        return {
          roomId: room?.id || prev?.roomId || roomId,
          platform,
          title: room?.title ?? prev?.title ?? "",
          nickname: room?.nickname ?? prev?.nickname ?? "",
          avatar: room?.avatar ?? prev?.avatar ?? "",
          isLive: false,
          variants: [],
          lines: [],
        };
      });
      setLoadingInfo(false);
    },
    [platform, roomId, stopReconnect],
  );

  /**
   * 安排一次重连。
   *
   * 指数退避 2s → 4s → 8s → 16s → 30s；重连动作只是重新拉房间信息 + 取流，
   * 新地址回来后 `streamRevision` 变化会强制重建播放器实例。
   */
  const scheduleReconnect = useCallback(
    (immediate = false) => {
      if (!roomId || roomOfflineRef.current) return;
      const attempt = reconnectAttemptRef.current + 1;
      reconnectAttemptRef.current = attempt;
      setRetryAttempt(attempt);
      setReconnecting(true);

      const delay = immediate
        ? 0
        : Math.min(30_000, 2_000 * 2 ** Math.min(attempt - 1, 4));
      clearReconnectTimer();
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        setReloadKey((key) => key + 1);
      }, delay);
    },
    [clearReconnectTimer, roomId],
  );

  /** 覆盖层里的「立即重连」：不等退避，马上重试 */
  const manualReconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    setRetryAttempt(0);
    scheduleReconnect(true);
  }, [scheduleReconnect]);

  /* ------------------------------------------- 悬浮 chrome 的自动隐藏（全屏） */
  const [chromeHidden, setChromeHidden] = useState(false);
  const [chromeHover, setChromeHover] = useState(false);
  const chromeIdleTimer = useRef<number | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (chromeIdleTimer.current != null) {
        window.clearTimeout(chromeIdleTimer.current);
        chromeIdleTimer.current = null;
      }
    };
    // 窗口模式保持常显：控制栏不再占布局高度，没必要让用户"找"按钮
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

  useEffect(() => {
    saveJSON(STORAGE_KEYS.danmuPanelCollapsed, !danmuPanelOpen);
  }, [danmuPanelOpen]);

  useEffect(() => {
    saveRaw(STORAGE_KEYS.danmuPanelWidth, String(panelWidth));
  }, [panelWidth]);

  const [qualityId, setQualityId] = useState<string>(() =>
    loadRaw(STORAGE_KEYS.playerQuality(platform), "source") || "source",
  );
  const [lineId, setLineId] = useState<string | null>(() => {
    const saved = loadRaw(STORAGE_KEYS.playerLine(platform), "");
    return saved || null;
  });
  const {
    enabled: danmuEnabled,
    settings: danmuSettings,
    setEnabled: setDanmuEnabled,
    updateSettings: updateDanmuSettings,
  } = useDanmuPreferences();

  /* 弹幕屏蔽词（关键词对所有平台生效，命中就整条丢掉） */
  const {
    keywords: blockKeywords,
    keywordsLower: blockKeywordsLower,
    addKeyword: addBlockKeyword,
    removeKeyword: removeBlockKeyword,
    clearKeywords: clearBlockKeywords,
  } = useDanmuBlock();
  /** 订阅回调里用 ref 读最新关键词，避免因为关键词变化而重建弹幕连接 */
  const blockKeywordsLowerRef = useRef<string[]>(blockKeywordsLower);
  blockKeywordsLowerRef.current = blockKeywordsLower;

  /* 弹幕：订阅回调先写缓冲区，定时批量 flush 到 state（P-04） */
  const [messages, setMessages] = useState<DanmakuMessage[]>([]);
  const bufferRef = useRef<DanmakuMessage[]>([]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (bufferRef.current.length === 0) return;
      const batch = bufferRef.current;
      bufferRef.current = [];
      setMessages((prev) => {
        const next = [...prev, ...batch];
        return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
      });
    }, MESSAGE_FLUSH_MS);
    return () => window.clearInterval(timer);
  }, []);

  /* ------------------------------------------------------------ 拉房间信息 */
  useEffect(() => {
    if (!roomId) {
      setLoadingInfo(false);
      setInfoError("缺少房间号");
      return;
    }
    let cancelled = false;
    roomOfflineRef.current = false;
    setLoadingInfo(true);
    setInfoError(null);

    // 先用一个轻量请求判断是否在播；未开播时可以立刻显示空态，不必等取流。
    api
      .getRoomInfo(platform, roomId)
      .then((room) => {
        if (cancelled || room.isLive) return;
        enterOffline(room);
      })
      .catch(() => {
        // 轻量检查失败不阻塞取流接口，由它给出最终结果或错误
      });

    api
      // 线路会决定后端用哪个 CDN 出流，所以线路变化时要重新解析一次取流地址。
      // 清晰度不需要：后端一次就把所有档位的 URL 都取回来了。
      .getStreamInfo(platform, roomId, lineId)
      .then((next) => {
        if (cancelled) return;

        // 断流后的“未开播”可能是上游瞬断：重连期间再问一次房间状态，
        // 只有两次都确认未开播才落到下播空态，避免网络抖动就误报“主播下线”。
        if (!next.isLive && !roomOfflineRef.current && reconnectAttemptRef.current > 0) {
          void api
            .getRoomInfo(platform, roomId)
            .then((room) => {
              if (cancelled) return;
              if (room.isLive) {
                scheduleReconnect();
                return;
              }
              enterOffline(room);
            })
            .catch(() => {
              if (!cancelled) scheduleReconnect();
            });
          return;
        }

        if (!next.isLive) {
          roomOfflineRef.current = true;
          stopReconnect();
        }
        setInfo(next);
        // 即使 URL 字符串完全没变，也换掉播放器实例：旧实例的 FLV 读取器
        // 已经结束，单靠 xgplayer.retry() 拉不回来。
        setStreamRevision((revision) => revision + 1);
      })
      .catch((err: unknown) => {
        if (cancelled || roomOfflineRef.current) return;
        setInfoError(err instanceof Error ? err.message : "房间信息加载失败");
        // 网络恢复前一直按退避重试；确认下播会由轻量检查 / 复核分支停掉。
        scheduleReconnect();
      })
      .finally(() => {
        if (!cancelled) setLoadingInfo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [platform, roomId, reloadKey, lineId, enterOffline, scheduleReconnect, stopReconnect]);

  /* ------------------------------------------------- 不再向 Navbar 推送主播信息 */
  // 产品要求：主播信息只出现在播放器自己的顶栏，应用导航栏保持干净。

  /* -------------------------------------------------------------- 弹幕订阅 */
  // P-05：依赖平台 + 房间号，而不是整个 info 对象。
  // 切线路时 info 会变成新对象，但房间没变，弹幕连接不应该重建。
  const infoPlatform = info?.platform;
  const infoRoomId = info?.roomId;
  useEffect(() => {
    if (!infoPlatform || !infoRoomId || !danmuEnabled) return;
    bufferRef.current = [];
    setMessages([]);
    const unsubscribe = api.subscribeDanmaku(infoPlatform, infoRoomId, (msg) => {
      // 屏蔽词在这里就拦掉：视频弹幕层和右侧弹幕列表都不该出现
      if (isDanmuBlocked(msg.content, blockKeywordsLowerRef.current)) return;
      // 正文保持原样（`[捂脸]` 这类文字表情由渲染层还原成图片，见 lib/emoticons.ts）
      const buffer = bufferRef.current;
      buffer.push(msg);
      // 极端高并发时先截断，避免缓冲区无限增长
      if (buffer.length > MAX_MESSAGES * 2) buffer.splice(0, buffer.length - MAX_MESSAGES);
    });
    return unsubscribe;
  }, [infoPlatform, infoRoomId, danmuEnabled]);

  /* ----------------------------------------------------------------- 播放 */
  const variant = useMemo(() => {
    if (!info) return null;
    return info.variants.find((v) => v.id === qualityId) ?? info.variants[0] ?? null;
  }, [info, qualityId]);

  /**
   * 当前实际画质：斗鱼会对匿名请求降级，请求“原画2K60”可能只下发“蓝光4M”。
   * 菜单保留平台原始档位名，当前选择按钮显示服务端确认的实际档位。
   */
  const appliedVariant = useMemo(() => {
    if (!info || !variant || variant.appliedRate == null) return null;
    return info.variants.find((item) => item.id === String(variant.appliedRate)) ?? null;
  }, [info, variant]);
  const currentQualityLabel = variant
    ? appliedVariant?.label ?? (variant.unconfirmed ? `未确认 · ${variant.label}` : null)
    : null;

  // U-06：未开播不拉流，避免无谓的重连与"流加载失败"
  /* ------------------------------------------------ 斗鱼续流（本地中继）
   * 斗鱼 flv 直链 300 秒后被 CDN 主动断开，交给 Go 侧中继在 FLV tag 边界接续。
   * 其它平台没有这个硬期限，继续直连（少一层中转、延迟更低）。 */
  const activeLineId = useMemo(() => {
    if (lineId && info?.lines.some((line) => line.id === lineId)) return lineId;
    return info?.lines[0]?.id ?? "";
  }, [info, lineId]);

  const relayTarget = useMemo(() => {
    if (!info || !info.isLive || !supportsStreamRelay(info.platform)) return null;
    return { roomId: info.roomId, quality: variant?.id ?? "", line: activeLineId };
  }, [activeLineId, info, variant]);
  const relayKey = relayTarget
    ? `${relayTarget.roomId}|${relayTarget.quality}|${relayTarget.line}`
    : "";
  const [relay, setRelay] = useState<{ key: string; url: string | null } | null>(null);
  /** 中继在本房间不可用时（极少见）标记一下，之后一律直连，避免反复试错 */
  const relayDisabledRef = useRef<string>("");

  useEffect(() => {
    if (!relayTarget || !relayKey) return;
    if (relayDisabledRef.current === relayTarget.roomId) {
      setRelay({ key: relayKey, url: null });
      return;
    }
    let cancelled = false;
    void prepareStreamRelay(relayTarget.roomId, relayTarget.quality, relayTarget.line).then(
      (url) => {
        if (!cancelled) setRelay({ key: relayKey, url });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [relayKey, relayTarget]);

  // 换房间时重新允许中继
  useEffect(() => {
    relayDisabledRef.current = "";
  }, [platform, roomId]);

  // 中继地址还没就绪时先不建播放器，避免"先直连再重建"导致闪一下
  const relayReady = !relayKey || relay?.key === relayKey;
  const relayURL = relay?.key === relayKey ? relay?.url ?? null : null;
  const playerSource: PlayerSource | null =
    info?.isLive && relayReady
      ? relayURL
        ? { url: relayURL, format: "flv", nonce: streamRevision }
        : variant
          ? { url: variant.url, format: variant.format, nonce: streamRevision }
          : null
      : null;
  const player = useXgPlayer(playerHostRef, playerSource, true);

  /* 未开播：每 30 秒自动刷新一次房间信息 */
  useEffect(() => {
    if (!info || info.isLive) return;
    const timer = window.setInterval(() => setReloadKey((k) => k + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [info]);

  /* ---------------------------------------------------- 播放失败自动换线 */
  const attemptedLinesRef = useRef<Set<string>>(new Set());

  const onQuality = useCallback(
    (id: string) => {
      setQualityId(id);
      saveRaw(STORAGE_KEYS.playerQuality(platform), id);
    },
    [platform],
  );

  const onLine = useCallback(
    (id: string) => {
      setLineId(id);
      saveRaw(STORAGE_KEYS.playerLine(platform), id);
      attemptedLinesRef.current = new Set();
    },
    [platform],
  );

  const reloadStream = useCallback(() => {
    stopReconnect();
    attemptedLinesRef.current = new Set();
    setReloadKey((k) => k + 1);
  }, [stopReconnect, setReloadKey]);

  /* B 站 / 斗鱼登录、退出后重新取流：登录态会改变服务端下发的清晰度档位。 */
  useEffect(() => {
    const onAuthChanged = () => setReloadKey((k) => k + 1);
    window.addEventListener(DOUYU_AUTH_EVENT, onAuthChanged);
    window.addEventListener(BILIBILI_AUTH_EVENT, onAuthChanged);
    return () => {
      window.removeEventListener(DOUYU_AUTH_EVENT, onAuthChanged);
      window.removeEventListener(BILIBILI_AUTH_EVENT, onAuthChanged);
    };
  }, []);

  /* ---------------------------------------------------- 直播流自愈（第二层）
   * 第一层是 xgplayer-flv / hls.js 自己的 chunk 重试；这里负责“地址失效”：
   * 重新拉房间信息 → 重新取流 → 用新的 streamRevision 重建播放器。 */

  /** 换房间 / 离开页面时清掉重连定时器与换线记录 */
  useEffect(() => {
    stopReconnect();
    attemptedLinesRef.current = new Set();
  }, [platform, roomId, stopReconnect]);

  useEffect(() => () => clearReconnectTimer(), [clearReconnectTimer]);

  /** 播放恢复：清掉退避；如果刚才在自动重连，给一次轻提示 */
  useEffect(() => {
    if (player.state !== "playing") return;
    const wasReconnecting = reconnectAttemptRef.current > 0;
    stopReconnect();
    attemptedLinesRef.current = new Set();
    if (wasReconnecting) toast("直播已重新连接", "success");
  }, [player.state, stopReconnect, toast]);

  /**
   * 加载 / 缓冲卡住太久时视作断流。
   *
   * 有些 CDN 断流不会触发 error，只是永远停在 loading / buffering；
   * 首次加载保留 20 秒，给握手、取流、首个关键帧和 8 秒预缓冲留余量；
   * 已经播放过再卡住则 10 秒就重建，避免用户盯着冻结画面等太久。
   */
  useEffect(() => {
    if (offline || reconnecting || !info?.isLive) return;
    if (player.state !== "buffering" && player.state !== "loading") return;
    const delay = player.state === "buffering" ? 10_000 : 20_000;
    const timer = window.setTimeout(() => scheduleReconnect(), delay);
    return () => window.clearTimeout(timer);
  }, [player.state, offline, reconnecting, info?.isLive, scheduleReconnect]);

  /** 网络恢复（系统从离线变在线）时不用等退避，立刻重试 */
  useEffect(() => {
    const onOnline = () => {
      if (reconnectTimerRef.current != null || reconnectAttemptRef.current > 0) {
        scheduleReconnect(true);
      }
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [scheduleReconnect]);

  /**
   * 播放错误的统一处理：中继回退 → 换线路 → 自动重连。
   *
   * 只依赖 errorNonce，保证每一次真实的 error 事件只处理一次；
   * info / 线路 / 中继地址的变化不会让这段逻辑重跑。
   */
  useEffect(() => {
    if (!player.errorNonce || roomOfflineRef.current) return;

    // 中继播放失败（端口被占、WebView 拒绝 http 本地地址等）时先回退直连。
    if (relayURL && info) {
      relayDisabledRef.current = info.roomId;
      setRelay({ key: relayKey, url: null });
      console.warn("[stream-relay] 中继播放失败，本房间回退直连");
      return;
    }

    // 还有没试过的线路：先换线。
    if (info && info.lines.length > 1) {
      const attempted = attemptedLinesRef.current;
      if (activeLineId) attempted.add(activeLineId);
      const next = info.lines.find((line) => !attempted.has(line.id));
      if (next) {
        toast(`线路不可用，已切换到「${next.label}」`, "info");
        setLineId(next.id);
        saveRaw(STORAGE_KEYS.playerLine(platform), next.id);
        return;
      }
    }

    // 所有线路都失败：进入自动重连（重新取流 + 重建播放器）。
    scheduleReconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.errorNonce]);

  /* ------------------------------------------------------------- 全屏同步 */
  /** 上一次同步到的原生 / DOM 全屏状态（用于识别“刚刚退出全屏”） */
  const wasFullscreenRef = useRef(false);
  const syncFullscreenState = useCallback(async () => {
    const windowFull = await isWindowFullscreen();
    const next = Boolean(document.fullscreenElement) || windowFull;
    if (wasFullscreenRef.current && !next) {
      // 浏览器 / 系统自己处理的 Esc 也会走到这里：记下退出时间，
      // 避免紧接着的同一次按键又被解释成“返回上一页”。
      lastFullscreenExitRef.current = Date.now();
    }
    wasFullscreenRef.current = next;
    setNativeFullscreen(next);
  }, [setNativeFullscreen]);

  /**
   * 统一退出所有全屏形态：DOM 全屏、样式全屏（窗口全屏）、Wails 原生窗口全屏。
   *
   * Esc 在 WebView2 里可能先被浏览器 / 原生窗口消费掉，fullscreenchange 与
   * 原生事件的到达顺序并不可靠。只靠事件回写 React 状态时，会出现
   * “窗口已经退出全屏、界面仍停在全屏布局”的假象（侧栏/顶栏不恢复）。
   * 所以这里先把三个状态一起落地为 false，再调用原生退出接口。
   */
  const exitPlayerFullscreen = useCallback(async () => {
    lastFullscreenExitRef.current = Date.now();
    setCssFullscreen(false);
    setNativeFullscreen(false);

    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        /* 已经退出，或当前没有可退出的全屏元素 */
      }
    }

    try {
      if (await isWindowFullscreen()) await exitWindowFullscreen();
    } catch {
      /* 窗口已经恢复正常，忽略 */
    }
  }, [setCssFullscreen, setNativeFullscreen]);

  useEffect(() => {
    void syncFullscreenState();
    const onFsChange = () => void syncFullscreenState();
    document.addEventListener("fullscreenchange", onFsChange);
    // 原生窗口全屏（Wails）没有 fullscreenchange 事件，靠原生事件 + 尺寸变化同步
    window.addEventListener("resize", onFsChange);
    const offWindowFullscreen = onWindowFullscreenChange(onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      window.removeEventListener("resize", onFsChange);
      offWindowFullscreen();
      // 离开播放页（切房间 / 返回列表）时把全屏一并收掉，
      // 避免下一间房挂载后窗口仍停在上一间房的全屏布局里。
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
  }, [exitPlayerFullscreen]);

  /* ------------------------------------------------- 窗口全屏（样式全屏）
   * 用西瓜播放器 cssFullscreen 的思路：只让播放器铺满**应用窗口**，
   * 不去动操作系统窗口 —— 这样 Win11 的任务栏依然可见、可点。
   * 真正的系统级全屏仍是右边那个「全屏」按钮（DOM Fullscreen API）。 */
  const onToggleWindowFullscreen = useCallback(() => {
    setCssFullscreen(!cssFullscreen);
  }, [cssFullscreen, setCssFullscreen]);

  /* 返回列表：若处于窗口全屏先退出，避免恢复应用外壳后仍占满屏幕 */
  const goBack = useCallback(async () => {
    await exitPlayerFullscreen();
    // 直接深链接 / 刷新后进入播放页时没有上一页可退，回到平台首页。
    if (location.key === "default") navigate(platformHomePath(platform));
    else navigate(-1);
  }, [exitPlayerFullscreen, location.key, navigate, platform]);

  /* ------------------------------------------------------------ 快捷键 */
  /**
   * 快捷键处理要读最新状态，但监听器不能跟着每次渲染重新注册。
   *
   * useXgPlayer 每次渲染都会返回新对象，如果把它放进依赖里，监听器会
   * “卸了再装”，排到弹层自己的 Esc 监听之后；弹层先关闭，外层就看不到
   * `[role="dialog"]`，于是同一次 Esc 又顺带退出全屏。
   * 值放进 ref，监听器只在挂载时注册一次，永远是这道 Escape 链上的第一个。
   */
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
        // 弹层优先：让弹层自己关掉（它们的 Esc 监听也在捕获阶段）。
        if (hasOpenOverlay()) return;
        // 全屏时 Esc 只负责退出全屏，绝不顺手把用户踢回列表。
        // document.fullscreenElement 覆盖 DOM 全屏，fullscreenActive 覆盖
        // 窗口全屏（cssFullscreen）和 Wails 原生全屏。
        if (document.fullscreenElement || fullscreenActive) {
          event.preventDefault();
          event.stopPropagation();
          void exitPlayerFullscreen();
          return;
        }
        // 原生事件可能晚到：再问一次窗口，是原生全屏就退出而不是返回。
        void isWindowFullscreen().then((fullscreen) => {
          if (fullscreen) {
            void exitPlayerFullscreen();
            return;
          }
          // Esc 刚刚已经退出过全屏（浏览器先消费了这一次按键）时，
          // 不要再把同一次按键解释成“返回上一页”。
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
    // 必须用捕获阶段：xgplayer 的全局键盘插件会在 document 上对 Escape
    // 调用 stopPropagation()，挂在 window 冒泡阶段的监听器根本收不到这个键
    //（空格、M、? 不受影响）。捕获阶段先拿到，Esc 才能可靠退出全屏。
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [exitPlayerFullscreen, navigate]);

  const followed = info ? isFollowing(info.platform, info.roomId) : false;
  const colorfulSupported = Boolean(
    info && COLORFUL_DANMU_PLATFORMS.includes(info.platform),
  );

  /* ------------------------------------------------------------------ 渲染 */
  if (!roomId) {
    return (
      <div className={styles.emptyState}>
        <p className={styles.emptyTitle}>未指定房间号</p>
        <p className={styles.emptyHint}>请从列表页进入直播间，或在顶栏搜索房间号</p>
        <button type="button" className={styles.primaryBtn} onClick={() => navigate("/")}>
          返回首页
        </button>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className="visually-hidden">{info ? `${info.nickname} 的直播间` : "直播间"}</h1>
      <div className={cn(styles.playerShell, isFullscreen && styles.shellFull)}>
        <div className={styles.playerBody}>
          <div className={styles.stageCol}>
            <div
              className={cn(styles.stage, chromeHidden && styles.stageIdle)}
              ref={stageRef}
            >
              <div className={styles.videoHost} ref={playerHostRef} />

              {/* 样式全屏时应用标题栏被隐藏：铺一层拖拽区，按住画面就能移动窗口。
                  它压在视频之上、chrome 之下，所以控制栏/按钮仍然可点。 */}
              {cssFullscreen && <div className={styles.dragRegion} aria-hidden="true" />}

              <DanmuOverlay
                messages={messages}
                enabled={danmuEnabled && !offline}
                settings={danmuSettings}
                colorfulSupported={colorfulSupported}
                platform={info?.platform ?? platform}
              />

              {/* ------------------------------------------- 悬浮 chrome 层
                  主播信息 + 控制条都盖在画面上（对齐老项目），不占布局高度；
                  全屏下鼠标静止后淡出，移动鼠标立刻回来。 */}
              <div
                className={cn(styles.chrome, chromeHidden && styles.chromeHidden)}
                onMouseEnter={() => setChromeHover(true)}
                onMouseLeave={() => setChromeHover(false)}
              >
                <div
                  className={cn(
                    styles.topbar,
                    (nativeFullscreen || cssFullscreen) && styles.topbarWithCaption,
                  )}
                >
                  <button
                    type="button"
                    className={styles.backBtn}
                    onClick={() => void goBack()}
                    aria-label="返回"
                    title="返回（Esc）"
                  >
                    <X size={19} strokeWidth={2.4} />
                  </button>

                  {info && (
                    <div className={styles.streamerPill}>
                      <span className={styles.pillAvatar}>
                        <SmoothImage src={info.avatar} alt={info.nickname} rounded />
                      </span>
                      <span className={styles.pillMeta}>
                        <span className={styles.pillTitle}>{info.title}</span>
                        <span className={styles.pillSub}>
                          {PLATFORM_LABEL[info.platform]} · {info.nickname} · ID:{info.roomId}
                        </span>
                      </span>
                      <span
                        className={cn(
                          styles.status,
                          info.isLive ? styles.statusLive : styles.statusOff,
                        )}
                      >
                        {info.isLive ? "直播中" : "未开播"}
                      </span>
                      <button
                        type="button"
                        className={cn(styles.followBtn, followed && styles.followBtnOn)}
                        onClick={() =>
                          toggleFollow({
                            id: info.roomId,
                            platform: info.platform,
                            nickname: info.nickname,
                            title: info.title,
                            avatar: info.avatar,
                            cover: "",
                            viewers: 0,
                            categoryName: "",
                            isLive: info.isLive,
                          })
                        }
                      >
                        <Star
                          size={14}
                          strokeWidth={2.4}
                          fill={followed ? "currentColor" : "none"}
                        />
                        {followed ? "已关注" : "关注"}
                      </button>
                      {info.platform === "bilibili" && (
                        <BilibiliLoginButton variant="compact" />
                      )}
                      {info.platform === "douyu" && (
                        <DouyuLoginButton variant="compact" />
                      )}
                    </div>
                  )}
                </div>

                {/* 系统全屏 / 窗口全屏下应用标题栏都被播放器盖住：把三个窗口按钮
                    搬到画面右上角，跟控制栏/主播信息一起淡出。两者视觉与行为完全一致。 */}
                {(nativeFullscreen || cssFullscreen) && (
                  <PlayerCaptionButtons className={styles.captionDock} />
                )}

                {info && (
                  <div className={styles.controlsDock}>
                    <PlayerControls
                      playState={player.state}
                      busy={loadingInfo || player.state === "loading"}
                      onTogglePlay={player.togglePlay}
                      onReload={reloadStream}
                      volume={player.volume}
                      onVolume={player.setVolume}
                      onToggleMute={player.toggleMute}
                      qualities={info.variants}
                      qualityId={variant?.id ?? ""}
                      qualityLabel={currentQualityLabel ?? undefined}
                      onQuality={onQuality}
                      lines={info.lines}
                      lineId={activeLineId}
                      onLine={onLine}
                      danmuEnabled={danmuEnabled}
                      onToggleDanmu={() => setDanmuEnabled(!danmuEnabled)}
                      danmuSettings={danmuSettings}
                      onDanmuSettingsChange={updateDanmuSettings}
                      colorfulSupported={colorfulSupported}
                      blockKeywords={blockKeywords}
                      onAddBlockKeyword={addBlockKeyword}
                      onRemoveBlockKeyword={removeBlockKeyword}
                      onClearBlockKeywords={clearBlockKeywords}
                      danmuPanelOpen={danmuPanelOpen}
                      onToggleDanmuPanel={() => setDanmuPanelOpen((open) => !open)}
                      pipSupported={player.pipSupported}
                      pipActive={player.pipActive}
                      onTogglePip={player.togglePip}
                      isFullscreen={nativeFullscreen}
                      cssFullscreen={cssFullscreen}
                      onToggleFullscreen={onToggleFullscreen}
                      onToggleWindowFullscreen={onToggleWindowFullscreen}
                      onHoverChange={setChromeHover}
                    />
                  </div>
                )}
              </div>

              {/* 状态覆盖层 */}
              {!offline && !reconnecting && (loadingInfo || player.state === "loading") && (
                <div className={styles.overlay}>
                  <SignalMark size={30} animated />
                  <p className={styles.overlayText}>正在拉取直播流…</p>
                </div>
              )}

              {!offline && reconnecting && (
                <div className={styles.overlay}>
                  <SignalMark size={30} animated />
                  <p className={styles.overlayTitle}>直播流连接中断</p>
                  <p className={styles.overlayText}>
                    正在进行第 {retryAttempt} 次自动重连，网络恢复后会继续播放
                  </p>
                  <button type="button" className={styles.primaryBtn} onClick={manualReconnect}>
                    <RotateCw size={13} strokeWidth={2.4} />
                    立即重连
                  </button>
                </div>
              )}

              {!offline && !reconnecting && player.state === "buffering" && (
                <div className={styles.buffering}>
                  <SignalMark size={14} animated />
                  缓冲中…
                </div>
              )}

              {offline && (
                <div className={styles.overlay}>
                  <span className={styles.offlineIcon} aria-hidden="true">
                    <MonitorOff size={26} strokeWidth={1.8} />
                  </span>
                  <p className={styles.overlayTitle}>主播暂时没有开播</p>
                  <p className={styles.overlayText}>开播后会自动加载，也可以手动刷新试试</p>
                  <button type="button" className={styles.primaryBtn} onClick={reloadStream}>
                    <RotateCw size={13} strokeWidth={2.4} />
                    立即刷新
                  </button>
                </div>
              )}

              {!offline && !reconnecting && (infoError || player.error) && (
                <div className={styles.overlay}>
                  <p className={styles.overlayText}>{infoError ?? player.error}</p>
                  {info && info.lines.length > 1 && (
                    <p className={styles.overlayHint}>已尝试自动切换线路，仍失败可手动换线</p>
                  )}
                  <button type="button" className={styles.primaryBtn} onClick={reloadStream}>
                    重试
                  </button>
                </div>
              )}
            </div>
          </div>

          {!isFullscreen && danmuPanelOpen && (
            <div className={styles.panelSlot}>
              <DanmuPanel
                messages={messages}
                onClose={() => setDanmuPanelOpen(false)}
                width={panelWidth}
                onWidthChange={setPanelWidth}
                platform={info?.platform ?? platform}
              />
            </div>
          )}
        </div>
      </div>

      {shortcutsOpen && (
        <Modal title="快捷键" onClose={() => setShortcutsOpen(false)} width={420}>
          <dl className={styles.shortcutList}>
            {SHORTCUTS.map(([key, action]) => (
              <div key={key} className={styles.shortcutRow}>
                <dt className={styles.shortcutKey}>{key}</dt>
                <dd className={styles.shortcutAction}>{action}</dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}
    </div>
  );
}
