import styles from "./Spinner.module.css";

interface SpinnerProps {
  /** 直径（px），默认 22 */
  size?: number;
  className?: string;
}

/** 圆环加载指示器。替代旧项目里对 @heroui/react <Spinner> 的依赖。 */
export function Spinner({ size = 22, className }: SpinnerProps) {
  return (
    <span
      className={`${styles.ring} ${className ?? ""}`}
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 10)) }}
      role="progressbar"
      aria-label="加载中"
    />
  );
}
