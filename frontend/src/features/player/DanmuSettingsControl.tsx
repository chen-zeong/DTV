import { Settings2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePortalHost } from "@/lib/portal";
import {
  DANMU_DURATION_MAX,
  DANMU_DURATION_MIN,
  DANMU_DURATION_STEP,
  DANMU_FONT_MAX,
  DANMU_FONT_MIN,
  DANMU_FONT_STEP,
  DANMU_OPACITY_MAX,
  DANMU_OPACITY_MIN,
  DANMU_OPACITY_STEP,
  formatDanmuArea,
  formatDanmuDuration,
  sanitizeDanmuFontSize,
  type DanmuUserSettings,
} from "./danmuSettings";
import { cn } from "@/lib/cn";
import styles from "./DanmuSettingsControl.module.css";

interface DanmuSettingsControlProps {
  settings: DanmuUserSettings;
  onChange: (patch: Partial<DanmuUserSettings>) => void;
  supportsColor?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function rangeFill(value: number, min: number, max: number): string {
  const percent = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return `linear-gradient(90deg, var(--player-accent) ${percent}%, rgba(255,255,255,0.15) ${percent}%)`;
}

/**
 * 控制栏里的弹幕设置入口（对齐 Tauri 老版）。
 *
 * 入口是纯图标；弹层是 17/20/28 的玻璃面板 + 原生 range/color 控件，
 * 结构、间距、数值显示与老版 xgplayer-danmu-settings-panel 一致。
 */
export function DanmuSettingsControl({
  settings,
  onChange,
  supportsColor = false,
  onOpenChange,
}: DanmuSettingsControlProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const portalHost = usePortalHost();
  const [pos, setPos] = useState<{
    left: number;
    bottom: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const setOpenState = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

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
      setOpenState(false);
    }, 220);
  }, [cancelClose, setOpenState]);

  const updatePosition = useCallback(() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 232;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const bottom = Math.max(8, window.innerHeight - rect.top + 10);
    const maxHeight = Math.max(220, Math.min(440, rect.top - 20));
    setPos({ left, bottom, width, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [open, updatePosition]);

  useEffect(() => {
    return () => cancelClose();
  }, [cancelClose]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpenState(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenState(false);
    };
    document.addEventListener("mousedown", onDown);
    // 捕获阶段：xgplayer 的全局键盘插件会在 document 上 stopPropagation，
    // 冒泡阶段收不到 Escape，弹层就关不掉。
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, setOpenState]);

  const fontSize = sanitizeDanmuFontSize(parseInt(settings.fontSize, 10) || 20);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpenState(!open)}
        onMouseEnter={() => {
          cancelClose();
          setOpenState(true);
        }}
        onMouseLeave={scheduleClose}
        aria-label="弹幕设置"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="弹幕设置"
      >
        <Settings2 size={16} strokeWidth={2} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className={styles.panel}
            role="dialog"
            aria-label="弹幕设置"
            style={{
              left: pos.left,
              bottom: pos.bottom,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div className={styles.shell}>
              <div className={styles.body}>
                <div className={styles.rowColor}>
                  <span className={styles.label}>颜色</span>
                  <input
                    className={styles.colorInput}
                    type="color"
                    value={settings.color}
                    onChange={(e) => onChange({ color: e.target.value })}
                    aria-label="弹幕颜色"
                  />
                </div>

                <div className={styles.rowColor}>
                  <span className={styles.label}>描边</span>
                  <input
                    className={styles.colorInput}
                    type="color"
                    value={settings.strokeColor}
                    onChange={(e) => onChange({ strokeColor: e.target.value })}
                    aria-label="弹幕描边颜色"
                  />
                </div>

                {supportsColor && (
                  <div className={styles.rowColor}>
                    <span className={styles.label} title="开启后使用平台自带的弹幕颜色">
                      彩色弹幕
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.colorful}
                      aria-label="彩色弹幕"
                      title="使用平台自带的弹幕颜色（关闭则统一用上面的文字颜色）"
                      className={cn(styles.switch, settings.colorful && styles.switchOn)}
                      onClick={() => onChange({ colorful: !settings.colorful })}
                    >
                      <span className={styles.switchThumb} />
                    </button>
                  </div>
                )}

                <div className={styles.row}>
                  <label>
                    字体 <span className={styles.value}>{`${fontSize}px`}</span>
                  </label>
                  <input
                    className={styles.range}
                    type="range"
                    min={DANMU_FONT_MIN}
                    max={DANMU_FONT_MAX}
                    step={DANMU_FONT_STEP}
                    value={fontSize}
                    style={{ background: rangeFill(fontSize, DANMU_FONT_MIN, DANMU_FONT_MAX) }}
                    onChange={(e) => onChange({ fontSize: `${sanitizeDanmuFontSize(Number(e.target.value))}px` })}
                  />
                </div>

                <div className={styles.row}>
                  <label>
                    速度 <span className={styles.value}>{formatDanmuDuration(settings.duration)}</span>
                  </label>
                  <input
                    className={styles.range}
                    type="range"
                    min={DANMU_DURATION_MIN}
                    max={DANMU_DURATION_MAX}
                    step={DANMU_DURATION_STEP}
                    value={settings.duration}
                    style={{
                      background: rangeFill(
                        settings.duration,
                        DANMU_DURATION_MIN,
                        DANMU_DURATION_MAX,
                      ),
                    }}
                    onChange={(e) => onChange({ duration: Number(e.target.value) })}
                  />
                </div>

                <div className={styles.row}>
                  <label>
                    显示区域 <span className={styles.value}>{formatDanmuArea(settings.area)}</span>
                  </label>
                  <input
                    className={styles.range}
                    type="range"
                    min={0.25}
                    max={1}
                    step={0.25}
                    value={settings.area}
                    style={{ background: rangeFill(settings.area, 0.25, 1) }}
                    onChange={(e) => onChange({ area: Number(e.target.value) })}
                  />
                </div>

                <div className={styles.row}>
                  <label>
                    透明度{" "}
                    <span className={styles.value}>{`${Math.round(settings.opacity * 100)}%`}</span>
                  </label>
                  <input
                    className={styles.range}
                    type="range"
                    min={DANMU_OPACITY_MIN}
                    max={DANMU_OPACITY_MAX}
                    step={DANMU_OPACITY_STEP}
                    value={settings.opacity}
                    style={{
                      background: rangeFill(
                        settings.opacity,
                        DANMU_OPACITY_MIN,
                        DANMU_OPACITY_MAX,
                      ),
                    }}
                    onChange={(e) => onChange({ opacity: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>
          </div>,
          portalHost,
        )}
    </div>
  );
}
