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
/** 基准舞台宽度（px）：全屏宽度远超该值时按幂函数温和延长滚动时长，防止全屏线速度暴增 */
const BASE_STAGE_WIDTH = 960;
/** 低配模式最多占用的滚动轨道数，防止高分屏全屏铺太密 */
const LOW_PERF_MAX_LANES = 12;
/** 低配模式每秒最多放行的新弹幕数 */
const LOW_PERF_MAX_PER_SECOND = 24;
/** 轨道饱和时单条等待上轨的最大时长（ms），超时丢弃避免实时弹幕滞后 */
const QUEUE_STALE_MS = 1600;
const NORMAL_MAX_QUEUE = 120;
const LOW_PERF_MAX_QUEUE = 24;
const SCROLL_SPAWN_GAP_PX = 18;
/** DOM 节点对象池最大容量：弹幕离场后不销毁 DOM，隐藏后留作下一条复用 */
const MAX_NODE_POOL = 120;
/** 队列有积压且轨道暂满时的最短/最长唤醒间隔（ms） */
const QUEUE_RETRY_MIN_MS = 45;
const QUEUE_RETRY_MAX_MS = 220;

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

interface PreparedBullet {
  id: string;
  parts: EmoticonPart[];
  emoteOnly: boolean;
  hasImageEmote: boolean;
  fontSize: number;
  visualFontSize: number;
  emoteSize: number;
  width: number;
  height: number;
  rawColor?: string;
}

interface ActiveBullet {
  id: string;
  mode: DanmuMode;
  parts: EmoticonPart[];
  emoteOnly: boolean;
  color: string;
  fontSize: number;
  visualFontSize: number;
  emoteSize: number;
  /** 满程滚动时长（已含全屏宽度自适应补偿）或固定弹幕停留时长（ms） */
  duration: number;
  lane: number;
  /** 当前动画段的起点 X（px） */
  startX: number;
  /** 当前动画段的起点时间戳（performance.now()） */
  startedAt: number;
  /** 当前动画段计划运行时长（ms） */
  segmentDuration: number;
  y: number;
  width: number;
  height: number;
  /** 滚动速度（px/s） */
  speed: number;
  node: HTMLDivElement | null;
  animation: Animation | null;
  fallbackTimer: number;
}

