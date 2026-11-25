import type { LivePlatform } from "@/api";
import { splitEmoticons, type EmoticonPart } from "@/lib/emoticons";
import {
  sanitizeDanmuArea,
  sanitizeDanmuOpacity,
  type DanmuMode,
  type DanmuUserSettings,
} from "./danmuSettings";

const MAX_SEEN = 400;
const MIN_DURATION = 5000;
/** 低配模式最多占用的滚动轨道数，防止高分屏全屏铺太密 */
const LOW_PERF_MAX_LANES = 12;
/** 低配模式每秒最多放行的新弹幕数 */
const LOW_PERF_MAX_PER_SECOND = 24;
/** 轨道饱和时单条等待上轨的最大时长（ms），超时丢弃避免实时弹幕滞后 */
const QUEUE_STALE_MS = 1600;
const NORMAL_MAX_QUEUE = 120;
const LOW_PERF_MAX_QUEUE = 24;
const SCROLL_SPAWN_GAP_PX = 18;
const BITMAP_PAD_PX = 4;

const EMOJI_ONLY_PATTERN =
  /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\uFE0E|\uFE0F|\u200D|\u20E3|\s)+$/u;

export interface DanmuBulletInput {
  id: string;
  content: string;
  color?: string;
}

export interface DanmuEngineConfig {
  enabled: boolean;
  platform?: LivePlatform;
  colorfulSupported: boolean;
  settings: DanmuUserSettings;
}

interface EmoteCacheEntry {
  img: HTMLImageElement;
  ready: boolean;
  failed: boolean;
  waiters: Set<() => void>;
}

interface ActiveBullet {
  id: string;
  mode: DanmuMode;
  parts: EmoticonPart[];
  emoteOnly: boolean;
  hasImageEmote: boolean;
  color: string;
  strokeColor: string;
  fontSize: number;
  visualFontSize: number;
  fontFamily: string;
  lowPerformance: boolean;
  duration: number;
  lane: number;
  x: number;
  y: number;
  width: number;
  height: number;
  drawWidth: number;
  drawHeight: number;
  speed: number;
  elapsedMs: number;
  bitmap: HTMLCanvasElement | null;
  needsRasterize: boolean;
  emoteListeners: Array<() => void>;
}

interface QueuedBullet {
  input: DanmuBulletInput;
  enqueuedAt: number;
}

/* ------------------------------------------------------------------ 表情图缓存 */

const emoteCache = new Map<string, EmoteCacheEntry>();

function getEmoteEntry(src: string): EmoteCacheEntry | null {
  if (!src || typeof Image === "undefined") return null;
  let entry = emoteCache.get(src);
  if (entry) return entry;

  const img = new Image();
  img.decoding = "async";
  entry = {
    img,
    ready: false,
    failed: false,
    waiters: new Set(),
  };
  emoteCache.set(src, entry);

  img.onload = () => {
    if (!entry) return;
    entry.ready = img.naturalWidth > 0 && img.naturalHeight > 0;
    entry.failed = !entry.ready;
    const waiters = Array.from(entry.waiters);
    entry.waiters.clear();
    for (const cb of waiters) cb();
  };
  img.onerror = () => {
    if (!entry) return;
    entry.failed = true;
    entry.waiters.clear();
  };
  img.src = src;
  if (img.complete && img.naturalWidth > 0) {
    entry.ready = true;
  }
  return entry;
}

/* ------------------------------------------------------------------ 纯计算工具 */

export function parseDanmuFontSize(raw: string): number {
  const value = parseInt(raw, 10);
  return Number.isFinite(value) ? value : 20;
}

export function validHexColor(raw: string | undefined): string | undefined {
  const value = String(raw ?? "").trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : undefined;
}

export function isEmoteOnlyParts(parts: readonly EmoticonPart[]): boolean {
  const visible = parts.filter((part) => part.type !== "text" || part.text.trim() !== "");
  return (
    visible.length > 0 &&
    visible.every((part) => part.type !== "text" || EMOJI_ONLY_PATTERN.test(part.text.trim()))
  );
}

export function computeLaneMetrics(
  containerHeight: number,
  fontSize: number,
  area: number,
  lowPerformance: boolean,
): { channelHeight: number; laneCount: number } {
  const normalSize = Math.round(fontSize * 1.5);
  const availableHeight = Math.max(0, containerHeight * area);
  const channelHeight = !lowPerformance
    ? normalSize
    : availableHeight <= 0
      ? Math.max(normalSize, 40)
      : Math.max(normalSize, Math.ceil(availableHeight / LOW_PERF_MAX_LANES));

  const laneCount =
    availableHeight > 0 ? Math.max(1, Math.floor(availableHeight / channelHeight)) : 1;
  return { channelHeight, laneCount };
}

