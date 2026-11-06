import * as DanmuModule from "danmu.js";
import type DanmuJs from "danmu.js";
import type { DanmuComment, DanmuOptions } from "danmu.js";
import { useEffect, useRef, type CSSProperties } from "react";
import type { DanmakuMessage, LivePlatform } from "@/api";
import { splitEmoticons } from "@/lib/emoticons";
import { sanitizeDanmuArea, sanitizeDanmuOpacity, type DanmuUserSettings } from "./danmuSettings";
import styles from "./DanmuOverlay.module.css";

/**
 * danmu.js 的 npm 包是 CJS/UMD，导出形状是 `{ default, DanmuJs }`；
 * 不同打包器对 default 的互操作不一致，这里显式取命名导出再兜底 default。
 */
type DanmuConstructor = new (options: DanmuOptions) => DanmuJs;
const DanmuJsCtor: DanmuConstructor | undefined =
  (DanmuModule as unknown as { DanmuJs?: DanmuConstructor }).DanmuJs ??
  (DanmuModule as unknown as { default?: DanmuConstructor }).default;

/*
 * 弹幕库换成 bytedance/danmu.js。
 *
 * 为什么换：
 *   - 库本身按"直播弹幕"设计，提供 track/channel 分配、防重叠和丢弃策略；
 *   - 更新时间线由内部定时器驱动，不需要我们自己维护 requestAnimationFrame；
 *   - 原生支持 top / bottom / scroll 三种模式，后续接弹幕发送也方便。
 *
 * 直播场景没有 <video> 时间轴可同步，这里用一个"假 player"提供持续递增的
 * currentTime，并打开 live 模式。库会把每条 sendComment 的 start 归一到
 * 当前时间，只保留最近几秒的数据，适合一直挂着的直播间。
 */

const MAX_SEEN = 400;
/** danmu.js 的最短显示时长；低于这个值时库的轨道回收会出问题。 */
const MIN_DURATION = 5000;

function parseFontSize(raw: string): number {
  const value = parseInt(raw, 10);
  return Number.isFinite(value) ? value : 20;
}

function messageColor(raw: string | undefined): string | undefined {
  const value = String(raw ?? "").trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : undefined;
}

/** 单条弹幕 DOM：文字 + 官方表情图。danmu.js 会 clone 这个节点。 */
function createCommentNode(
  content: string,
  options: { color: string; fontSize: number; platform?: LivePlatform },
): HTMLElement {
  const root = document.createElement("span");
  root.className = styles.comment ?? "";
  root.style.fontSize = `${options.fontSize}px`;
  root.style.color = options.color;

  for (const part of splitEmoticons(content, options.platform)) {
    if (part.type === "text") {
      root.appendChild(document.createTextNode(part.text));
    } else if (part.type === "emoji") {
      root.appendChild(document.createTextNode(part.emoji));
    } else {
      const img = document.createElement("img");
      img.className = styles.emote ?? "";
      img.src = part.src;
      img.alt = part.name;
      img.draggable = false;
      img.decoding = "async";
      root.appendChild(img);
    }
  }

  return root;
}

