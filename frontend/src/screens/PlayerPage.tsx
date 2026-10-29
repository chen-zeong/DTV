import { ArrowLeft, RefreshCw, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  api,
  PLATFORM_LABEL,
  type DanmakuMessage,
  type LivePlatform,
  type StreamInfo,
} from "@/api";
import { SmoothImage } from "@/components/common/SmoothImage";
import { Spinner } from "@/components/ui/Spinner";
import { DanmuOverlay } from "@/features/player/DanmuOverlay";
import { DanmuPanel } from "@/features/player/DanmuPanel";
import { PlayerControls } from "@/features/player/PlayerControls";
import { useXgPlayer } from "@/features/player/useXgPlayer";
import { cn } from "@/lib/cn";
import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";
import { useFollow } from "@/state/FollowProvider";
import { usePlayerUi } from "@/state/PlayerUiProvider";
import styles from "./PlayerPage.module.css";

const MAX_MESSAGES = 300;

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

export function PlayerPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const platform = parsePlatform(params.get("platform"));
  const roomId = params.get("roomId") ?? "";

  const stageRef = useRef<HTMLDivElement>(null);
  const playerHostRef = useRef<HTMLDivElement>(null);

  const { setIsland, setFullscreen, isFullscreen } = usePlayerUi();
  const { isFollowing, toggleFollow } = useFollow();

  const [info, setInfo] = useState<StreamInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [infoError, setInfoError] = useState<string | null>(null);

  const [qualityId, setQualityId] = useState<string>(() =>
    loadJSON<string>(STORAGE_KEYS.playerQuality(platform), "source"),
  );
  const [lineId, setLineId] = useState<string | null>(() =>
    loadJSON<string | null>(STORAGE_KEYS.playerLine(platform), null),
  );
  const [danmuEnabled, setDanmuEnabled] = useState(true);
  const [messages, setMessages] = useState<DanmakuMessage[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  /* ------------------------------------------------------------ 拉房间信息 */
  useEffect(() => {
    if (!roomId) {
      setLoadingInfo(false);
      setInfoError("缺少房间号");
      return;
    }
    let cancelled = false;
    setLoadingInfo(true);
    setInfoError(null);
    api
      .getStreamInfo(platform, roomId)
      .then((next) => {
        if (cancelled) return;
        setInfo(next);
        setLineId((prev) =>
          prev && next.lines.some((l) => l.id === prev) ? prev : (next.lines[0]?.id ?? null),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setInfoError(err instanceof Error ? err.message : "房间信息加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoadingInfo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [platform, roomId, reloadKey]);

  /* ------------------------------------------------- 把当前主播推到 Navbar */
  useEffect(() => {
    if (!info) return;
    setIsland({
      platform: info.platform,
      roomId: info.roomId,
      nickname: info.nickname,
      title: info.title,
      avatar: info.avatar,
      isLive: info.isLive,
    });
    return () => setIsland(null);
  }, [info, setIsland]);

  /* -------------------------------------------------------------- 弹幕订阅 */
  useEffect(() => {
    if (!info || !danmuEnabled) return;
    setMessages([]);
    const unsubscribe = api.subscribeDanmaku(info.platform, info.roomId, (msg) => {
      setMessages((prev) => [...prev.slice(-(MAX_MESSAGES - 1)), msg]);
    });
    return unsubscribe;
  }, [info, danmuEnabled]);

  /* ----------------------------------------------------------------- 播放 */
  const variant = useMemo(() => {
    if (!info) return null;
    return info.variants.find((v) => v.id === qualityId) ?? info.variants[0] ?? null;
  }, [info, qualityId]);

  const player = useXgPlayer(playerHostRef, variant, true);

  const onQuality = useCallback(
    (id: string) => {
      setQualityId(id);
      saveJSON(STORAGE_KEYS.playerQuality(platform), id);
    },
    [platform],
  );

  const onLine = useCallback(
    (id: string) => {
      setLineId(id);
      saveJSON(STORAGE_KEYS.playerLine(platform), id);
    },
    [platform],
  );

  /* ------------------------------------------------------------- 全屏同步 */
  useEffect(() => {
    const onFsChange = () => {
      const active = Boolean(document.fullscreenElement);
      setFullscreen(active);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      setFullscreen(false);
    };
  }, [setFullscreen]);

  const onToggleFullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen().catch(() => undefined);
  };

  const followed = info ? isFollowing(info.platform, info.roomId) : false;

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
      <div className={styles.layout}>
        <div className={cn(styles.stageCol, isFullscreen && styles.stageFull)}>
          <div className={styles.stage} ref={stageRef}>
            <div className={styles.videoHost} ref={playerHostRef} />

            <DanmuOverlay messages={messages} enabled={danmuEnabled} />

            {/* 顶部信息条 */}
            <div className={styles.topbar}>
              <button
                type="button"
                className={styles.backBtn}
                onClick={() => navigate(-1)}
                aria-label="返回"
              >
                <ArrowLeft size={18} strokeWidth={2.4} />
              </button>

              {info && (
                <div className={styles.streamerPill}>
                  <span className={styles.pillAvatar}>
                    <SmoothImage src={info.avatar} alt={info.nickname} rounded />
                  </span>
                  <span className={styles.pillMeta}>
                    <span className={styles.pillTitle}>{info.title}</span>
                    <span className={styles.pillSub}>
                      {PLATFORM_LABEL[info.platform]} · {info.nickname}
                    </span>
                  </span>
                  <span className={cn(styles.status, info.isLive ? styles.statusLive : styles.statusOff)}>
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
                    <Star size={13} strokeWidth={2.4} fill={followed ? "currentColor" : "none"} />
                    {followed ? "已关注" : "关注"}
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => setReloadKey((k) => k + 1)}
                    aria-label="重新加载"
                  >
                    <RefreshCw size={15} strokeWidth={2.4} />
                  </button>
                </div>
              )}
            </div>

            {/* 状态覆盖层 */}
            {(loadingInfo || player.state === "loading") && (
              <div className={styles.overlay}>
                <Spinner size={40} />
                <p className={styles.overlayText}>正在拉取直播流…</p>
              </div>
            )}
            {(infoError || player.error) && (
              <div className={styles.overlay}>
                <p className={styles.overlayText}>{infoError ?? player.error}</p>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => setReloadKey((k) => k + 1)}
                >
                  重试
                </button>
              </div>
            )}

            {info && !isFullscreen && (
              <PlayerControls
                playState={player.state}
                onTogglePlay={player.togglePlay}
                volume={player.volume}
                onVolume={player.setVolume}
                qualities={info.variants}
                qualityId={variant?.id ?? ""}
                onQuality={onQuality}
                lines={info.lines}
                lineId={lineId}
                onLine={onLine}
                danmuEnabled={danmuEnabled}
                onToggleDanmu={() => setDanmuEnabled((v) => !v)}
                isFullscreen={isFullscreen}
                onToggleFullscreen={onToggleFullscreen}
              />
            )}
          </div>
        </div>

        {!isFullscreen && <DanmuPanel messages={messages} enabled={danmuEnabled} />}
      </div>
    </div>
  );
}
