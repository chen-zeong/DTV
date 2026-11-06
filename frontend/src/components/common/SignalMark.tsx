import { cn } from "@/lib/cn";
import styles from "./SignalMark.module.css";

const BARS = [0.42, 0.66, 1, 0.54];

/**
 * “信号”标记。
 *
 * 四根不等高竖条，既像电平表也像直播信号；用作品牌位、加载态和空态插画，
 * 比每个页面放一张不同插画更像一个产品（V-04 / C-01）。
 */
export function SignalMark({
  size = 20,
  animated = false,
  className,
}: {
  size?: number;
  animated?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(styles.mark, className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {BARS.map((height, index) => (
        <i
          key={index}
          className={cn(styles.bar, animated && styles.barPulse)}
          style={{
            height: `${Math.round(height * 100)}%`,
            animationDelay: animated ? `${index * 120}ms` : undefined,
          }}
        />
      ))}
    </span>
  );
}
