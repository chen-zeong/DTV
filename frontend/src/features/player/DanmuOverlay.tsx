import { useEffect, useRef } from "react";
import type { LivePlatform } from "@/api";
import { DanmuCanvasEngine } from "./danmuCanvasEngine";
import type { DanmakuFeed } from "./danmakuFeed";
import type { DanmuUserSettings } from "./danmuSettings";
import styles from "./DanmuOverlay.module.css";

/**
 * 视频上的弹幕层（B 站同款 GPU 合成器层 + DOM 节点对象池 + 离屏 measureText 零回流）。
 *
 * 核心设计：
 *   - 弹幕位移由 Chromium 合成器线程（Compositor Thread）驱动 translate3d，彻底脱离
 *     JS 主线程逐帧重绘，避免与 xgplayer-flv 直播流解复用争抢主线程导致全屏掉帧；
 *   - 离屏 Canvas measureText 预计算宽度 + DOM 节点池复用，全程零 getBoundingClientRect() 回流；
 *   - 通过 DanmakuFeed 直接订阅增量 chat 消息，不触发 PlayerPage 整页重渲染。
 */
export function DanmuOverlay({
  feed,
  enabled,
  settings,
  colorfulSupported = false,
  platform,
}: {
  feed: DanmakuFeed;
  enabled: boolean;
  settings: DanmuUserSettings;
  colorfulSupported?: boolean;
  platform?: LivePlatform;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<DanmuCanvasEngine | null>(null);

  const initialConfigRef = useRef({
    enabled,
    platform,
    colorfulSupported,
    settings,
  });
  initialConfigRef.current = {
    enabled,
    platform,
    colorfulSupported,
    settings,
  };

  useEffect(() => {
    const container = overlayRef.current;
    if (!container) return;

    const engine = new DanmuCanvasEngine(container, initialConfigRef.current);
    engineRef.current = engine;

    const offChat = feed.subscribeChat((message) => {
      engine.enqueue({
        id: message.id,
        content: message.content,
        color: message.color,
      });
    });
    const offClear = feed.subscribeClear(() => {
      engine.clear();
    });

    return () => {
      offChat();
      offClear();
      engine.destroy();
      engineRef.current = null;
    };
  }, [feed]);

  useEffect(() => {
    engineRef.current?.updateConfig({
      enabled,
      platform,
      colorfulSupported,
      settings,
    });
  }, [colorfulSupported, enabled, platform, settings]);

  return <div ref={overlayRef} className={styles.overlay} aria-hidden="true" />;
}
