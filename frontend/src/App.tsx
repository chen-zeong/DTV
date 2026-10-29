import { BrowserRouter } from "react-router-dom";
import { AppRoutes } from "./routes";
import { CustomCategoriesProvider } from "./state/CustomCategoriesProvider";
import { FollowProvider } from "./state/FollowProvider";
import { PlayerUiProvider } from "./state/PlayerUiProvider";
import { ThemeProvider } from "./state/ThemeProvider";

/**
 * 应用根组件。
 *
 * Provider 顺序与旧项目一致（Theme → Follow → PlayerUi → Custom），
 * 但因为每个 Provider 的 value 都做了 useMemo，且状态彼此独立，
 * 不再出现旧版"改主题导致整个 Navbar 重渲染"的连锁更新。
 */
export function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <FollowProvider>
          <PlayerUiProvider>
            <CustomCategoriesProvider>
              <AppRoutes />
            </CustomCategoriesProvider>
          </PlayerUiProvider>
        </FollowProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
