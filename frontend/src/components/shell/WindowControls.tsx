import { System } from "@wailsio/runtime";
import { useEffect, useState } from "react";
import { closeWindow, isMaximised, minimiseWindow, toggleMaximiseWindow } from "@/lib/window";
import styles from "./WindowControls.module.css";

/**
 * 自绘窗口控制按钮（最小化 / 最大化还原 / 关闭）。
 *
 * 旧版逻辑分散在 Navbar 与 MainPlayer 两处，各写一遍 Tauri 动态 import。
 * 这里统一到 lib/window，并且**按平台渲染**：macOS 用系统红绿灯
 * （Frameless + MacTitleBarHiddenInset 已经提供），不显示这一组。
 */
export function WindowControls({ className }: { className?: string }) {
  const [os, setOs] = useState<string | null>(null);
  const [maximised, setMaximised] = useState(false);

  useEffect(() => {
    // os 未知时（浏览器预览）默认按 Windows 显示
    System.Environment()
      .then((env) => setOs(env.OS))
      .catch(() => setOs(null));
    void isMaximised().then(setMaximised);
  }, []);

  if (os === "darwin") return null;

  const onToggleMaximise = () => {
    void toggleMaximiseWindow();
    setMaximised((v) => !v);
  };

  return (
    <div className={`${styles.controls} ${className ?? ""}`}>
      <button type="button" className={styles.btn} onClick={() => void minimiseWindow()} aria-label="最小化">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M6 12h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        </svg>
      </button>
      <button
        type="button"
        className={styles.btn}
        onClick={onToggleMaximise}
        aria-label={maximised ? "还原" : "最大化"}
      >
        {maximised ? (
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <rect x="4" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" fill="none" />
            <path d="M8 8V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.8" fill="none" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className={`${styles.btn} ${styles.close}`}
        onClick={() => void closeWindow()}
        aria-label="关闭"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        </svg>
      </button>
    </div>
  );
}
