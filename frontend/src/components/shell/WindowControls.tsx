import { useEffect, useState } from "react";
import { closeWindow, isMacOS, isMaximised, minimiseWindow, toggleMaximiseWindow, useDesktopOS } from "@/lib/window";
import styles from "./WindowControls.module.css";

/**
 * 自绘窗口控制按钮（最小化 / 最大化还原 / 关闭）。
 *
 * 旧版逻辑分散在 Navbar 与 MainPlayer 两处，各写一遍 Tauri 动态 import。
 * 这里统一到 lib/window，并且**按平台渲染**：macOS 用系统红绿灯
 * （Frameless + MacTitleBarHiddenInset 已经提供），不显示这一组。
 *
 * Windows 上这三个按钮通过 CSS 标记（`--wails-non-client-region`）注册成
 * 原生非客户区，因此拥有系统按钮的命中测试 / 悬停捕获，最大化按钮还能弹出
 * Win11 贴靠布局。点击动作仍然走下面的 onClick。
 */
export function WindowControls({ className }: { className?: string }) {
  // os 未知时（浏览器预览）默认按 Windows 显示
  const os = useDesktopOS();
  const [maximised, setMaximised] = useState(false);

  useEffect(() => {
    void isMaximised().then(setMaximised);

    // 用户拖拽边框 / 双击标题栏 / 贴靠布局都能改变最大化状态，
    // 这里跟着窗口尺寸事件同步一次按钮图标。
    const sync = () => void isMaximised().then(setMaximised);
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  if (os === "darwin" || isMacOS()) return null;

  const onToggleMaximise = () => {
    void toggleMaximiseWindow();
    setMaximised((v) => !v);
  };

  return (
    <div className={`${styles.controls} ${className ?? ""}`}>
      <button
        type="button"
        className={`${styles.btn} ${styles.minimize}`}
        onClick={() => void minimiseWindow()}
        aria-label="最小化"
        title="最小化"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M6 12h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        </svg>
      </button>
      <button
        type="button"
        className={`${styles.btn} ${styles.maximize}`}
        onClick={onToggleMaximise}
        aria-label={maximised ? "还原" : "最大化"}
        title={maximised ? "还原" : "最大化"}
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
        className={`${styles.btn} ${styles.close} ${styles.closeBtn}`}
        onClick={() => void closeWindow()}
        aria-label="关闭"
        title="关闭"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        </svg>
      </button>
    </div>
  );
}
