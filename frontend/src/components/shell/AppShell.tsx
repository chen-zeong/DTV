import { Outlet, useLocation } from "react-router-dom";
import { cn } from "@/lib/cn";
import { usePlayerUi } from "@/state/PlayerUiProvider";
import { HomeStack } from "./HomeStack";
import { Navbar } from "./Navbar";
import { Sidebar } from "./Sidebar";
import { SubscribeStack } from "./SubscribeStack";
import styles from "./AppShell.module.css";

/**
 * 应用外壳：左侧栏 + (顶栏 + 内容区)。
 *
 * 背景只有两层：实色地面 + 一层极淡的胶片颗粒（SVG 噪点，不是渐变）。
 * 颗粒放在独立图层里，避免给 body 伪元素加负 z-index（WebView2 下表现
 * 不稳定），也不会触发整页重绘。
 *
 * 播放页进入全屏时（hideChrome），外壳只留内容，保证视频铺满。
 */
export function AppShell() {
  const { pathname } = useLocation();
  const { isFullscreen } = usePlayerUi();
  const isPlayer = pathname.startsWith("/player");
  const hideChrome = isFullscreen;

  return (
    <div className={styles.appShell}>
      <div className={styles.backdrop} aria-hidden="true">
        <span className={styles.grain} />
      </div>

      {!hideChrome && <Sidebar />}
      <div className={styles.appMain}>
        {!hideChrome && <Navbar />}
        <main className={cn(styles.appBody, isPlayer && styles.appBodyPlayer)}>
          {/* 平台首页 / 订阅页常驻，用 Activity 在其它路由隐藏，实现 keep-alive */}
          <HomeStack />
          <SubscribeStack />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