/**
 * 判断滚动弹幕能否安全放入某一条轨道而不追尾重叠。
 */
export function canFitScrollLane(
  lastBullet: { x: number; width: number; speed: number } | undefined,
  containerWidth: number,
  newSpeed: number,
  gap = SCROLL_SPAWN_GAP_PX,
): boolean {
  if (!lastBullet) return true;
  const lastRight = lastBullet.x + lastBullet.width;
  if (lastRight + gap > containerWidth) return false;
  if (newSpeed <= lastBullet.speed) return true;

  // 新弹幕更长因此更快：检查上一条完全离开屏幕左边界时，新弹幕是否追上。
  const timeToExit = Math.max(0, lastRight / lastBullet.speed);
  const newLeftAtExit = containerWidth - newSpeed * timeToExit;
  return newLeftAtExit >= gap;
}

/* ------------------------------------------------------------------ Canvas 引擎 */

/**
 * 单层 Canvas + 离屏位图缓存弹幕引擎。
 *
 * 核心优化：
 *   1. 全屏只有 1 个 `<canvas>` 合成层，无 DOM 节点增删，无 `getBoundingClientRect()`；
 *   2. 每条弹幕只在入轨时在离屏 Canvas 上光栅化一次（描边 + 填充 + 表情图），
 *      主 rAF 循环只做 `ctx.drawImage(bitmap, x, y)`，无每帧文本描边开销；
 *   3. 空闲（画面无弹幕且队列为空）时自动停掉 rAF 循环，零后台功耗。
 */
export class DanmuCanvasEngine {
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly measureCtx: CanvasRenderingContext2D | null;
  private resizeObserver: ResizeObserver | null = null;

  private config: DanmuEngineConfig;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private fontFamily = "sans-serif";

  private active: ActiveBullet[] = [];
  private waiting: QueuedBullet[] = [];
  private seenIds = new Set<string>();
  private rafId = 0;
  private lastFrameAt = 0;
  private lowPerfWindowStart = 0;
  private lowPerfWindowCount = 0;
  private disposed = false;

