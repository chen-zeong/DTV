import { useEffect, useState } from "react";
import { closeWindow, isMaximised, minimiseWindow, toggleMaximiseWindow, useDesktopOS } from "@/lib/window";
import styles from "./PlayerCaptionButtons.module.css";

/**
 * 系统全屏下叠加在播放器右上角的三个窗口按钮。
 *
 * 进入 DOM 全屏（真正的系统全屏）后应用自己的标题栏被隐藏，窗口就只剩
 * 播放器——所以把「最小化 / 最大化还原 / 关闭」搬到画面右上角。
 *
 * 视觉按 Win11 原生标题栏按钮做：46×32 无背景，悬停浅色浮层，
 * 关闭键悬停转为 Win11 的 #C42B1C 红；图标用 10×10 的 1px 描边，
 * 与系统按钮同尺寸、同线宽。
 *
 * 组件本身不负责显隐：它渲染在播放器的 chrome 层里，跟着控制栏一起淡出。
 */
export function PlayerCaptionButtons({ className }: { className?: string }) {
  const os = useDesktopOS();
  const [maximised, setMaximised] = useState(false);

  useEffect(() => {
    void isMaximised().then(setMaximised);
    // 用户用系统手势 / 贴靠布局改变状态时同步图标
    const sync = () => void isMaximised().then(setMaximised);
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  // macOS 全屏有自己的红绿灯，不重复画
  if (os === "darwin") return null;

  const onToggleMaximise = () => {
    void toggleMaximiseWindow();
    setMaximised((value) => !value);
  };

  return (
    <div className={`${styles.controls} ${className ?? ""}`}>
      <button
        type="button"
        className={styles.btn}
        onClick={() => void minimiseWindow()}
        aria-label="最小化"
        title="最小化"
      >
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      </button>

      <button
        type="button"
        className={styles.btn}
        onClick={onToggleMaximise}
        aria-label={maximised ? "还原" : "最大化"}
        title={maximised ? "还原" : "最大化"}
      >
        {maximised ? (
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <path
              d="M2.5 2.5V1.5A1 1 0 0 1 3.5.5h5A1 1 0 0 1 9.5 1.5v5a1 1 0 0 1-1 1h-1"
              stroke="currentColor"
              strokeWidth="1"
              fill="none"
              strokeLinecap="round"
            />
            <rect
              x="0.5"
              y="3.5"
              width="6"
              height="6"
              rx="1"
              stroke="currentColor"
              strokeWidth="1"
              fill="none"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <rect
              x="0.5"
              y="0.5"
              width="9"
              height="9"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1"
              fill="none"
            />
          </svg>
        )}
      </button>

      <button
        type="button"
        className={`${styles.btn} ${styles.close}`}
        onClick={() => void closeWindow()}
        aria-label="关闭"
        title="关闭"
      >
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path
            d="M0 0l10 10M10 0L0 10"
            stroke="currentColor"
            strokeWidth="1"
            fill="none"
          />
        </svg>
      </button>
    </div>
  );
}
