import { useState } from "react";
import { initial } from "@/lib/format";
import styles from "./SmoothImage.module.css";

interface SmoothImageProps {
  src: string;
  alt: string;
  className?: string;
  /** 加载失败/加载中是否用首字母占位（头像用 true） */
  rounded?: boolean;
  /** 占位色块用的种子，默认取 alt */
  seed?: string;
}

/**
 * 带淡入过渡的图片。
 *
 * 旧项目的 SmoothImage 有 60 行 CSS + 额外的 IntersectionObserver，
 * 但最常用场景（封面/头像）只需要"加载完成淡入 + 失败兜底"。
 * 这里去掉观察器（列表并不长），用 CSS 过渡即可。
 */
export function SmoothImage({ src, alt, className, rounded = false, seed }: SmoothImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span
        className={`${styles.fallback} ${rounded ? styles.rounded : ""} ${className ?? ""}`}
        aria-label={alt}
        role="img"
      >
        {initial(seed ?? alt)}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      draggable={false}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      className={`${styles.image} ${loaded ? styles.loaded : ""} ${rounded ? styles.rounded : ""} ${className ?? ""}`}
    />
  );
}
