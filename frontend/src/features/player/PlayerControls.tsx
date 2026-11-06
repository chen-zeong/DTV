import {
  Check,
  ChevronDown,
  Maximize,
  Maximize2,
  MessageSquare,
  MessageSquareOff,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  PictureInPicture2,
  Play,
  RotateCw,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LineOption, StreamVariant } from "@/api";
import { cn } from "@/lib/cn";
import { DanmuBlockControl } from "./DanmuBlockControl";
import { DanmuSettingsControl } from "./DanmuSettingsControl";
import { VolumeSlider } from "./VolumeSlider";
import type { DanmuUserSettings } from "./danmuSettings";
import type { PlayState } from "./useXgPlayer";
import styles from "./PlayerControls.module.css";

interface PlayerControlsProps {
  playState: PlayState;
  /**
   * 是否正在重新拉流。
   *
   * 单独一个开关而不是复用 playState：未开播时播放器根本没有实例，
   * playState 永远是 loading，刷新按钮会一直转圈。
   */
  busy?: boolean;
  onTogglePlay: () => void;
  /** 重新拉流（对应旧版控制条左侧的刷新按钮） */
  onReload: () => void;
  volume: number;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  qualities: StreamVariant[];
  qualityId: string;
  /**
   * 当前实际画质的显示名。
   *
   * 斗鱼会对匿名请求降级：请求"原画2K60"可能实际下发"蓝光4M"。
   * 菜单项保留平台原始名称，但当前选择按钮显示服务端确认的实际档位。
   */
  qualityLabel?: string;
  onQuality: (id: string) => void;
  lines: LineOption[];
  lineId: string | null;
  onLine: (id: string) => void;
  danmuEnabled: boolean;
  onToggleDanmu: () => void;
  danmuSettings: DanmuUserSettings;
  onDanmuSettingsChange: (patch: Partial<DanmuUserSettings>) => void;
  colorfulSupported: boolean;
  /** 弹幕屏蔽词 */
  blockKeywords: string[];
  onAddBlockKeyword: (keyword: string) => void;
  onRemoveBlockKeyword: (keyword: string) => void;
  onClearBlockKeywords: () => void;
  /** 右侧弹幕列表是否展开 */
  danmuPanelOpen: boolean;
  onToggleDanmuPanel: () => void;
  /** 画中画小窗：浏览器/WebView 不支持时不显示按钮 */
  pipSupported: boolean;
  pipActive: boolean;
  onTogglePip: () => void;
  /** 原生全屏（DOM Fullscreen API）状态 */
  isFullscreen: boolean;
  /** 样式全屏（铺满应用窗口、任务栏可见）状态 */
  cssFullscreen: boolean;
  onToggleFullscreen: () => void;
  onToggleWindowFullscreen: () => void;
  onHoverChange?: (hovering: boolean) => void;
}

/* ------------------------------------------------------------------ 下拉选择 */

interface MenuOption {
  id: string;
  label: string;
}