  constructor(container: HTMLElement, initial: DanmuEngineConfig) {
    this.container = container;
    this.config = initial;

    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    canvas.style.display = "block";
    canvas.style.opacity = initial.enabled
      ? String(sanitizeDanmuOpacity(initial.settings.opacity))
      : "0";
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });

    const scratch = document.createElement("canvas");
    scratch.width = 1;
    scratch.height = 1;
    this.measureCtx = scratch.getContext("2d");

    this.container.appendChild(canvas);
    this.syncSize();
    this.readFontFamily();

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.disposed) return;
        this.syncSize();
      });
      this.resizeObserver.observe(container);
    }
  }

  updateConfig(next: DanmuEngineConfig): void {
    if (this.disposed) return;
    const prev = this.config;
    this.config = next;

    const opacity = next.enabled ? sanitizeDanmuOpacity(next.settings.opacity) : 0;
    this.canvas.style.opacity = String(opacity);

    if (!next.enabled) {
      this.clear();
      return;
    }

    const prevDuration = Math.max(MIN_DURATION, prev.settings.duration);
    const nextDuration = Math.max(MIN_DURATION, next.settings.duration);
    const prevFont = parseDanmuFontSize(prev.settings.fontSize);
    const nextFont = parseDanmuFontSize(next.settings.fontSize);
    const prevArea = sanitizeDanmuArea(prev.settings.area);
    const nextArea = sanitizeDanmuArea(next.settings.area);

    const layoutChanged =
      prevFont !== nextFont ||
      prevArea !== nextArea ||
      prev.settings.lowPerformance !== next.settings.lowPerformance;
    const durationChanged = prevDuration !== nextDuration;
    const appearanceChanged =
      prev.settings.color !== next.settings.color ||
      prev.settings.strokeColor !== next.settings.strokeColor ||
      prev.settings.lowPerformance !== next.settings.lowPerformance;

    if (layoutChanged || durationChanged || appearanceChanged) {
      const { channelHeight, laneCount } = computeLaneMetrics(
        this.height,
        nextFont,
        nextArea,
        next.settings.lowPerformance,
      );
      for (const bullet of this.active) {
        if (durationChanged) {
          bullet.duration = nextDuration;
          if (bullet.mode === "scroll") {
            bullet.speed = (this.width + bullet.width) / (nextDuration / 1000);
          }
        }
        if (layoutChanged) {
          bullet.lane = Math.min(bullet.lane, laneCount - 1);
          bullet.y = bullet.lane * channelHeight + Math.max(0, (channelHeight - bullet.height) / 2);
        }
        if (appearanceChanged && prev.settings.strokeColor !== next.settings.strokeColor) {
          bullet.strokeColor = next.settings.strokeColor;
          bullet.needsRasterize = true;
        }
      }
    }

    if (this.active.length > 0 || this.waiting.length > 0) {
      this.ensureLoop();
    }
  }

  enqueue(input: DanmuBulletInput): void {
    if (this.disposed || !this.config.enabled) return;
    if (!input.id || !input.content) return;
    if (this.seenIds.has(input.id)) return;

    this.seenIds.add(input.id);
    if (this.seenIds.size > MAX_SEEN) {
      const excess = this.seenIds.size - MAX_SEEN;
      let removed = 0;
      for (const key of this.seenIds) {
        this.seenIds.delete(key);
        removed += 1;
        if (removed >= excess) break;
      }
    }

    const lowPerf = this.config.settings.lowPerformance;
    const maxQueue = lowPerf ? LOW_PERF_MAX_QUEUE : NORMAL_MAX_QUEUE;
    if (this.waiting.length >= maxQueue) {
      this.waiting.shift();
    }
    this.waiting.push({ input, enqueuedAt: performance.now() });
    this.ensureLoop();
  }

  clear(): void {
    this.stopLoop();
    for (const bullet of this.active) {
      this.cleanupBullet(bullet);
    }
    this.active = [];
    this.waiting = [];
    this.seenIds.clear();
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.width, this.height);
    }
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.canvas.remove();
  }

  private readFontFamily(): void {
    try {
      const computed = window.getComputedStyle(this.container).fontFamily;
      if (computed) this.fontFamily = computed;
    } catch {
      this.fontFamily = "sans-serif";
    }
  }

  private syncSize(): void {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(0, rect.width || this.container.clientWidth);
    const height = Math.max(0, rect.height || this.container.clientHeight);
    const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));

    const pixelW = Math.max(1, Math.floor(width * dpr));
    const pixelH = Math.max(1, Math.floor(height * dpr));

    if (this.canvas.width !== pixelW || this.canvas.height !== pixelH) {
      this.canvas.width = pixelW;
      this.canvas.height = pixelH;
    }
    if (this.ctx) {
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const widthChanged = Math.abs(width - this.width) > 1;
    this.width = width;
    this.height = height;
    this.dpr = dpr;

    if (widthChanged && this.active.length > 0) {
      const fontSize = parseDanmuFontSize(this.config.settings.fontSize);
      const area = sanitizeDanmuArea(this.config.settings.area);
      const { channelHeight, laneCount } = computeLaneMetrics(
        this.height,
        fontSize,
        area,
        this.config.settings.lowPerformance,
      );
      for (const bullet of this.active) {
        if (bullet.mode === "scroll") {
          bullet.speed = (this.width + bullet.width) / (bullet.duration / 1000);
        } else {
          bullet.x = (this.width - bullet.width) / 2;
        }
        bullet.lane = Math.min(bullet.lane, laneCount - 1);
        bullet.y = bullet.lane * channelHeight + Math.max(0, (channelHeight - bullet.height) / 2);
      }
    }
  }

  private ensureLoop(): void {
    if (this.rafId !== 0 || this.disposed || !this.config.enabled) return;
    this.lastFrameAt = performance.now();
    this.rafId = window.requestAnimationFrame(this.tick);
  }

  private stopLoop(): void {
    if (this.rafId !== 0) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private tick = (now: number): void => {
    this.rafId = 0;
    if (this.disposed || !this.config.enabled) return;

    // 切后台/最小化恢复时限制单帧步长，防止弹幕瞬间飞出屏幕
    const dtMs = Math.min(100, Math.max(0, now - this.lastFrameAt));
    const dtSec = dtMs / 1000;
    this.lastFrameAt = now;

    if (this.width <= 0 || this.height <= 0) {
      this.syncSize();
    }

    // 1. 先推进已有弹幕位置并回收离场弹幕，释放轨道
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const bullet = this.active[i];
      if (bullet.mode === "scroll") {
        bullet.x -= bullet.speed * dtSec;
        if (bullet.x + bullet.width < -8) {
          this.cleanupBullet(bullet);
          this.active.splice(i, 1);
        }
      } else {
        bullet.elapsedMs += dtMs;
        if (bullet.elapsedMs >= bullet.duration) {
          this.cleanupBullet(bullet);
          this.active.splice(i, 1);
        }
      }
    }

    // 2. 尝试让等待队列中的弹幕上轨
    this.flushWaiting(now);

    // 3. 统一清屏并绘制当前帧（只做 drawImage）
    const ctx = this.ctx;
    if (ctx && this.width > 0 && this.height > 0) {
      ctx.clearRect(0, 0, this.width, this.height);
      for (const bullet of this.active) {
        if (bullet.needsRasterize || !bullet.bitmap) {
          this.rasterizeBullet(bullet);
        }
        if (!bullet.bitmap) continue;
        ctx.drawImage(
          bullet.bitmap,
          bullet.x - BITMAP_PAD_PX,
          Math.round(bullet.y) - BITMAP_PAD_PX,
          bullet.drawWidth,
          bullet.drawHeight,
        );
      }
    }

    if (this.active.length > 0 || this.waiting.length > 0) {
      this.rafId = window.requestAnimationFrame(this.tick);
    }
  };

  private flushWaiting(now: number): void {
    if (this.waiting.length === 0 || this.width <= 0 || this.height <= 0) return;

    const { settings, platform, colorfulSupported } = this.config;
    const fontSize = parseDanmuFontSize(settings.fontSize);
    const area = sanitizeDanmuArea(settings.area);
    const duration = Math.max(MIN_DURATION, settings.duration);
    const mode = settings.mode ?? "scroll";
    const lowPerf = settings.lowPerformance;
    const { channelHeight, laneCount } = computeLaneMetrics(this.height, fontSize, area, lowPerf);

    if (lowPerf && now - this.lowPerfWindowStart >= 1000) {
      this.lowPerfWindowStart = now;
      this.lowPerfWindowCount = 0;
    }

    const remaining: QueuedBullet[] = [];
    for (let i = 0; i < this.waiting.length; i += 1) {
      const item = this.waiting[i];
      if (now - item.enqueuedAt > QUEUE_STALE_MS) {
        continue;
      }
      if (lowPerf && this.lowPerfWindowCount >= LOW_PERF_MAX_PER_SECOND) {
        remaining.push(item);
        continue;
      }

      const bullet = this.prepareBullet(item.input, {
        platform,
        colorfulSupported,
        settings,
        fontSize,
        duration,
        mode,
      });
      if (!bullet) continue;

      const lane = this.findAvailableLane(bullet, mode, laneCount);
      if (lane < 0) {
        this.cleanupBullet(bullet);
        remaining.push(item);
        continue;
      }

      bullet.lane = lane;
      bullet.y = lane * channelHeight + Math.max(0, (channelHeight - bullet.height) / 2);
      bullet.x = mode === "scroll" ? this.width : (this.width - bullet.width) / 2;
      this.rasterizeBullet(bullet);
      this.active.push(bullet);
      if (lowPerf) this.lowPerfWindowCount += 1;
    }

    this.waiting = remaining;
  }

  private findAvailableLane(bullet: ActiveBullet, mode: DanmuMode, laneCount: number): number {
    if (mode === "scroll") {
      for (let lane = 0; lane < laneCount; lane += 1) {
        let rightmost: ActiveBullet | undefined;
        for (const item of this.active) {
          if (item.mode !== "scroll" || item.lane !== lane) continue;
          if (!rightmost || item.x + item.width > rightmost.x + rightmost.width) {
            rightmost = item;
          }
        }
        if (canFitScrollLane(rightmost, this.width, bullet.speed)) {
          return lane;
        }
      }
      return -1;
    }

    if (mode === "top") {
      const maxLane = Math.max(0, Math.floor(laneCount / 2));
      for (let lane = 0; lane <= maxLane && lane < laneCount; lane += 1) {
        const occupied = this.active.some((item) => item.mode === "top" && item.lane === lane);
        if (!occupied) return lane;
      }
      return -1;
    }

    const minLane = laneCount > 2 ? Math.floor(laneCount / 2) + 1 : 0;
    for (let lane = laneCount - 1; lane >= minLane; lane -= 1) {
      const occupied = this.active.some((item) => item.mode === "bottom" && item.lane === lane);
      if (!occupied) return lane;
    }
    return -1;
  }

  private prepareBullet(
    input: DanmuBulletInput,
    opts: {
      platform?: LivePlatform;
      colorfulSupported: boolean;
      settings: DanmuUserSettings;
      fontSize: number;
      duration: number;
      mode: DanmuMode;
    },
  ): ActiveBullet | null {
    const parts = splitEmoticons(input.content, opts.platform);
    if (parts.length === 0) return null;

    const emoteOnly = isEmoteOnlyParts(parts);
    const hasImageEmote = parts.some((part) => part.type === "image");
    const visualFontSize =
      emoteOnly && !hasImageEmote ? Math.round(opts.fontSize * 1.45) : opts.fontSize;
    const emoteSize = Math.round(visualFontSize * (emoteOnly ? 1.65 : 1.15));

    const mctx = this.measureCtx;
    if (!mctx) return null;
    mctx.font = `700 ${visualFontSize}px ${this.fontFamily}`;

    let totalWidth = 0;
    for (const part of parts) {
      if (part.type === "text") {
        totalWidth += mctx.measureText(part.text).width;
      } else if (part.type === "emoji") {
        totalWidth += mctx.measureText(part.emoji).width;
      } else {
        totalWidth += emoteSize + 2;
      }
    }

    const width = Math.max(1, Math.ceil(totalWidth));
    const height = Math.max(Math.ceil(visualFontSize * 1.25), emoteSize);
    const nativeColor =
      opts.colorfulSupported && opts.settings.colorful ? validHexColor(input.color) : undefined;
    const color = nativeColor ?? opts.settings.color;
    const speed = opts.mode === "scroll" ? (this.width + width) / (opts.duration / 1000) : 0;

    const bullet: ActiveBullet = {
      id: input.id,
      mode: opts.mode,
      parts,
      emoteOnly,
      hasImageEmote,
      color,
      strokeColor: opts.settings.strokeColor,
      fontSize: opts.fontSize,
      visualFontSize,
      fontFamily: this.fontFamily,
      lowPerformance: opts.settings.lowPerformance,
      duration: opts.duration,
      lane: 0,
      x: this.width,
      y: 0,
      width,
      height,
      drawWidth: width + BITMAP_PAD_PX * 2,
      drawHeight: height + BITMAP_PAD_PX * 2,
      speed,
      elapsedMs: 0,
      bitmap: null,
      needsRasterize: true,
      emoteListeners: [],
    };

    for (const part of parts) {
      if (part.type !== "image") continue;
      const entry = getEmoteEntry(part.src);
      if (entry && !entry.ready && !entry.failed) {
        const onReady = () => {
          bullet.needsRasterize = true;
        };
        entry.waiters.add(onReady);
        bullet.emoteListeners.push(() => entry.waiters.delete(onReady));
      }
    }

    return bullet;
  }

  private rasterizeBullet(bullet: ActiveBullet): void {
    bullet.needsRasterize = false;
    const dpr = this.dpr;
    const pixelW = Math.max(1, Math.ceil(bullet.drawWidth * dpr));
    const pixelH = Math.max(1, Math.ceil(bullet.drawHeight * dpr));

    let off = bullet.bitmap;
    if (!off) {
      off = document.createElement("canvas");
      bullet.bitmap = off;
    }
    if (off.width !== pixelW || off.height !== pixelH) {
      off.width = pixelW;
      off.height = pixelH;
    }

    const octx = off.getContext("2d");
    if (!octx) return;

    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, bullet.drawWidth, bullet.drawHeight);
    octx.font = `700 ${bullet.visualFontSize}px ${bullet.fontFamily}`;
    octx.textBaseline = "middle";
    octx.lineJoin = "round";
    octx.miterLimit = 2;

    const centerY = BITMAP_PAD_PX + bullet.height / 2;
    const emoteSize = Math.round(bullet.visualFontSize * (bullet.emoteOnly ? 1.65 : 1.15));
    const strokeWidth = bullet.lowPerformance ? 2 : 2.8;

    let cursorX = BITMAP_PAD_PX;
    for (const part of bullet.parts) {
      if (part.type === "text") {
        octx.strokeStyle = bullet.strokeColor;
        octx.lineWidth = strokeWidth;
        octx.strokeText(part.text, cursorX, centerY);
        octx.fillStyle = bullet.color;
        octx.fillText(part.text, cursorX, centerY);
        cursorX += octx.measureText(part.text).width;
      } else if (part.type === "emoji") {
        // 彩色 emoji 不描边，防止 Chromium 给彩色字符套黑框
        octx.fillStyle = bullet.color;
        octx.fillText(part.emoji, cursorX, centerY);
        cursorX += octx.measureText(part.emoji).width;
      } else {
        const entry = getEmoteEntry(part.src);
        if (entry?.ready) {
          const emoteY = centerY - emoteSize / 2;
          octx.drawImage(entry.img, cursorX + 1, emoteY, emoteSize, emoteSize);
        }
        cursorX += emoteSize + 2;
      }
    }
  }

  private cleanupBullet(bullet: ActiveBullet): void {
    for (const detach of bullet.emoteListeners) {
      detach();
    }
    bullet.emoteListeners = [];
    bullet.bitmap = null;
  }
}
