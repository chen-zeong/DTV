import * as ImageProxy from "../../bindings/dtv/internal/services/imageproxyservice";
import { isWailsRuntime } from "@/lib/window";

/** 列表封面的显示宽度；2x 由 srcSet 自动补齐。 */
export const STREAMER_COVER_WIDTH = 320;

/**
 * 本地图片代理。
 *
 * B 站 / 斗鱼的图片 CDN 会检查 Referer，WebView 直接 <img src="远端地址">
 * 会拿到 403 或 404，最终只显示首字母占位符。Go 侧起了一个仅监听
 * 127.0.0.1 的小代理，按域名补 Referer / UA，并把图片以本地 http 地址返回。
 *
 * 这一层只负责 URL 拼接与几个已知的历史地址修补；真正的请求在 Go 里。
 */

let proxyBase = "";
let proxyToken = "";
let ensurePromise: Promise<string> | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function startProxyWithRetry(attempt = 0): Promise<string> {
  try {
    const info = await ImageProxy.EnsureStarted();
    proxyBase = String(info?.baseUrl ?? "").replace(/\/+$/, "");
    proxyToken = String(info?.token ?? "");
    return proxyBase;
  } catch (error) {
    // Wails runtime 在极少数启动时序下可能还没就绪；退避重试，避免整页图片退化成直连。
    if (attempt < 3) {
      await delay(180 * (attempt + 1));
      return startProxyWithRetry(attempt + 1);
    }
    throw error;
  }
}

/** 应用启动时调用一次；重复调用会复用同一个 Promise。 */
export function ensureImageProxy(): Promise<string> {
  if (proxyBase) return Promise.resolve(proxyBase);
  if (ensurePromise) return ensurePromise;

  ensurePromise = startProxyWithRetry()
    .catch((error) => {
      // 允许下次重试：例如开发模式下 Go 侧还没注册服务。
      ensurePromise = null;
      throw error;
    });

  return ensurePromise;
}

export function getImageProxyBase(): string {
  return proxyBase;
}

/**
 * 让 Go 侧提前把列表前几张封面/头像写入磁盘缓存。
 *
 * 浏览器对同一个 localhost 源只有 ~6 条连接，一页几十张图会分批排队；
 * 快速切平台时旧图还没下完，新图又排上。Go 侧并发预取后，<img> 请求
 * 直接命中本地磁盘，不再被浏览器连接数卡住。
 *
 * 浏览器预览没有 Go 侧，直接跳过；失败也不影响正常图片加载。
 */
export function prefetchStreamerImages(
  streamers: Array<{ cover: string; avatar: string }>,
): void {
  if (!isWailsRuntime() || streamers.length === 0) return;
  const urls = streamers
    .slice(0, 12)
    .map((streamer) => streamer.cover)
    .filter(Boolean);
  if (urls.length === 0) return;
  // 缩略图接口只在列表里用 320；高分屏下 <img> 会选 2x，提前把 640 也缓存。
  const widths = [STREAMER_COVER_WIDTH];
  if (typeof window !== "undefined" && window.devicePixelRatio > 1.25) {
    widths.push(STREAMER_COVER_WIDTH * 2);
  }
  for (const width of widths) {
    void ImageProxy.Prefetch(urls, width).catch((error) => {
      console.warn("[image-proxy] 预取图片失败（忽略）", error);
    });
  }
}

/** 把远端图片地址换成代理地址；本地 / data / blob 地址原样返回。 */
export function proxiedImageURL(raw: string, width?: number): string {
  const fixed = normalizeImageSource(raw);
  if (!fixed || !proxyBase) return fixed;
  if (!/^https?:\/\//i.test(fixed)) return fixed;
  if (fixed.startsWith(proxyBase + "/") || fixed === proxyBase) return fixed;
  const size =
    width && Number.isFinite(width) && width > 0
      ? `&w=${Math.round(Math.min(1600, Math.max(80, width)))}`
      : "";
  const token = proxyToken ? `&t=${encodeURIComponent(proxyToken)}` : "";
  return `${proxyBase}/image?url=${encodeURIComponent(fixed)}${size}${token}`;
}

/**
 * 修正斗鱼历史头像地址。
 *
 * 目录接口的 av 是 `avatar_v3/202004/<hash>`，没有扩展名；旧版本直接拼成
 * `https://apic.douyucdn.cn/upload/avatar_v3/.../<hash>` 会 404。正确文件名
 * 需要补 `_big.jpg`。新后端已经修正，这里兜底 localStorage 里的旧关注记录。
 */
export function normalizeImageSource(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const withScheme = value.startsWith("//") ? `https:${value}` : value;

  try {
    const url = new URL(withScheme);
    if (
      /(^|\.)douyucdn\.cn$/i.test(url.hostname) &&
      url.pathname.includes("/upload/")
    ) {
      const name = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
      if (name && !name.includes(".")) {
        url.pathname = `${url.pathname}_big.jpg`;
        return url.toString();
      }
    }
  } catch {
    // 不是合法 URL（可能是相对路径），交给调用方原样处理。
  }

  return withScheme;
}
