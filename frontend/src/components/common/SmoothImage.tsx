import { useEffect, useState } from "react";
import {
  ensureImageProxy,
  getImageProxyBase,
  normalizeImageSource,
  proxiedImageURL,
} from "@/lib/imageProxy";
import { initial } from "@/lib/format";
import styles from "./SmoothImage.module.css";

type ProxyState = "pending" | "ready" | "failed";

interface SmoothImageProps {
  src: string;
  alt: string;
  className?: string;
  /** 加载失败/加载中是否用首字母占位（头像用 true） */
  rounded?: boolean;
  /** 占位色块用的种子，默认取 alt */
  seed?: string;
  /** 首屏前几张图：高优先级 + 立即解码 */
  priority?: boolean;
  /** 展示宽度（CSS px）；代理按 2x 出图并生成 srcSet */
  displayWidth?: number;
}

/**
 * 带淡入过渡的图片。
 *
 * 远端图片默认走 Go 本地代理：代理按平台补 Referer / UA，并统一以 JPEG/PNG
 * 形式返回，能绕开斗鱼、B 站等 CDN 在 WebView 里的热链限制。
 * 代理不可用或这张图代理失败时，再回退直连；仍然失败才显示首字母占位。
 *
 * 关键：所有“是否已加载 / 是否失败 / 是否回退”都按 `src` 记录，而不是在
 * effect 里重置。这样从播放页返回、组件重新挂载且图片命中缓存时，即使
 * `load` 事件在 effect 之前触发，也不会被后续的重置覆盖成"不显示"。
 */
export function SmoothImage({
  src,
  alt,
  className,
  rounded = false,
  seed,
  priority = false,
  displayWidth,
}: SmoothImageProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
  const [proxyState, setProxyState] = useState<ProxyState>(() =>
    getImageProxyBase() ? "ready" : "pending",
  );

  const directSrc = normalizeImageSource(src);
  const isRemote = /^https?:\/\//i.test(directSrc);

  /*
   * 远端图片先等本地代理就绪，再发 <img> 请求。
   *
   * 之前代理还没启动时会先直连一次远端地址：斗鱼/B 站 CDN 会 403，等到
   * onError 再切代理，等于首屏每张图都多一次失败请求，B 站封面尤其明显。
   * 现在没有直连这一步——代理没就绪就先渲染占位，就绪后再真正加载。
   */
  useEffect(() => {
    if (!isRemote || proxyState !== "pending") return;
    let cancelled = false;
    void ensureImageProxy()
      .then((base) => {
        if (!cancelled) setProxyState(base ? "ready" : "failed");
      })
      .catch(() => {
        if (!cancelled) setProxyState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [isRemote, proxyState]);

  const proxySrc = proxiedImageURL(src, displayWidth);
  const canProxy = proxySrc !== directSrc;
  const directFallback = fallbackSrc === directSrc;
  const useDirect = directFallback || proxyState === "failed";
  const resolved = useDirect ? directSrc : proxySrc;
  const loaded = loadedSrc === resolved || loadedSrc === directSrc;
  const failed = failedSrc === directSrc;
  // 代理支持宽度参数后，用 2x 描述符让高分屏拿到清晰图，普通屏仍按 1x 下载。
  const srcSet =
    canProxy && !useDirect && displayWidth
      ? `${proxiedImageURL(src, displayWidth)} 1x, ${proxiedImageURL(src, displayWidth * 2)} 2x`
      : undefined;

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

  // 远端图 + 代理还在启动：先占位，避免发出注定 403 的直连请求。
  if (isRemote && proxyState === "pending" && !directFallback) {
    return (
      <span
        className={`${styles.image} ${rounded ? styles.rounded : ""} ${className ?? ""}`}
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      src={resolved}
      srcSet={srcSet}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "low"}
      draggable={false}
      ref={(node) => {
        // 缓存命中时 load 事件可能在 React 挂载回调之前就已触发；
        // 补一次 complete 检查，避免返回列表后图片一直透明。
        if (node?.complete && node.naturalWidth > 0 && loadedSrc !== resolved) {
          setLoadedSrc(resolved);
        }
      }}
      onLoad={() => setLoadedSrc(resolved)}
      onError={() => {
        if (directFallback) {
          setFailedSrc(directSrc);
          return;
        }
        if (canProxy) {
          // 单张图代理失败：这张改直连；代理本身仍可用于其它图片。
          setFallbackSrc(directSrc);
          return;
        }
        setFailedSrc(directSrc);
      }}
      className={`${styles.image} ${loaded ? styles.loaded : ""} ${rounded ? styles.rounded : ""} ${className ?? ""}`}
    />
  );
}
