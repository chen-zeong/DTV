import { useEffect, useRef, useState } from "react";
import type { DanmakuMessage } from "@/api";
import { hashColor } from "@/lib/format";
import styles from "./DanmuOverlay.module.css";

const TRACKS = 6;
const FLY_MS = 8500;
const MAX_SEEN = 400;

interface FlyingItem {
  key: string;
  text: string;
  nickname: string;
  color: string;
  track: number;
}

/**
 * 视频上的滚动弹幕层。
 *
 * 旧项目用 danmu.js（1 万+ 行的第三方库）+ 一个 400 行的适配层，
 * 并且存在两个真 bug：设置面板的"速度/颜色"永远不生效（被硬编码值覆盖）。
 * 这里用 CSS 动画自己实现，行为可预测、零依赖：
 *  - 6 条轨道轮转分配
 *  - 每条独立动画，结束后自动移除
 *  - 颜色：消息自带 color 优先，否则按昵称哈希取色
 */
export function DanmuOverlay({
  messages,
  enabled,
}: {
  messages: DanmakuMessage[];
  enabled: boolean;
}) {
  const [flying, setFlying] = useState<FlyingItem[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const trackRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setFlying([]);
      return;
    }
    const fresh = messages.filter((m) => m.kind === "chat" && !seenRef.current.has(m.id));
    if (fresh.length === 0) return;

    for (const m of fresh) {
      seenRef.current.add(m.id);
      if (seenRef.current.size > MAX_SEEN) {
        const keys = Array.from(seenRef.current).slice(0, seenRef.current.size - MAX_SEEN);
        keys.forEach((k) => seenRef.current.delete(k));
      }
    }

    const items: FlyingItem[] = fresh.map((m) => ({
      key: m.id,
      text: m.content,
      nickname: m.nickname,
      color: m.color ?? hashColor(m.nickname),
      track: trackRef.current++ % TRACKS,
    }));

    setFlying((prev) => [...prev.slice(-60), ...items]);
    const ids = new Set(items.map((i) => i.key));
    window.setTimeout(() => {
      setFlying((prev) => prev.filter((i) => !ids.has(i.key)));
    }, FLY_MS + 800);
  }, [messages, enabled]);

  if (!enabled) return null;

  return (
    <div className={styles.overlay} aria-hidden="true">
      {flying.map((item) => (
        <div
          key={item.key}
          className={styles.item}
          style={{
            top: `${(item.track / TRACKS) * 78 + 4}%`,
            color: item.color,
            animationDuration: `${FLY_MS}ms`,
          }}
        >
          <span className={styles.nickname}>{item.nickname}：</span>
          {item.text}
        </div>
      ))}
    </div>
  );
}
