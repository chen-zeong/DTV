import { Outlet, useLocation } from "react-router-dom";
import { cn } from "@/lib/cn";
import { usePlayerUi } from "@/state/PlayerUiProvider";
import { Navbar } from "./Navbar";
import { Sidebar } from "./Sidebar";
import styles from "./AppShell.module.css";

/**
 * 应用外壳：左侧栏 + (顶栏 + 内容区)。
 *
 * 旧版 AppShell 有 hydrated / 未 hydrated 两套几乎相同的 DOM 结构，
 * 中间还套了 4 层纯布局垫片（appBodyContents / routeScope / routePendingWrap），
 * 以及一个 132×56 的路由切换 loading 遮罩。这里用单层结构 + 路由 transition 的
 * `useTransition` 语义（内容数据自带 loading 态），层次从 6 层降到 3 层。
 */
export function AppShell() {
  const { pathname } = useLocation();
  const { isFullscreen } = usePlayerUi();
  const isPlayer = pathname.startsWith("/player");
  const hideChrome = isFullscreen;

  return (
    <div className={styles.appShell}>
      {!hideChrome && <Sidebar />}
      <div className={styles.appMain}>
        {!hideChrome && <Navbar />}
        <main className={cn(styles.appBody, isPlayer && styles.appBodyPlayer)}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