export function DanmuOverlay({
  messages,
  enabled,
  settings,
  colorfulSupported = false,
  platform,
}: {
  messages: DanmakuMessage[];
  enabled: boolean;
  settings: DanmuUserSettings;
  colorfulSupported?: boolean;
  platform?: LivePlatform;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const danmuRef = useRef<DanmuJs | null>(null);
  const seenRef = useRef<Set<string>>(new Set());

  const fontSize = parseFontSize(settings.fontSize);
  const area = sanitizeDanmuArea(settings.area);
  const duration = Math.max(MIN_DURATION, settings.duration);
  const opacity = sanitizeDanmuOpacity(settings.opacity);
  const mode = settings.mode ?? "scroll";

  /* 建实例时的设置：后续通过 setter 同步，不重建实例（重建会清屏） */
  const initialRef = useRef({ area, duration, enabled, fontSize, opacity });
  initialRef.current = { area, duration, enabled, fontSize, opacity };

  useEffect(() => {
    const container = overlayRef.current;
    if (!container) return;

    const initial = initialRef.current;
    const seen = seenRef.current;
    const clock = { currentTime: 0.001 };
    const startedAt = performance.now();
    const clockTimer = window.setInterval(() => {
      clock.currentTime = Math.max(0.001, (performance.now() - startedAt) / 1000);
    }, 500);

    let danmu: DanmuJs | null = null;
    try {
      if (!DanmuJsCtor) throw new Error("danmu.js 未导出 DanmuJs 构造函数");
      danmu = new DanmuJsCtor({
        container,
        // 直播没有可 seek 的 video，用假 player 让库走 live 分支：
        // 收到 realTime 弹幕立即上轨，同时按当前时间丢弃过期队列。
        player: clock as unknown as HTMLVideoElement,
        live: true,
        direction: "r2l",
        comments: [],
        interval: 2000,
        bOffset: 0,
        mouseControl: false,
        area: { start: 0, end: initial.area },
        channelSize: Math.round(initial.fontSize * 1.5),
      });
      danmu.start();
      danmu.setOpacity(initial.enabled ? initial.opacity : 0);
      danmuRef.current = danmu;
    } catch (error) {
      console.warn("[Danmu] 初始化 danmu.js 失败", error);
    }

    return () => {
      window.clearInterval(clockTimer);
      danmuRef.current = null;
      seen.clear();
      try {
        danmu?.stop();
      } catch {
        // 卸载过程中的异常忽略
      }
      // danmu.js 的 Channel 在构造函数里挂了一个 50ms 的 resize 定时器，
      // 库没有 destroy API，stop() 也不会清它，这里手动收掉，避免切房间累积。
      const resizeTimer = (danmu as unknown as { bulletResizeTimer?: number } | null)
        ?.bulletResizeTimer;
      if (resizeTimer) window.clearInterval(resizeTimer);
    };
  }, []);

  /* 设置变化：区域、透明度、字号、滚动时长、开关 */
  useEffect(() => {
    const danmu = danmuRef.current;
    if (!danmu) return;
    try {
      danmu.setArea({ start: 0, end: area });
      danmu.setOpacity(enabled ? opacity : 0);
      danmu.setFontSize(fontSize, Math.round(fontSize * 1.5));
      danmu.setAllDuration("scroll", duration);
      if (enabled) {
        danmu.play();
        danmu.show("scroll");
        danmu.show("top");
        danmu.show("bottom");
      } else {
        danmu.hide("scroll");
        danmu.hide("top");
        danmu.hide("bottom");
      }
    } catch (error) {
      console.warn("[Danmu] 同步弹幕设置失败", error);
    }
  }, [area, duration, enabled, fontSize, opacity]);

  /* 清空房间 / 切换房间 */
  useEffect(() => {
    if (messages.length !== 0) return;
    seenRef.current.clear();
    const danmu = danmuRef.current;
    if (!danmu) return;
    try {
      danmu.stop();
      if (enabled) danmu.start();
    } catch {
      // 忽略
    }
  }, [enabled, messages.length]);

  /* 增量消息塞给 danmu.js */
  useEffect(() => {
    if (!enabled) return;
    const danmu = danmuRef.current;
    if (!danmu) return;

    const fresh: DanmakuMessage[] = [];
    for (const message of messages) {
      if (message.kind !== "chat" || seenRef.current.has(message.id)) continue;
      fresh.push(message);
    }
    if (fresh.length === 0) return;

    for (const message of fresh) {
      seenRef.current.add(message.id);
      if (seenRef.current.size > MAX_SEEN) {
        const keys = Array.from(seenRef.current).slice(0, seenRef.current.size - MAX_SEEN);
        keys.forEach((key) => seenRef.current.delete(key));
      }
    }

    for (const message of fresh) {
      const nativeColor =
        colorfulSupported && settings.colorful ? messageColor(message.color) : undefined;
      const color = nativeColor ?? settings.color;
      const comment: DanmuComment = {
        id: message.id,
        el: createCommentNode(message.content, { color, fontSize, platform }),
        duration,
        mode,
        realTime: true,
        noDiscard: false,
      };
      try {
        danmu.sendComment(comment);
      } catch (error) {
        console.warn("[Danmu] 发送弹幕失败", error);
      }
    }
  }, [
    colorfulSupported,
    duration,
    enabled,
    fontSize,
    messages,
    mode,
    platform,
    settings.color,
    settings.colorful,
    settings.mode,
  ]);

  return (
    <div
      ref={overlayRef}
      className={styles.overlay}
      style={{ "--danmu-stroke-color": settings.strokeColor } as CSSProperties}
      aria-hidden="true"
    />
  );
}