interface QueuedBullet {
  input: DanmuBulletInput;
  enqueuedAt: number;
  prepared: PreparedBullet | null;
  preparedFontSize: number;
  preparedPlatform?: LivePlatform;
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
 * 根据当前舞台宽度计算实际滚动时长（对齐 B 站网页端全屏速度自适应）。
 *
 * 非全屏舞台通常在 960px 左右；进入全屏后宽度会翻倍到 1920~2560px。
 * 若维持完全相同的 duration，全屏弹幕线速度会暴增 2~2.7 倍，人眼平滑追踪时
 * 极易产生眩晕和微掉帧感。对超宽舞台按幂函数温和补偿时长，使全屏角速度保持自然。
 */
export function computeEffectiveScrollDuration(
  baseDurationMs: number,
  containerWidth: number,
): number {
  const clampedBase = Math.max(MIN_DURATION, baseDurationMs);
  if (containerWidth <= BASE_STAGE_WIDTH) return clampedBase;
  const ratio = Math.min(1.55, Math.pow(containerWidth / BASE_STAGE_WIDTH, 0.45));
  return Math.round(clampedBase * ratio);
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

function buildTextShadowCss(strokeColor: string, lowPerformance: boolean): string {
  if (lowPerformance) {
    return [
      `-1px -1px 0 ${strokeColor}`,
      `1px -1px 0 ${strokeColor}`,
      `-1px 1px 0 ${strokeColor}`,
      `1px 1px 0 ${strokeColor}`,
    ].join(", ");
  }
  // 对齐 B 站网页端 .bili-danmaku-x-dm 的四向描边阴影公式，兼顾清晰度与彩色 Emoji 兼容性
  return [
    `1px 0 1px ${strokeColor}`,
    `0 1px 1px ${strokeColor}`,
    `0 -1px 1px ${strokeColor}`,
    `-1px 0 1px ${strokeColor}`,
    `-1px -1px 0 ${strokeColor}`,
    `1px -1px 0 ${strokeColor}`,
    `-1px 1px 0 ${strokeColor}`,
    `1px 1px 0 ${strokeColor}`,
  ].join(", ");
}

/* ------------------------------------------------------------------ GPU 合成器弹幕引擎 */

/**
 * B 站网页端同款 GPU 合成器弹幕引擎（DOM 节点池 + 离屏 measureText 零回流 + Compositor Thread 动画）。
 *
 * 核心优化：
 *   1. 彻底脱离 JS 主线程逐帧重绘：每条弹幕通过 Web Animations API 驱动 `transform: translate3d(...)`，
 *      滚动过程 100% 运行在 Chromium 合成器线程（Compositor Thread）与 GPU 上，不受主线程
 *      `xgplayer-flv` 解复用、`appendBuffer` 或 GC 干扰，全屏高刷下严格锁死显示器原生刷新率；
 *   2. 消除全屏巨型 Canvas 每帧 `clearRect` 的 100% 屏幕脏区（Damage Rect）与整屏 Alpha 混合带宽；
 *   3. 零回流测宽：弹幕入队时通过 1×1 离屏 Canvas `measureText` 一次性算出宽度，全程 0 次
 *      `getBoundingClientRect()` / `offsetWidth` 调用，轨道位置由线性方程 `x = startX - speed * dt` 实时推导；
 *   4. DOM 节点对象池复用：弹幕滚出屏幕后不从 DOM 树移除，只隐藏并归还池中等待下一条复用。
 */
export class DanmuCanvasEngine {
  private readonly container: HTMLElement;
  private readonly stage: HTMLDivElement;
  private readonly measureCtx: CanvasRenderingContext2D | null;
  private resizeObserver: ResizeObserver | null = null;

  private config: DanmuEngineConfig;
  private width = 0;
  private height = 0;
  private fontFamily = "sans-serif";

  private active: ActiveBullet[] = [];
  private waiting: QueuedBullet[] = [];
  private nodePool: HTMLDivElement[] = [];
  private seenIds = new Set<string>();
  private queueTimer = 0;
  private lowPerfWindowStart = 0;
  private lowPerfWindowCount = 0;
  private disposed = false;

  constructor(container: HTMLElement, initial: DanmuEngineConfig) {
    this.container = container;
    this.config = initial;

    const stage = document.createElement("div");
    stage.style.position = "absolute";
    stage.style.inset = "0";
    stage.style.width = "100%";
    stage.style.height = "100%";
    stage.style.overflow = "hidden";
    stage.style.pointerEvents = "none";
    stage.style.contain = "strict";
    stage.style.opacity = initial.enabled
      ? String(sanitizeDanmuOpacity(initial.settings.opacity))
      : "0";
    stage.style.setProperty(
      "--danmu-text-shadow",
      buildTextShadowCss(initial.settings.strokeColor, initial.settings.lowPerformance),
    );
    this.stage = stage;

    let measureCtx: CanvasRenderingContext2D | null = null;
    try {
      const scratch = document.createElement("canvas");
      scratch.width = 1;
      scratch.height = 1;
      measureCtx = scratch.getContext("2d");
    } catch {
      measureCtx = null;
    }
    this.measureCtx = measureCtx;

    this.container.appendChild(stage);
    this.readFontFamily();
    this.syncSize();

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
    this.stage.style.opacity = String(opacity);

    if (
      prev.settings.strokeColor !== next.settings.strokeColor ||
      prev.settings.lowPerformance !== next.settings.lowPerformance
    ) {
      this.stage.style.setProperty(
        "--danmu-text-shadow",
        buildTextShadowCss(next.settings.strokeColor, next.settings.lowPerformance),
      );
    }

    if (!next.enabled) {
      this.clear();
      return;
    }

    const prevBaseDuration = Math.max(MIN_DURATION, prev.settings.duration);
    const nextBaseDuration = Math.max(MIN_DURATION, next.settings.duration);
    const prevFont = parseDanmuFontSize(prev.settings.fontSize);
    const nextFont = parseDanmuFontSize(next.settings.fontSize);
    const prevArea = sanitizeDanmuArea(prev.settings.area);
    const nextArea = sanitizeDanmuArea(next.settings.area);

    const layoutChanged =
      prevFont !== nextFont ||
      prevArea !== nextArea ||
      prev.settings.lowPerformance !== next.settings.lowPerformance;
    const durationChanged = prevBaseDuration !== nextBaseDuration;
    const colorChanged =
      prev.settings.color !== next.settings.color ||
      prev.settings.colorful !== next.settings.colorful ||
      prev.colorfulSupported !== next.colorfulSupported;

    if ((layoutChanged || durationChanged || colorChanged) && this.active.length > 0) {
      const now = performance.now();
      const { channelHeight, laneCount } = computeLaneMetrics(
        this.height,
        nextFont,
        nextArea,
        next.settings.lowPerformance,
      );
      const nextScrollDuration = computeEffectiveScrollDuration(nextBaseDuration, this.width);

      for (let i = this.active.length - 1; i >= 0; i -= 1) {
        const bullet = this.active[i];
        if (layoutChanged) {
          bullet.lane = Math.min(bullet.lane, laneCount - 1);
          bullet.y = bullet.lane * channelHeight + Math.max(0, (channelHeight - bullet.height) / 2);
        }
        if (colorChanged && bullet.node) {
          bullet.color = next.settings.color;
          bullet.node.style.color = bullet.color;
        }
        if (durationChanged || layoutChanged) {
          if (bullet.mode === "scroll") {
            const currentX = this.computeBulletX(bullet, now);
            if (currentX + bullet.width <= -4) {
              this.retireBullet(bullet);
              continue;
            }
            bullet.duration = nextScrollDuration;
            bullet.speed = (this.width + bullet.width) / (nextScrollDuration / 1000);
            bullet.startX = currentX;
            bullet.startedAt = now;
            const remainingDist = Math.max(1, currentX + bullet.width + 8);
            const remainingMs = (remainingDist / bullet.speed) * 1000;
            bullet.segmentDuration = remainingMs;
            this.startBulletAnimation(bullet, remainingMs);
          } else {
            const elapsed = now - bullet.startedAt;
            bullet.duration = nextBaseDuration;
            const remainingMs = nextBaseDuration - elapsed;
            if (remainingMs <= 16) {
              this.retireBullet(bullet);
              continue;
            }
            bullet.startX = (this.width - bullet.width) / 2;
            bullet.startedAt = now;
            bullet.segmentDuration = remainingMs;
            this.startBulletAnimation(bullet, remainingMs);
          }
        }
      }
    }

    if (this.waiting.length > 0) {
      this.flushWaiting(performance.now());
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

    const fontSize = parseDanmuFontSize(this.config.settings.fontSize);
    const platform = this.config.platform;
    const prepared = this.prepareBulletData(input, fontSize, platform);
    if (!prepared) return;

    const lowPerf = this.config.settings.lowPerformance;
    const maxQueue = lowPerf ? LOW_PERF_MAX_QUEUE : NORMAL_MAX_QUEUE;
    if (this.waiting.length >= maxQueue) {
      this.waiting.shift();
    }

    const now = performance.now();
    this.waiting.push({
      input,
      enqueuedAt: now,
      prepared,
      preparedFontSize: fontSize,
      preparedPlatform: platform,
    });
    this.flushWaiting(now);
  }

  clear(): void {
    this.stopQueueTimer();
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      this.releaseBulletNode(this.active[i]);
    }
    this.active = [];
    this.waiting = [];
    this.seenIds.clear();
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.nodePool = [];
    this.stage.remove();
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

    const prevWidth = this.width;
    const prevHeight = this.height;
    const widthChanged = Math.abs(width - prevWidth) > 1;
    const heightChanged = Math.abs(height - prevHeight) > 1;

    this.width = width;
    this.height = height;

    if ((widthChanged || heightChanged) && this.active.length > 0 && width > 0 && height > 0) {
      const now = performance.now();
      const fontSize = parseDanmuFontSize(this.config.settings.fontSize);
      const area = sanitizeDanmuArea(this.config.settings.area);
      const baseDuration = Math.max(MIN_DURATION, this.config.settings.duration);
      const scrollDuration = computeEffectiveScrollDuration(baseDuration, width);
      const { channelHeight, laneCount } = computeLaneMetrics(
        height,
        fontSize,
        area,
        this.config.settings.lowPerformance,
      );

      for (let i = this.active.length - 1; i >= 0; i -= 1) {
        const bullet = this.active[i];
        bullet.lane = Math.min(bullet.lane, laneCount - 1);
        bullet.y = bullet.lane * channelHeight + Math.max(0, (channelHeight - bullet.height) / 2);

        if (bullet.mode === "scroll") {
          const oldX = this.computeBulletX(bullet, now);
          const oldTotal = Math.max(1, (prevWidth > 0 ? prevWidth : width) + bullet.width);
          const progress = Math.min(1, Math.max(0, ((prevWidth > 0 ? prevWidth : width) - oldX) / oldTotal));
          if (progress >= 0.995) {
            this.retireBullet(bullet);
            continue;
          }

          const newTotal = width + bullet.width;
          const newX = width - progress * newTotal;
          bullet.duration = scrollDuration;
          bullet.speed = newTotal / (scrollDuration / 1000);
          bullet.startX = newX;
          bullet.startedAt = now;
          const remainingDist = Math.max(1, newX + bullet.width + 8);
          const remainingMs = (remainingDist / bullet.speed) * 1000;
          bullet.segmentDuration = remainingMs;
          this.startBulletAnimation(bullet, remainingMs);
        } else {
          const elapsed = now - bullet.startedAt;
          const remainingMs = bullet.segmentDuration - elapsed;
          if (remainingMs <= 16) {
            this.retireBullet(bullet);
            continue;
          }
          bullet.startX = (width - bullet.width) / 2;
          bullet.startedAt = now;
          bullet.segmentDuration = remainingMs;
          this.startBulletAnimation(bullet, remainingMs);
        }
      }
    }

    if (this.waiting.length > 0 && width > 0 && height > 0) {
      this.flushWaiting(performance.now());
    }
  }

  private computeBulletX(bullet: ActiveBullet, now: number): number {
    if (bullet.mode !== "scroll") return bullet.startX;
    const elapsedSec = Math.max(0, (now - bullet.startedAt) / 1000);
    return bullet.startX - bullet.speed * elapsedSec;
  }

  private pruneExpiredActive(now: number): void {
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const bullet = this.active[i];
      if (now - bullet.startedAt >= bullet.segmentDuration + 64) {
        this.retireBullet(bullet);
      }
    }
  }

  private flushWaiting(now: number): void {
    this.stopQueueTimer();
    if (this.disposed || !this.config.enabled) return;
    if (this.waiting.length === 0) return;

    if (this.width <= 0 || this.height <= 0) {
      this.syncSize();
      if (this.width <= 0 || this.height <= 0) return;
    }

    this.pruneExpiredActive(now);

    const { settings, platform, colorfulSupported } = this.config;
    const fontSize = parseDanmuFontSize(settings.fontSize);
    const area = sanitizeDanmuArea(settings.area);
    const baseDuration = Math.max(MIN_DURATION, settings.duration);
    const mode = settings.mode ?? "scroll";
    const duration =
      mode === "scroll" ? computeEffectiveScrollDuration(baseDuration, this.width) : baseDuration;
    const lowPerf = settings.lowPerformance;
    const { channelHeight, laneCount } = computeLaneMetrics(this.height, fontSize, area, lowPerf);

    if (lowPerf && now - this.lowPerfWindowStart >= 1000) {
      this.lowPerfWindowStart = now;
      this.lowPerfWindowCount = 0;
    }

    // 预先快照每条轨道当前最右侧的滚动弹幕（避免对队列每条候选都重复遍历 active）
    const laneRightmost: Array<{ x: number; width: number; speed: number } | undefined> =
      mode === "scroll" ? new Array(laneCount) : [];
    if (mode === "scroll") {
      for (const item of this.active) {
        if (item.mode !== "scroll" || item.lane < 0 || item.lane >= laneCount) continue;
        const x = this.computeBulletX(item, now);
        if (x + item.width < -4) continue;
        const prev = laneRightmost[item.lane];
        if (!prev || x + item.width > prev.x + prev.width) {
          laneRightmost[item.lane] = { x, width: item.width, speed: item.speed };
        }
      }
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

      if (
        !item.prepared ||
        item.preparedFontSize !== fontSize ||
        item.preparedPlatform !== platform
      ) {
        item.prepared = this.prepareBulletData(item.input, fontSize, platform);
        item.preparedFontSize = fontSize;
        item.preparedPlatform = platform;
      }
      const prepared = item.prepared;
      if (!prepared) continue;

      const speed =
        mode === "scroll" ? (this.width + prepared.width) / (duration / 1000) : 0;
      const lane = this.findAvailableLane(mode, laneCount, speed, laneRightmost);
      if (lane < 0) {
        remaining.push(item);
        continue;
      }

      const nativeColor =
        colorfulSupported && settings.colorful ? validHexColor(prepared.rawColor) : undefined;
      const color = nativeColor ?? settings.color;
      const startX = mode === "scroll" ? this.width : (this.width - prepared.width) / 2;
      const y = lane * channelHeight + Math.max(0, (channelHeight - prepared.height) / 2);
      const segmentDuration =
        mode === "scroll"
          ? ((this.width + prepared.width + 8) / speed) * 1000
          : duration;

      const bullet: ActiveBullet = {
        id: prepared.id,
        mode,
        parts: prepared.parts,
        emoteOnly: prepared.emoteOnly,
        color,
        fontSize: prepared.fontSize,
        visualFontSize: prepared.visualFontSize,
        emoteSize: prepared.emoteSize,
        duration,
        lane,
        startX,
        startedAt: now,
        segmentDuration,
        y,
        width: prepared.width,
        height: prepared.height,
        speed,
        node: null,
        animation: null,
        fallbackTimer: 0,
      };

      this.mountBullet(bullet);
      this.active.push(bullet);

      if (mode === "scroll") {
        laneRightmost[lane] = { x: startX, width: bullet.width, speed: bullet.speed };
      }
      if (lowPerf) this.lowPerfWindowCount += 1;
    }

    this.waiting = remaining;
    if (this.waiting.length > 0) {
      this.scheduleQueueRetry(now, laneRightmost, lowPerf);
    }
  }

  private scheduleQueueRetry(
    now: number,
    laneRightmost: ReadonlyArray<{ x: number; width: number; speed: number } | undefined>,
    lowPerf: boolean,
  ): void {
    if (this.queueTimer !== 0 || this.disposed || this.waiting.length === 0) return;

    let delayMs = QUEUE_RETRY_MAX_MS;
    if (lowPerf && this.lowPerfWindowCount >= LOW_PERF_MAX_PER_SECOND) {
      delayMs = Math.max(QUEUE_RETRY_MIN_MS, 1000 - (now - this.lowPerfWindowStart));
    } else if (laneRightmost.length > 0) {
      let earliestMs = QUEUE_RETRY_MAX_MS;
      for (const last of laneRightmost) {
        if (!last || last.speed <= 0) {
          earliestMs = QUEUE_RETRY_MIN_MS;
          break;
        }
        const needPx = last.x + last.width + SCROLL_SPAWN_GAP_PX - this.width;
        if (needPx <= 0) {
          earliestMs = QUEUE_RETRY_MIN_MS;
          break;
        }
        const waitMs = (needPx / last.speed) * 1000;
        if (waitMs < earliestMs) earliestMs = waitMs;
      }
      delayMs = Math.min(QUEUE_RETRY_MAX_MS, Math.max(QUEUE_RETRY_MIN_MS, Math.ceil(earliestMs)));
    }

    this.queueTimer = window.setTimeout(() => {
      this.queueTimer = 0;
      this.flushWaiting(performance.now());
    }, delayMs);
  }

  private stopQueueTimer(): void {
    if (this.queueTimer !== 0) {
      window.clearTimeout(this.queueTimer);
      this.queueTimer = 0;
    }
  }

  private findAvailableLane(
    mode: DanmuMode,
    laneCount: number,
    newSpeed: number,
    laneRightmost: ReadonlyArray<{ x: number; width: number; speed: number } | undefined>,
  ): number {
    if (mode === "scroll") {
      for (let lane = 0; lane < laneCount; lane += 1) {
        if (canFitScrollLane(laneRightmost[lane], this.width, newSpeed)) {
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

  private prepareBulletData(
    input: DanmuBulletInput,
    fontSize: number,
    platform?: LivePlatform,
  ): PreparedBullet | null {
    const parts = splitEmoticons(input.content, platform);
    if (parts.length === 0) return null;

    const emoteOnly = isEmoteOnlyParts(parts);
    const hasImageEmote = parts.some((part) => part.type === "image");
    const visualFontSize =
      emoteOnly && !hasImageEmote ? Math.round(fontSize * 1.45) : fontSize;
    const emoteSize = Math.round(visualFontSize * (emoteOnly ? 1.65 : 1.15));

    const mctx = this.measureCtx;
    if (mctx) {
      mctx.font = `700 ${visualFontSize}px ${this.fontFamily}`;
    }

    let totalWidth = 0;
    for (const part of parts) {
      if (part.type === "text") {
        totalWidth += mctx ? mctx.measureText(part.text).width : part.text.length * visualFontSize;
      } else if (part.type === "emoji") {
        totalWidth += mctx
          ? mctx.measureText(part.emoji).width
          : visualFontSize * 1.2;
      } else {
        totalWidth += emoteSize + 2;
      }
    }

    return {
      id: input.id,
      parts,
      emoteOnly,
      hasImageEmote,
      fontSize,
      visualFontSize,
      emoteSize,
      width: Math.max(1, Math.ceil(totalWidth)),
      height: Math.max(Math.ceil(visualFontSize * 1.25), emoteSize),
      rawColor: input.color,
    };
  }

  private acquireNode(): HTMLDivElement {
    const pooled = this.nodePool.pop();
    if (pooled) return pooled;

    const node = document.createElement("div");
    node.style.position = "absolute";
    node.style.top = "0";
    node.style.left = "0";
    node.style.display = "inline-block";
    node.style.whiteSpace = "pre";
    node.style.fontWeight = "700";
    node.style.lineHeight = "1.25";
    node.style.pointerEvents = "none";
    node.style.userSelect = "none";
    node.style.willChange = "transform";
    node.style.backfaceVisibility = "hidden";
    node.style.contain = "layout style";
    node.style.visibility = "hidden";
    this.stage.appendChild(node);
    return node;
  }

  private mountBullet(bullet: ActiveBullet): void {
    const node = this.acquireNode();
    bullet.node = node;

    node.style.fontSize = `${bullet.visualFontSize}px`;
    node.style.color = bullet.color;
    node.style.textShadow = bullet.emoteOnly ? "none" : "var(--danmu-text-shadow)";

    const { parts, emoteSize } = bullet;
    if (parts.length === 1 && parts[0].type === "text") {
      node.textContent = parts[0].text;
    } else {
      node.textContent = "";
      for (const part of parts) {
        if (part.type === "text") {
          node.appendChild(document.createTextNode(part.text));
        } else if (part.type === "emoji") {
          const span = document.createElement("span");
          span.textContent = part.emoji;
          span.style.textShadow = "none";
          node.appendChild(span);
        } else {
          const img = document.createElement("img");
          img.src = part.src;
          img.alt = part.name;
          img.draggable = false;
          img.decoding = "async";
          img.style.cssText = `display:inline-block;width:${emoteSize}px;height:${emoteSize}px;margin:0 1px;vertical-align:-0.2em;object-fit:contain;user-select:none;`;
          node.appendChild(img);
        }
      }
    }

    node.style.visibility = "visible";
    this.startBulletAnimation(bullet, bullet.segmentDuration);
  }

  private startBulletAnimation(bullet: ActiveBullet, durationMs: number): void {
    this.stopBulletAnimation(bullet);
    const { node } = bullet;
    if (!node) return;

    const y = Math.round(bullet.y);
    const startTransform = `translate3d(${Math.round(bullet.startX)}px, ${y}px, 0)`;
    const endTransform =
      bullet.mode === "scroll"
        ? `translate3d(${Math.round(-bullet.width - 8)}px, ${y}px, 0)`
        : startTransform;
    const validDuration = Math.max(16, Math.round(durationMs));

    if (typeof node.animate === "function") {
      const anim = node.animate(
        [{ transform: startTransform }, { transform: endTransform }],
        {
          duration: validDuration,
          easing: "linear",
          fill: "forwards",
        },
      );
      bullet.animation = anim;
      anim.onfinish = () => {
        if (bullet.animation !== anim) return;
        this.retireBullet(bullet);
      };
    } else {
      node.style.transform = startTransform;
      bullet.fallbackTimer = window.setTimeout(() => {
        bullet.fallbackTimer = 0;
        this.retireBullet(bullet);
      }, validDuration);
    }
  }

  private stopBulletAnimation(bullet: ActiveBullet): void {
    if (bullet.animation) {
      const anim = bullet.animation;
      bullet.animation = null;
      anim.onfinish = null;
      try {
        anim.cancel();
      } catch {
        /* ignore */
      }
    }
    if (bullet.fallbackTimer !== 0) {
      window.clearTimeout(bullet.fallbackTimer);
      bullet.fallbackTimer = 0;
    }
  }

  private releaseBulletNode(bullet: ActiveBullet): void {
    this.stopBulletAnimation(bullet);
    const { node } = bullet;
    if (!node) return;
    bullet.node = null;
    node.style.visibility = "hidden";
    node.textContent = "";

    if (!this.disposed && this.nodePool.length < MAX_NODE_POOL) {
      this.nodePool.push(node);
    } else {
      node.remove();
    }
  }

  private retireBullet(bullet: ActiveBullet): void {
    const idx = this.active.indexOf(bullet);
    if (idx !== -1) {
      this.active.splice(idx, 1);
    }
    this.releaseBulletNode(bullet);

    if (!this.disposed && this.waiting.length > 0) {
      this.flushWaiting(performance.now());
    }
  }
}
