import { Filter, Plus, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { usePortalHost } from "@/lib/portal";
import { DANMU_BLOCK_MAX_KEYWORDS } from "./danmuSettings";
import styles from "./DanmuBlockControl.module.css";

interface DanmuBlockControlProps {
  /** 已屏蔽的关键词（顺序即添加顺序） */
  keywords: string[];
  onAdd: (keyword: string) => void;
  onRemove: (keyword: string) => void;
  onClear: () => void;
  /** 打开/关闭弹层时通知控制栏（弹层打开时不要自动隐藏 chrome） */
  onOpenChange?: (open: boolean) => void;
}

/**
 * 控制栏里的"弹幕屏蔽"入口（对齐老项目的 DanmuKeywordBlockControl）。
 *
 * 老版是 xgplayer 插件 + 手写 DOM；这里换成 React 弹层，交互保持一致：
 * 输入关键词回车/点添加 → 变成可点击删除的标签，另有"清空"。
 * 关键词对所有平台生效，存 `danmu_block_keywords`。
 */
export function DanmuBlockControl({
  keywords,
  onAdd,
  onRemove,
  onClear,
  onOpenChange,
}: DanmuBlockControlProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const portalHost = usePortalHost();
  const [pos, setPos] = useState<{
    left: number;
    bottom: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const setOpenState = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
      if (!next) setDraft("");
    },
    [onOpenChange],
  );

  const updatePosition = useCallback(() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 248;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const bottom = Math.max(8, window.innerHeight - rect.top + 10);
    const maxHeight = Math.max(200, Math.min(420, rect.top - 20));
    setPos({ left, bottom, width, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpenState(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenState(false);
    };
    document.addEventListener("mousedown", onDown);
    // 捕获阶段：xgplayer 的全局键盘插件会在 document 上 stopPropagation，
    // 冒泡阶段收不到 Escape，弹层就关不掉。
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, setOpenState]);

  const submit = useCallback(() => {
    const value = draft.trim();
    if (!value) return;
    onAdd(value);
    setDraft("");
    inputRef.current?.focus();
  }, [draft, onAdd]);

  const full = keywords.length >= DANMU_BLOCK_MAX_KEYWORDS;

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={cn(styles.trigger, keywords.length > 0 && styles.triggerOn)}
        onClick={() => setOpenState(!open)}
        aria-label="弹幕屏蔽"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          keywords.length > 0 ? `弹幕屏蔽（已屏蔽 ${keywords.length} 个词）` : "弹幕屏蔽"
        }
      >
        <Filter size={16} strokeWidth={2} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className={styles.panel}
            role="dialog"
            aria-label="弹幕屏蔽"
            style={{
              left: pos.left,
              bottom: pos.bottom,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
          >
            <div className={styles.header}>
              <span className={styles.title}>弹幕屏蔽</span>
              <div className={styles.headerActions}>
                <button
                  type="button"
                  className={styles.textBtn}
                  onClick={onClear}
                  disabled={keywords.length === 0}
                >
                  清空
                </button>
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={() => setOpenState(false)}
                  aria-label="关闭"
                >
                  <X size={13} strokeWidth={2.6} />
                </button>
              </div>
            </div>

            <div className={styles.inputRow}>
              <input
                ref={inputRef}
                className={styles.input}
                value={draft}
                placeholder={full ? "关键词已达上限" : "输入关键词，回车添加"}
                spellCheck={false}
                maxLength={40}
                disabled={full}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              <button
                type="button"
                className={styles.addBtn}
                onClick={submit}
                disabled={!draft.trim() || full}
                aria-label="添加关键词"
              >
                <Plus size={13} strokeWidth={2.6} />
                添加
              </button>
            </div>

            <div className={styles.keywords}>
              {keywords.length === 0 ? (
                <p className={styles.emptyHint}>还没有屏蔽词，含关键词的弹幕会被隐藏</p>
              ) : (
                keywords.map((keyword) => (
                  <button
                    key={keyword}
                    type="button"
                    className={styles.pill}
                    onClick={() => onRemove(keyword)}
                    title={`点击移除「${keyword}」`}
                  >
                    <span className={styles.pillText}>{keyword}</span>
                    <X size={10} strokeWidth={2.8} />
                  </button>
                ))
              )}
            </div>

            <p className={styles.hint}>关键词对所有平台生效</p>
          </div>,
          portalHost,
        )}
    </div>
  );
}
