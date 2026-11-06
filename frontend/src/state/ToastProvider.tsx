import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, Info, TriangleAlert, X } from "lucide-react";
import styles from "./ToastProvider.module.css";

export type ToastTone = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  action?: ToastAction;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_ICON = {
  success: Check,
  error: TriangleAlert,
  info: Info,
} as const;

/**
 * 轻量 toast。
 *
 * 只做一件事：把所有"复制成功 / 导入完成 / 已切换线路"这类一次性反馈
 * 收敛到同一个不打断操作的位置，避免 alert() 和散落各处的状态条。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer != null) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback<ToastContextValue["toast"]>(
    (message, tone = "info", action) => {
      const id = ++seq.current;
      setItems((prev) => [...prev.slice(-3), { id, tone, message, action }]);
      const timer = window.setTimeout(() => dismiss(id), action ? 6000 : 3200);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) window.clearTimeout(timer);
      map.clear();
    };
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.viewport} aria-live="polite" aria-atomic="false">
        {items.map((item) => {
          const Icon = TONE_ICON[item.tone];
          return (
            <div key={item.id} className={`${styles.toast} ${styles[item.tone]}`}>
              <Icon size={15} strokeWidth={2.4} className={styles.icon} />
              <span className={styles.message}>{item.message}</span>
              {item.action && (
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => {
                    item.action?.onClick();
                    dismiss(item.id);
                  }}
                >
                  {item.action.label}
                </button>
              )}
              <button
                type="button"
                className={styles.close}
                onClick={() => dismiss(item.id)}
                aria-label="关闭提示"
              >
                <X size={13} strokeWidth={2.4} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast 必须在 ToastProvider 内使用");
  return ctx;
}
