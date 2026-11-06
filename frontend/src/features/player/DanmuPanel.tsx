import { ArrowDown, X } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DanmakuMessage, LivePlatform } from "@/api";
import { EmoticonText } from "@/components/common/EmoticonText";
import { cn } from "@/lib/cn";
import { hashColor } from "@/lib/format";
import styles from "./DanmuPanel.module.css";

const MAX_RENDER = 200;

/** 右侧弹幕面板的默认宽度 / 可拖拽范围（px）。
 * 默认比早先的 224 收窄一档：面板只承担"看最近几十条"，把空间留给画面。 */
export const DEFAULT_PANEL_WIDTH = 196;
export const PANEL_WIDTH_MIN = 168;
export const PANEL_WIDTH_MAX = 320;

/**
 * 单行弹幕。
 *
 * React.memo + 稳定的 message 引用：新弹幕批量进来时，旧行不会重渲染。
 * 系统消息（进场/礼物）单独一行、弱化颜色，不再伪装成"缺用户名的聊天"。
 */
const DanmuRow = memo(function DanmuRow({
  message,
  platform,
}: {
  message: DanmakuMessage;
  platform?: LivePlatform;
}) {
  const chat = message.kind === "chat";
  return (
    <div className={cn(styles.item, !chat && styles.system)}>
      {chat ? (
        <span className={styles.meta}>
          {message.level > 0 && <span className={styles.level}>Lv.{message.level}</span>}
          <span
            className={styles.user}
            style={{ color: hashColor(message.nickname) }}
          >
            {message.nickname}
          </span>
        </span>
      ) : (
        <span className={styles.systemIcon} aria-hidden="true">
          ·
        </span>
      )}
      <span className={styles.text}>
        <EmoticonText text={message.content} platform={platform} />
      </span>
    </div>
  );
});

/**
 * 右侧弹幕列表。
 *
 * 旧版 DanmuList 其实是**死组件**（全仓没有引用，右侧栏 CSS 也是死样式），
 * 且存在"无条件强制贴底，用户上滑就抢不过来的问题"。这里补上：
 *  - 用户上滑时暂停自动跟随，回到底部后恢复
 *  - 最多渲染 200 条
 *  - 显示用户等级与时间戳
 *  - P-04：滚动在 rAF 里执行；用户上滑后浮出"新弹幕"胶囊（U-20）
 *  - L-09：宽度可拖拽（168–320px，默认 196）
 */
export function DanmuPanel({
  messages,
  onClose,
  width = DEFAULT_PANEL_WIDTH,
  onWidthChange,
  platform,
}: {
  messages: DanmakuMessage[];
  onClose?: () => void;
  width?: number;
  onWidthChange?: (width: number) => void;
  platform?: LivePlatform;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const rafRef = useRef(0);
  const seenLenRef = useRef(0);
  const [pending, setPending] = useState(0);

  const visible = messages.filter((m) => m.kind !== "enter").slice(-MAX_RENDER);

  /* 贴底滚动放进 rAF：高频消息不再触发布局抖动 */
  useLayoutEffect(() => {
    if (!stickRef.current) return;
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [messages]);

  useEffect(() => {
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  /* 用户上滑时累计新消息数量 */
  useEffect(() => {
    const added = messages.length - seenLenRef.current;
    seenLenRef.current = messages.length;
    if (added > 0 && !stickRef.current) {
      setPending((n) => n + added);
    }
  }, [messages.length]);

  // 切换房间/清空时回到跟随状态
  useEffect(() => {
    if (messages.length !== 0) return;
    stickRef.current = true;
    seenLenRef.current = 0;
    setPending(0);
  }, [messages.length]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    stickRef.current = atBottom;
    if (atBottom) setPending(0);
  }, []);

  const jumpToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = true;
    setPending(0);
    el.scrollTop = el.scrollHeight;
  }, []);

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!onWidthChange) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const onMove = (moveEvent: PointerEvent) => {
        const next = Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, startWidth - (moveEvent.clientX - startX)));
        onWidthChange(next);
      };
      const onUp = () => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
    },
    [onWidthChange, width],
  );

  return (
    <div className={styles.panel} style={{ width, flex: `0 0 ${width}px` }}>
      {onWidthChange && (
        <div
          className={styles.resizer}
          onPointerDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整弹幕面板宽度"
          title="拖动调整宽度"
        />
      )}
      <div className={styles.header}>
        <span className={styles.title}>弹幕</span>
        <div className={styles.headerActions}>
          {onClose && (
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="关闭弹幕列表"
              title="关闭弹幕列表"
            >
              <X size={14} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
      <div className={styles.listWrap}>
        <div className={styles.list} ref={listRef} onScroll={onScroll}>
          {visible.length === 0 ? (
            <p className={styles.empty}>暂无弹幕，正在连接…</p>
          ) : (
            visible.map((m) => <DanmuRow key={m.id} message={m} platform={platform} />)
          )}
        </div>
        {pending > 0 && (
          <button type="button" className={styles.newPill} onClick={jumpToBottom}>
            <ArrowDown size={12} strokeWidth={2.6} />
            {pending} 条新弹幕
          </button>
        )}
      </div>
    </div>
  );
}
