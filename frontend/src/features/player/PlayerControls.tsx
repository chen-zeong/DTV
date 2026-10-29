import { Maximize2, Minimize2, Pause, Play, Volume2, VolumeX, MessageSquare } from "lucide-react";
import type { LineOption, StreamVariant } from "@/api";
import { cn } from "@/lib/cn";
import type { PlayState } from "./useXgPlayer";
import styles from "./PlayerControls.module.css";

interface PlayerControlsProps {
  playState: PlayState;
  onTogglePlay: () => void;
  volume: number;
  onVolume: (v: number) => void;
  qualities: StreamVariant[];
  qualityId: string;
  onQuality: (id: string) => void;
  lines: LineOption[];
  lineId: string | null;
  onLine: (id: string) => void;
  danmuEnabled: boolean;
  onToggleDanmu: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

/**
 * 底部控制条。
 *
 * 旧版把控制条做成了 7 个 xgplayer 插件（refresh/volume/quality/line/danmu-toggle/
 * danmu-settings/danmu-block），再用 `controlLayout.ts` 在 DOM 后处理里把元素
 * 搬来搬去分组（硬编码 xgplayer 类名，升级即失效）。
 * 这里改成纯 React 组件：所有控件都是普通 DOM，样式与布局完全可控。
 */
export function PlayerControls(props: PlayerControlsProps) {
  const playing = props.playState === "playing";
  const muted = props.volume === 0;

  return (
    <div className={styles.bar}>
      <div className={styles.group}>
        <button
          type="button"
          className={styles.btn}
          onClick={props.onTogglePlay}
          aria-label={playing ? "暂停" : "播放"}
        >
          {playing ? <Pause size={18} strokeWidth={2.4} /> : <Play size={18} strokeWidth={2.4} />}
        </button>

        <button
          type="button"
          className={styles.btn}
          onClick={() => props.onVolume(muted ? 0.7 : 0)}
          aria-label={muted ? "取消静音" : "静音"}
        >
          {muted ? <VolumeX size={18} strokeWidth={2.4} /> : <Volume2 size={18} strokeWidth={2.4} />}
        </button>

        <input
          className={styles.volume}
          type="range"
          min={0}
          max={100}
          value={Math.round(props.volume * 100)}
          onChange={(e) => props.onVolume(Number(e.target.value) / 100)}
          aria-label="音量"
        />
      </div>

      <div className={styles.group}>
        <button
          type="button"
          className={cn(styles.btn, props.danmuEnabled && styles.btnActive)}
          onClick={props.onToggleDanmu}
          aria-label={props.danmuEnabled ? "关闭弹幕" : "打开弹幕"}
          aria-pressed={props.danmuEnabled}
        >
          <MessageSquare size={18} strokeWidth={2.4} />
        </button>

        <label className={styles.selectWrap}>
          <span className={styles.selectLabel}>清晰度</span>
          <select
            className={styles.select}
            value={props.qualityId}
            onChange={(e) => props.onQuality(e.target.value)}
          >
            {props.qualities.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label}
              </option>
            ))}
          </select>
        </label>

        {props.lines.length > 0 && props.lineId && (
          <label className={styles.selectWrap}>
            <span className={styles.selectLabel}>线路</span>
            <select
              className={styles.select}
              value={props.lineId}
              onChange={(e) => props.onLine(e.target.value)}
            >
              {props.lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          className={styles.btn}
          onClick={props.onToggleFullscreen}
          aria-label={props.isFullscreen ? "退出全屏" : "全屏"}
        >
          {props.isFullscreen ? (
            <Minimize2 size={18} strokeWidth={2.4} />
          ) : (
            <Maximize2 size={18} strokeWidth={2.4} />
          )}
        </button>
      </div>
    </div>
  );
}
