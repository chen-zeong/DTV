import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import styles from "./VolumeSlider.module.css";

/** 键盘微调步长（百分比） */
const STEP = 5;
/** Home / End 之外的粗调步长 */
const PAGE_STEP = 10;

interface VolumeSliderProps {
  /** 0 ~ 1 */
  value: number;
  onChange: (value: number) => void;
  className?: string;
  label?: string;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * 音量条：没有拖动手柄，按住滑条左右滑就行。
 *
 * 设计上刻意不画 thumb —— 控制栏空间很紧，一个滑条 + 一个百分比数字已经
 * 足够表达"当前音量"。交互上整条都是热区（高 18px，比 4px 的轨道好点），
 * 按下即跳转到该位置并开始拖动；松手、指针离开、失焦都会结束拖动。
 *
 * 键盘可访问：←/→ 微调 5%，PageUp/PageDown 调 10%，Home/End 到 0/100%。
 */
export function VolumeSlider({ value, onChange, className, label = "音量" }: VolumeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);

  const percent = Math.round(clamp01(value) * 100);

  const applyFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      // 取整到 1%：既避免"拖不动"的浮点抖动，也让百分比数字稳定
      onChange(Math.round(clamp01((clientX - rect.left) / rect.width) * 100) / 100);
    },
    [onChange],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      try {
        // 捕获指针：拖到控制栏外面也继续跟随（部分 WebView 会拒绝，忽略即可）
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // 忽略：没有捕获也能靠 pointermove 拖动
      }
      setDragging(true);
      applyFromClientX(event.clientX);
    },
    [applyFromClientX],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      applyFromClientX(event.clientX);
    },
    [applyFromClientX, dragging],
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setDragging(false);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // 指针已经释放时忽略
    }
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const current = clamp01(value);
      let next: number | null = null;
      switch (event.key) {
        case "ArrowLeft":
        case "ArrowDown":
          next = current - STEP / 100;
          break;
        case "ArrowRight":
        case "ArrowUp":
          next = current + STEP / 100;
          break;
        case "PageDown":
          next = current - PAGE_STEP / 100;
          break;
        case "PageUp":
          next = current + PAGE_STEP / 100;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      onChange(Math.round(clamp01(next) * 100) / 100);
    },
    [onChange, value],
  );

  return (
    <div
      ref={trackRef}
      className={cn(
        styles.slider,
        (dragging || hovering) && styles.active,
        dragging && styles.dragging,
        className,
      )}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent}%`}
      title={`${label} ${percent}%（按住左右拖动）`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={(event) => {
        setHovering(false);
        if (dragging) endDrag(event);
      }}
      onKeyDown={onKeyDown}
    >
      <div className={styles.rail}>
        <div className={styles.fill} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
