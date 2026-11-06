import { cn } from "@/lib/cn";
import styles from "./RingProgress.module.css";

interface RingProgressProps {
  /** 进度，0~1（超出范围自动裁剪，NaN 当 0 处理） */
  value: number;
  /** 直径（px），默认 30（与侧栏操作按钮同宽） */
  size?: number;
  /** 圆环粗细（px），默认 2.5 */
  stroke?: number;
  className?: string;
  /** 读屏用的说明文字 */
  label?: string;
}

/**
 * 圆环进度条。
 *
 * 侧栏刷新按钮在刷新期间会用它套在 RotateCw 图标外面：图标照常转圈，
 * 圆环的弧长表示"已刷新 / 总数"。用 SVG stroke-dasharray 而不是
 * conic-gradient，是为了在 WebView2 下边缘更干净、也方便做圆头端点。
 */
export function RingProgress({
  value,
  size = 30,
  stroke = 2.5,
  className,
  label = "刷新进度",
}: RingProgressProps) {
  const safe = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  return (
    <svg
      className={cn(styles.root, className)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(safe * 100)}
    >
      <circle
        className={styles.track}
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={stroke}
      />
      <circle
        className={styles.indicator}
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - safe)}
      />
    </svg>
  );
}
