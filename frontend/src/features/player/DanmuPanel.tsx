import { useEffect, useLayoutEffect, useRef } from "react";
import type { DanmakuMessage } from "@/api";
import { cn } from "@/lib/cn";
import { formatClock, hashColor } from "@/lib/format";
import styles from "./DanmuPanel.module.css";

const MAX_RENDER = 200;

/**
 * 右侧弹幕列表。
 *
 * 旧版 DanmuList 其实是**死组件**（全仓没有引用，右侧栏 CSS 也是死样式），
 * 且存在"无条件强制贴底，用户上滑就抢不过来的问题"。这里补上：
 *  - 用户上滑时暂停自动跟随，回到底部后恢复
 *  - 最多渲染 200 条
 *  - 显示用户等级与时间戳（旧版类型里有 level 但渲染层没用）
 */
export function DanmuPanel({
  messages,
  enabled,
}: {
  messages: DanmakuMessage[];
  enabled: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // 切换房间/清空时回到跟随状态
  useEffect(() => {
    stickRef.current = true;
  }, [messages.length === 0]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    stickRef.current = atBottom;
  };

  const visible = messages.slice(-MAX_RENDER);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>弹幕</span>
        <span className={styles.count}>{enabled ? `${visible.length} 条` : "已关闭"}</span>
      </div>
      <div className={styles.list} ref={listRef} onScroll={onScroll}>
        {visible.length === 0 ? (
          <p className={styles.empty}>暂无弹幕，正在连接…</p>
        ) : (
          visible.map((m) => (
            <div key={m.id} className={cn(styles.item, m.kind !== "chat" && styles.system)}>
              {m.kind === "chat" && (
                <span className={styles.meta}>
                  {m.level > 0 && <span className={styles.level}>Lv.{m.level}</span>}
                  <span className={styles.user} style={{ color: m.color ?? hashColor(m.nickname) }}>
                    {m.nickname}
                  </span>
                  <span className={styles.time}>{formatClock(m.at)}</span>
                </span>
              )}
              <span className={styles.text}>{m.content}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
