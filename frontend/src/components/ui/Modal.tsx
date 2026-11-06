import { X } from "lucide-react";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import styles from "./Modal.module.css";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 底部操作区（可选） */
  footer?: ReactNode;
  /** 面板宽度，默认 460px */
  width?: number;
  className?: string;
  /** 是否允许点击遮罩关闭，默认 true */
  dismissOnBackdrop?: boolean;
  labelId?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * 共享弹窗外壳（R-01 / U-22）。
 *
 * 统一处理：遮罩点击、Esc 关闭、焦点陷阱、关闭后焦点归还、aria-modal、
 * 出入场动画。业务弹窗只负责内容，不再各写一套 backdrop / 定位 / 关闭逻辑。
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 460,
  className,
  dismissOnBackdrop = true,
  labelId,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null || node === document.activeElement,
      );
      if (nodes.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // 打开后把焦点移进弹窗：优先第一个可聚焦控件，否则面板本身。
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={cn(styles.panel, className)}
        style={{ width: `min(${width}px, calc(100vw - 40px))` }}
        role="dialog"
        aria-modal="true"
        aria-label={labelId ? undefined : title}
        aria-labelledby={labelId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className={styles.header}>
          <h2 className={styles.title} id={labelId}>
            {title}
          </h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
          >
            <X size={15} strokeWidth={2.4} />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
