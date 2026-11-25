import { useEffect, useMemo, useRef } from "react";
import { api, type DanmakuMessage, type LivePlatform } from "@/api";
import { isDanmuBlocked } from "./danmuSettings";

const MAX_MESSAGES = 300;
/** 右侧弹幕列表刷新间隔：约 8Hz，避免每条消息都触发 React 重渲染 */
const PANEL_FLUSH_MS = 120;

export type DanmuChatListener = (message: DanmakuMessage) => void;
export type DanmuClearListener = () => void;
export type DanmuListListener = () => void;

/**
 * 播放器弹幕数据通道（脱离 React 顶层 state）。
 *
 * 为什么拆分：
 *   - 直播间高并发时如果把 messages 放进 PlayerPage 的 state，每 120ms 就会
 *     触发整个千行播放页重渲染；
 *   - 视频弹幕层（Canvas）只需实时增量消费 chat 消息，不依赖历史列表；
 *   - 右侧弹幕面板通过 useSyncExternalStore 单独订阅，只刷新面板本身。
 */
export class DanmakuFeed {
  private messages: DanmakuMessage[] = [];
  private panelBuffer: DanmakuMessage[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly chatListeners = new Set<DanmuChatListener>();
  private readonly clearListeners = new Set<DanmuClearListener>();
  private readonly listListeners = new Set<DanmuListListener>();

  getMessages = (): DanmakuMessage[] => this.messages;

  subscribeList = (listener: DanmuListListener): (() => void) => {
    this.listListeners.add(listener);
    return () => {
      this.listListeners.delete(listener);
    };
  };

  subscribeChat = (listener: DanmuChatListener): (() => void) => {
    this.chatListeners.add(listener);
    return () => {
      this.chatListeners.delete(listener);
    };
  };

  subscribeClear = (listener: DanmuClearListener): (() => void) => {
    this.clearListeners.add(listener);
    return () => {
      this.clearListeners.delete(listener);
    };
  };

  push(message: DanmakuMessage): void {
    if (message.kind === "chat") {
      for (const listener of this.chatListeners) {
        listener(message);
      }
    }

    this.panelBuffer.push(message);
    if (this.panelBuffer.length > MAX_MESSAGES * 2) {
      this.panelBuffer.splice(0, this.panelBuffer.length - MAX_MESSAGES);
    }
    this.schedulePanelFlush();
  }

  clear(): void {
    this.stopFlushTimer();
    this.panelBuffer = [];
    if (this.messages.length > 0) {
      this.messages = [];
      for (const listener of this.listListeners) {
        listener();
      }
    }
    for (const listener of this.clearListeners) {
      listener();
    }
  }

  flushNow(): void {
    this.stopFlushTimer();
    if (this.panelBuffer.length === 0) return;
    const batch = this.panelBuffer;
    this.panelBuffer = [];
    const next = [...this.messages, ...batch];
    this.messages = next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
    for (const listener of this.listListeners) {
      listener();
    }
  }

  dispose(): void {
    this.stopFlushTimer();
    this.panelBuffer = [];
    this.messages = [];
    this.chatListeners.clear();
    this.clearListeners.clear();
    this.listListeners.clear();
  }

  private schedulePanelFlush(): void {
    if (this.flushTimer != null) return;
    this.flushTimer = globalThis.setTimeout(() => {
      this.flushTimer = null;
      this.flushNow();
    }, PANEL_FLUSH_MS);
  }

  private stopFlushTimer(): void {
    if (this.flushTimer != null) {
      globalThis.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

/**
 * 订阅房间弹幕并写入稳定的 DanmakuFeed，不触发调用方组件重渲染。
 */
export function useDanmakuFeed(
  platform: LivePlatform | undefined,
  roomId: string | undefined,
  enabled: boolean,
  blockKeywordsLower: readonly string[],
): DanmakuFeed {
  const feed = useMemo(() => new DanmakuFeed(), []);
  const keywordsRef = useRef<readonly string[]>(blockKeywordsLower);
  keywordsRef.current = blockKeywordsLower;

  useEffect(() => {
    if (!platform || !roomId || !enabled) {
      feed.clear();
      return;
    }
    feed.clear();
    const unsubscribe = api.subscribeDanmaku(platform, roomId, (msg) => {
      if (isDanmuBlocked(msg.content, keywordsRef.current)) return;
      feed.push(msg);
    });
    return () => {
      unsubscribe();
      feed.clear();
    };
  }, [enabled, feed, platform, roomId]);

  useEffect(() => () => feed.dispose(), [feed]);

  return feed;
}