function ControlsDropdown({
  label,
  valueId,
  valueLabel,
  options,
  onSelect,
  onOpenChange,
}: {
  label: string;
  valueId: string;
  valueLabel: string;
  options: MenuOption[];
  onSelect: (id: string) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, 220);
  }, [cancelClose]);

  useEffect(() => {
    return () => cancelClose();
  }, [cancelClose]);

  useEffect(() => {
    onOpenChange?.(open);
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    // 捕获阶段：xgplayer 的全局键盘插件会在 document 上 stopPropagation，
    // 冒泡阶段收不到 Escape，下拉菜单就关不掉。
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onOpenChange]);

  if (options.length <= 1) {
    return (
      <span className={styles.staticControl}>
        <span>{valueLabel}</span>
      </span>
    );
  }

  return (
    <div
      className={styles.menuWrap}
      ref={wrapRef}
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className={cn(styles.controlItem, open && styles.menuOpen)}
        onClick={() => setOpen((value) => !value)}
        aria-label={`${label}：${valueLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>{valueLabel}</span>
        <ChevronDown size={10} className={cn(styles.caret, open && styles.caretOpen)} />
      </button>
      {open && (
        <div className={styles.dropdown} role="menu" aria-label={label}>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === valueId}
              className={cn(styles.dropdownItem, option.id === valueId && styles.dropdownItemActive)}
              onClick={() => {
                onSelect(option.id);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.id === valueId && <Check size={12} strokeWidth={1.8} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- 控制条本体 */

/**
 * 播放器底部控制台（对齐 Tauri 老版）。
 *
 * 左：播放 / 刷新 / 音量（一个 18px 圆角玻璃胶囊）
 * 右：弹幕开关 + 设置（另一个玻璃胶囊）、清晰度、线路、窗口全屏、全屏。
 */
export function PlayerControls(props: PlayerControlsProps) {
  const playing = props.playState === "playing";
  const loading = props.busy ?? props.playState === "loading";
  const muted = props.volume === 0;

  const qualityLabel =
    props.qualityLabel ??
    props.qualities.find((q) => q.id === props.qualityId)?.label ??
    "原画";
  const lineLabel = props.lines.find((l) => l.id === props.lineId)?.label ?? "线路";

  const VolumeIcon = muted ? VolumeX : props.volume < 0.5 ? Volume1 : Volume2;

  const onHoverChange = props.onHoverChange;
  const hoveringRef = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleEnter = useCallback(() => {
    hoveringRef.current = true;
    onHoverChange?.(true);
  }, [onHoverChange]);

  const handleLeave = useCallback(() => {
    hoveringRef.current = false;
    onHoverChange?.(menuOpen);
  }, [menuOpen, onHoverChange]);

  const handleMenuOpenChange = useCallback(
    (open: boolean) => {
      setMenuOpen(open);
      onHoverChange?.(hoveringRef.current || open);
    },
    [onHoverChange],
  );

  return (
    <div className={styles.dock} onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <div className={styles.bar}>
        {/* 左组：播放 / 刷新 / 音量 */}
        <div className={styles.leftCluster}>
          <button
            type="button"
            className={styles.iconControl}
            onClick={props.onTogglePlay}
            aria-label={playing ? "暂停" : "播放"}
            title={playing ? "暂停" : "播放"}
          >
            {playing ? (
              <Pause size={22} strokeWidth={2} fill="currentColor" />
            ) : (
              <Play size={22} strokeWidth={2} fill="currentColor" />
            )}
          </button>

          <button
            type="button"
            className={styles.iconControl}
            onClick={props.onReload}
            aria-label="重新加载"
            title="刷新"
          >
            <RotateCw
              size={19}
              strokeWidth={2}
              className={cn(loading && styles.spinning)}
            />
          </button>

          <div className={styles.volumeControl}>
            <button
              type="button"
              className={styles.volumeIcon}
              onClick={props.onToggleMute}
              aria-label={muted ? "取消静音" : "静音"}
              title="音量/静音切换"
            >
              <VolumeIcon size={19} strokeWidth={2} />
            </button>

            {/* 音量：没有拖动手柄，按住滑条左右滑就调音量 */}
            <VolumeSlider
              className={styles.volumeSlider}
              value={props.volume}
              onChange={props.onVolume}
            />
            <span className={styles.volumeValue}>{Math.round(props.volume * 100)}%</span>
          </div>
        </div>

        {/* 右组 */}
        <div className={styles.rightControls}>
          <div className={styles.danmuGroup}>
            {/* 弹幕开关：图标按钮，按下（开启）时用强调色高亮 */}
            <button
              type="button"
              className={cn(
                styles.iconControl,
                props.danmuEnabled && styles.iconControlActive,
              )}
              onClick={props.onToggleDanmu}
              aria-pressed={props.danmuEnabled}
              aria-label={props.danmuEnabled ? "关闭弹幕" : "开启弹幕"}
              title={props.danmuEnabled ? "关闭弹幕" : "开启弹幕"}
            >
              {props.danmuEnabled ? (
                <MessageSquare size={18} strokeWidth={2} fill="currentColor" fillOpacity={0.18} />
              ) : (
                <MessageSquareOff size={18} strokeWidth={2} />
              )}
            </button>

            <DanmuSettingsControl
              settings={props.danmuSettings}
              onChange={props.onDanmuSettingsChange}
              supportsColor={props.colorfulSupported}
              onOpenChange={handleMenuOpenChange}
            />

            <DanmuBlockControl
              keywords={props.blockKeywords}
              onAdd={props.onAddBlockKeyword}
              onRemove={props.onRemoveBlockKeyword}
              onClear={props.onClearBlockKeywords}
              onOpenChange={handleMenuOpenChange}
            />

            <button
              type="button"
              className={cn(
                styles.iconControl,
                styles.panelToggle,
                props.danmuPanelOpen && styles.iconControlActive,
              )}
              onClick={props.onToggleDanmuPanel}
              aria-pressed={props.danmuPanelOpen}
              aria-label={props.danmuPanelOpen ? "关闭弹幕列表" : "打开弹幕列表"}
              title={props.danmuPanelOpen ? "关闭弹幕列表" : "打开弹幕列表"}
            >
              {props.danmuPanelOpen ? (
                <PanelRightClose size={17} strokeWidth={2} />
              ) : (
                <PanelRightOpen size={17} strokeWidth={2} />
              )}
            </button>
          </div>

          <ControlsDropdown
            label="清晰度"
            valueId={props.qualityId}
            valueLabel={qualityLabel}
            options={props.qualities.map((q) => ({ id: q.id, label: q.label }))}
            onSelect={props.onQuality}
            onOpenChange={handleMenuOpenChange}
          />

          {props.lines.length > 1 && props.lineId && (
            <ControlsDropdown
              label="线路"
              valueId={props.lineId}
              valueLabel={lineLabel}
              options={props.lines.map((l) => ({ id: l.id, label: l.label }))}
              onSelect={props.onLine}
              onOpenChange={handleMenuOpenChange}
            />
          )}

          {props.pipSupported && (
            <button
              type="button"
              className={cn(styles.iconControl, props.pipActive && styles.iconControlActive)}
              onClick={props.onTogglePip}
              aria-label={props.pipActive ? "退出小窗" : "小窗播放"}
              title={props.pipActive ? "退出小窗" : "小窗播放"}
            >
              <PictureInPicture2 size={18} strokeWidth={2} />
            </button>
          )}

          <button
            type="button"
            className={cn(
              styles.iconControl,
              styles.windowFullscreenBtn,
              props.cssFullscreen && styles.iconControlActive,
            )}
            onClick={props.onToggleWindowFullscreen}
            aria-pressed={props.cssFullscreen}
            aria-label={props.cssFullscreen ? "退出窗口全屏" : "窗口全屏"}
            title={props.cssFullscreen ? "退出窗口全屏" : "窗口全屏"}
          >
            {props.cssFullscreen ? (
              <Minimize2 size={18} strokeWidth={2} />
            ) : (
              <Maximize size={18} strokeWidth={2} />
            )}
          </button>

          <button
            type="button"
            className={styles.iconControl}
            onClick={props.onToggleFullscreen}
            aria-label={props.isFullscreen ? "退出全屏" : "全屏"}
            title={props.isFullscreen ? "退出全屏" : "全屏"}
          >
            {props.isFullscreen ? (
              <Minimize2 size={18} strokeWidth={2} />
            ) : (
              <Maximize2 size={18} strokeWidth={2} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
