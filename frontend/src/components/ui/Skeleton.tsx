import styles from "./Skeleton.module.css";

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
}

/** 骨架占位块。替代旧项目里对 @heroui/react <Skeleton> 的依赖。 */
export function Skeleton({ width = "100%", height = 16, radius = 8, className }: SkeletonProps) {
  return (
    <span
      className={`${styles.skeleton} ${className ?? ""}`}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}
