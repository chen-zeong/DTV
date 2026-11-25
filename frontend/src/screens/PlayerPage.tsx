import { MonitorOff, RotateCw, Star, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PLATFORM_LABEL, type LivePlatform } from "@/api";
import { SmoothImage } from "@/components/common/SmoothImage";
import { SignalMark } from "@/components/common/SignalMark";
import { Modal } from "@/components/ui/Modal";
import { BilibiliLoginButton } from "@/features/bilibili/BilibiliLoginButton";
import { DouyuLoginButton } from "@/features/douyu/DouyuLoginButton";
import { DanmuOverlay } from "@/features/player/DanmuOverlay";
import {
  BoundDanmuPanel,
  DEFAULT_PANEL_WIDTH,
  PANEL_WIDTH_MAX,
  PANEL_WIDTH_MIN,
} from "@/features/player/DanmuPanel";
import { PlayerCaptionButtons } from "@/features/player/PlayerCaptionButtons";
import { PlayerControls } from "@/features/player/PlayerControls";
import { useDanmakuFeed } from "@/features/player/danmakuFeed";
import { useDanmuBlock } from "@/features/player/useDanmuBlock";
import { useDanmuPreferences } from "@/features/player/useDanmuPreferences";
import { usePlayerFullscreen } from "@/features/player/usePlayerFullscreen";
import { useStreamController } from "@/features/player/useStreamController";
import { cn } from "@/lib/cn";
import { ensureGenericEmoticons } from "@/lib/emoticons";
import { loadJSON, loadRaw, saveJSON, saveRaw, STORAGE_KEYS } from "@/lib/storage";
import { useFollow } from "@/state/FollowProvider";
import styles from "./PlayerPage.module.css";

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
  const platform = parsePlatform(params.get("platform"));
  const roomId = params.get("roomId") ?? "";

  const stageRef = useRef<HTMLDivElement>(null);
  const playerHostRef = useRef<HTMLDivElement>(null);

  const { isFollowing, toggleFollow } = useFollow();

  const [danmuPanelOpen, setDanmuPanelOpen] = useState<boolean>(
    () => !loadJSON<boolean>(STORAGE_KEYS.danmuPanelCollapsed, false),
  );
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const raw = Number(loadRaw(STORAGE_KEYS.danmuPanelWidth, String(DEFAULT_PANEL_WIDTH)));
    return Number.isFinite(raw)
      ? Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, raw))
      : DEFAULT_PANEL_WIDTH;
  });

  useEffect(() => {
    saveJSON(STORAGE_KEYS.danmuPanelCollapsed, !danmuPanelOpen);
  }, [danmuPanelOpen]);

  useEffect(() => {
    saveRaw(STORAGE_KEYS.danmuPanelWidth, String(panelWidth));
  }, [panelWidth]);

  useEffect(() => {
    // 进入播放页后在后台异步载入通用表情兜底表，不阻塞播放页首帧脚本解析
    void ensureGenericEmoticons();
  }, []);

  const {
    enabled: danmuEnabled,
    settings: danmuSettings,
    setEnabled: setDanmuEnabled,
    updateSettings: updateDanmuSettings,
  } = useDanmuPreferences();

  const {
    keywords: blockKeywords,
    keywordsLower: blockKeywordsLower,
    addKeyword: addBlockKeyword,
    removeKeyword: removeBlockKeyword,
    clearKeywords: clearBlockKeywords,
  } = useDanmuBlock();

  const {
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
  } = useStreamController(platform, roomId, playerHostRef);

  const {
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
  } = usePlayerFullscreen(platform, stageRef, player);

  /* 弹幕订阅独立在 DanmakuFeed 中，切线路不重建连接，消息到来不重渲染 PlayerPage */
  const danmuFeed = useDanmakuFeed(
    info?.platform,
    info?.roomId,
    danmuEnabled,
    blockKeywordsLower,
  );

  const handleToggleDanmu = useCallback(
    () => setDanmuEnabled(!danmuEnabled),
    [danmuEnabled, setDanmuEnabled],
  );
  const handleToggleDanmuPanel = useCallback(
    () => setDanmuPanelOpen((open) => !open),
    [],
  );
  const handleCloseDanmuPanel = useCallback(() => setDanmuPanelOpen(false), []);

  const followed = info ? isFollowing(info.platform, info.roomId) : false;
  const colorfulSupported = Boolean(
    info && COLORFUL_DANMU_PLATFORMS.includes(info.platform),
  );

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

              {cssFullscreen && <div className={styles.dragRegion} aria-hidden="true" />}

              <DanmuOverlay
                feed={danmuFeed}
                enabled={danmuEnabled && !offline}
                settings={danmuSettings}
                colorfulSupported={colorfulSupported}
                platform={info?.platform ?? platform}
              />

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
                      onToggleDanmu={handleToggleDanmu}
                      danmuSettings={danmuSettings}
                      onDanmuSettingsChange={updateDanmuSettings}
                      colorfulSupported={colorfulSupported}
                      blockKeywords={blockKeywords}
                      onAddBlockKeyword={addBlockKeyword}
                      onRemoveBlockKeyword={removeBlockKeyword}
                      onClearBlockKeywords={clearBlockKeywords}
                      danmuPanelOpen={danmuPanelOpen}
                      onToggleDanmuPanel={handleToggleDanmuPanel}
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
              <BoundDanmuPanel
                feed={danmuFeed}
                onClose={handleCloseDanmuPanel}
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
