import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { api, type LivePlatform, type StreamInfo, type Streamer } from "@/api";
import { isFatalError, stripFatalPrefix } from "@/lib/errors";
import { loadRaw, saveRaw, STORAGE_KEYS } from "@/lib/storage";
import { prepareStreamRelay, supportsStreamRelay } from "@/lib/streamRelay";
import { BILIBILI_AUTH_EVENT } from "@/state/BilibiliAuthProvider";
import { DOUYU_AUTH_EVENT } from "@/state/DouyuAuthProvider";
import { useToast } from "@/state/ToastProvider";
import { useXgPlayer, type PlayerSource, type UseXgPlayerResult } from "./useXgPlayer";

export interface UseStreamControllerResult {
  info: StreamInfo | null;
  loadingInfo: boolean;
  infoError: string | null;
  offline: boolean;
  reconnecting: boolean;
  retryAttempt: number;
  variant: StreamInfo["variants"][number] | null;
  activeLineId: string;
  currentQualityLabel: string | null;
  player: UseXgPlayerResult;
  onQuality: (id: string) => void;
  onLine: (id: string) => void;
  reloadStream: () => void;
  manualReconnect: () => void;
}

/**
 * 直播流生命周期控制器：房间信息、中继续流、xgplayer 实例与断流两层自愈。
 */
