import { useEffect } from "react";
import { HashRouter, useLocation } from "react-router-dom";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { dismissSplash } from "./lib/splash";
import { AppRoutes } from "./routes";
import { BilibiliAuthProvider } from "./state/BilibiliAuthProvider";
import { DouyuAuthProvider } from "./state/DouyuAuthProvider";
import { FollowProvider } from "./state/FollowProvider";
import { PlayerUiProvider } from "./state/PlayerUiProvider";
import { SubscriptionProvider } from "./state/SubscriptionProvider";
import { ThemeProvider } from "./state/ThemeProvider";
import { ToastProvider } from "./state/ToastProvider";

/**
 * 应用根组件。
 *
 * 路由使用 HashRouter：Wails 的 AssetFileServerFS 没有 SPA fallback，
 * 在 /player 上按 F5 会 404；hash 路由在桌面端最稳（U-16）。
 *
 * Provider 顺序与旧项目一致（Theme → Follow → PlayerUi → Subscription），
 * 但因为每个 Provider 的 value 都做了 useMemo，且状态彼此独立，
 * 不再出现旧版"改主题导致整个 Navbar 重渲染"的连锁更新。
 */
export function App() {
  useEffect(() => {
    // React 首帧已提交，移除 index.html 的内联启动层。
    dismissSplash();

    const onError = (event: ErrorEvent) => {
      console.error("[window.onerror]", event.error ?? event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      console.error("[unhandledrejection]", event.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return (
    <ErrorBoundary>
      <HashRouter>
        <ThemeProvider>
          <ToastProvider>
            <FollowProvider>
              <BilibiliAuthProvider>
                <DouyuAuthProvider>
                  <PlayerUiProvider>
                    <SubscriptionProvider>
                      <RouteBoundary />
                    </SubscriptionProvider>
                  </PlayerUiProvider>
                </DouyuAuthProvider>
              </BilibiliAuthProvider>
            </FollowProvider>
          </ToastProvider>
        </ThemeProvider>
      </HashRouter>
    </ErrorBoundary>
  );
}

function RouteBoundary() {
  const { pathname } = useLocation();
  // 每个路由一个边界：一个页面崩了不影响其它页面，切换路由自动重置。
  return (
    <ErrorBoundary resetKey={pathname}>
      <AppRoutes />
    </ErrorBoundary>
  );
}
