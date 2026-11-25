import { useEffect, useRef } from "react";
import type { LivePlatform } from "@/api";
import { DanmuCanvasEngine } from "./danmuCanvasEngine";
import type { DanmakuFeed } from "./danmakuFeed";
import type { DanmuUserSettings } from "./danmuSettings";
import styles from "./DanmuOverlay.module.css";

/**
 * 视频上的弹幕层（单层 Canvas + 离屏位图缓存）。
 *
 * 相比旧版 DOM 方案（danmu.js）：
 *   - 全屏只占 1 个合成层，消除几十个 DOM 节点的 `getBoundingClientRect()` 回流；
 *   - 通过 DanmakuFeed 直接订阅增量 chat 消息，不再触发 PlayerPage 整页重渲染。
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