export function useStreamController(
  platform: LivePlatform,
  roomId: string,
  playerHostRef: RefObject<HTMLDivElement | null>,
): UseStreamControllerResult {
  const { toast } = useToast();

  const roomOfflineRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const attemptedLinesRef = useRef<Set<string>>(new Set());

  const [info, setInfo] = useState<StreamInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [streamRevision, setStreamRevision] = useState(0);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);

  const [qualityId, setQualityId] = useState<string>(
    () => loadRaw(STORAGE_KEYS.playerQuality(platform), "source") || "source",
  );
  const [lineId, setLineId] = useState<string | null>(() => {
    const saved = loadRaw(STORAGE_KEYS.playerLine(platform), "");
    return saved || null;
  });

  const offline = Boolean(info && !info.isLive);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const stopReconnect = useCallback(() => {
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    setRetryAttempt(0);
    setReconnecting(false);
  }, [clearReconnectTimer]);

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

  const scheduleReconnect = useCallback(
    (immediate = false) => {
      if (!roomId || roomOfflineRef.current) return;
      const attempt = reconnectAttemptRef.current + 1;
      reconnectAttemptRef.current = attempt;
      setRetryAttempt(attempt);
      setReconnecting(true);

      const delay = immediate ? 0 : Math.min(30_000, 2_000 * 2 ** Math.min(attempt - 1, 4));
      clearReconnectTimer();
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        setReloadKey((key) => key + 1);
      }, delay);
    },
    [clearReconnectTimer, roomId],
  );

  const manualReconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    setRetryAttempt(0);
    scheduleReconnect(true);
  }, [scheduleReconnect]);

  /* 拉房间信息与取流地址 */
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

    api
      .getRoomInfo(platform, roomId)
      .then((room) => {
        if (cancelled || room.isLive) return;
        enterOffline(room);
      })
      .catch(() => {
        // 轻量检查失败不阻塞取流接口
      });

    api
      .getStreamInfo(platform, roomId, lineId)
      .then((next) => {
        if (cancelled) return;

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
        setStreamRevision((revision) => revision + 1);
      })
      .catch((err: unknown) => {
        if (cancelled || roomOfflineRef.current) return;
        const message = err instanceof Error ? err.message : "房间信息加载失败";
        setInfoError(stripFatalPrefix(message));
        if (!isFatalError(message)) scheduleReconnect();
      })
      .finally(() => {
        if (!cancelled) setLoadingInfo(false);
      });

    return () => {
      cancelled = true;
    };
  }, [platform, roomId, reloadKey, lineId, enterOffline, scheduleReconnect, stopReconnect]);

  const variant = useMemo(() => {
    if (!info) return null;
    return info.variants.find((v) => v.id === qualityId) ?? info.variants[0] ?? null;
  }, [info, qualityId]);

  const appliedVariant = useMemo(() => {
    if (!info || !variant || variant.appliedRate == null) return null;
    return info.variants.find((item) => item.id === String(variant.appliedRate)) ?? null;
  }, [info, variant]);

  const currentQualityLabel = variant
    ? (appliedVariant?.label ?? (variant.unconfirmed ? `未确认 · ${variant.label}` : null))
    : null;

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

  useEffect(() => {
    relayDisabledRef.current = "";
  }, [platform, roomId]);

  const relayReady = !relayKey || relay?.key === relayKey;
  const relayURL = relay?.key === relayKey ? (relay?.url ?? null) : null;

  const playerSource: PlayerSource | null = useMemo(() => {
    if (!info?.isLive || !relayReady) return null;
    if (relayURL) return { url: relayURL, format: "flv", nonce: streamRevision };
    if (variant) return { url: variant.url, format: variant.format, nonce: streamRevision };
    return null;
  }, [info?.isLive, relayReady, relayURL, streamRevision, variant]);

  const player = useXgPlayer(playerHostRef, playerSource, true);

  /* 未开播：每 30 秒自动刷新一次房间信息 */
  useEffect(() => {
    if (!info || info.isLive) return;
    const timer = window.setInterval(() => setReloadKey((k) => k + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [info]);

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
  }, [stopReconnect]);

  /* B 站 / 斗鱼登录、退出后重新取流 */
  useEffect(() => {
    const onAuthChanged = () => setReloadKey((k) => k + 1);
    window.addEventListener(DOUYU_AUTH_EVENT, onAuthChanged);
    window.addEventListener(BILIBILI_AUTH_EVENT, onAuthChanged);
    return () => {
      window.removeEventListener(DOUYU_AUTH_EVENT, onAuthChanged);
      window.removeEventListener(BILIBILI_AUTH_EVENT, onAuthChanged);
    };
  }, []);

  /* 换房间 / 离开页面时清掉重连定时器与换线记录 */
  useEffect(() => {
    stopReconnect();
    attemptedLinesRef.current = new Set();
  }, [platform, roomId, stopReconnect]);

  useEffect(() => () => clearReconnectTimer(), [clearReconnectTimer]);

  /* 播放恢复：清掉退避并提示 */
  useEffect(() => {
    if (player.state !== "playing") return;
    const wasReconnecting = reconnectAttemptRef.current > 0;
    stopReconnect();
    attemptedLinesRef.current = new Set();
    if (wasReconnecting) toast("直播已重新连接", "success");
  }, [player.state, stopReconnect, toast]);

  /* 加载 / 缓冲卡住太久视作断流 */
  useEffect(() => {
    if (offline || reconnecting || !info?.isLive) return;
    if (player.state !== "buffering" && player.state !== "loading") return;
    const delay = player.state === "buffering" ? 10_000 : 20_000;
    const timer = window.setTimeout(() => scheduleReconnect(), delay);
    return () => window.clearTimeout(timer);
  }, [player.state, offline, reconnecting, info?.isLive, scheduleReconnect]);

  /* 网络恢复时立刻重试 */
  useEffect(() => {
    const onOnline = () => {
      if (reconnectTimerRef.current != null || reconnectAttemptRef.current > 0) {
        scheduleReconnect(true);
      }
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [scheduleReconnect]);

  /* 播放错误的统一处理：中继回退 → 换线路 → 自动重连 */
  useEffect(() => {
    if (!player.errorNonce || roomOfflineRef.current) return;

    if (relayURL && info) {
      relayDisabledRef.current = info.roomId;
      setRelay({ key: relayKey, url: null });
      console.warn("[stream-relay] 中继播放失败，本房间回退直连");
      return;
    }

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

    scheduleReconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.errorNonce]);

  return {
    info,
    loadingInfo,
    infoError,
    offline,
    reconnecting,
    retryAttempt,
    variant,
    activeLineId,
    currentQualityLabel,
    player,
    onQuality,
    onLine,
    reloadStream,
    manualReconnect,
  };
}
