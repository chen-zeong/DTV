import { Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { CustomHomePage } from "@/screens/CustomHomePage";
import { HomeScreen } from "@/screens/HomeScreen";
import { PlayerPage } from "@/screens/PlayerPage";
import { NotFoundPage } from "@/screens/NotFoundPage";

/**
 * 路由表。
 *
 * 旧项目是 Next.js App Router 的 6 个 app/{平台}/page.tsx，URL 带尾斜杠
 *（trailingSlash: true），且 `usePathname()` 的比较在 4 个组件里各自硬编码。
 * 这里集中一张表；URL 形状保持一致（含 /player?platform=&roomId=），
 * 以便沿用旧的深链接习惯。
 */
export const ROUTES = {
  home: "/",
  huya: "/huya",
  douyin: "/douyin",
  bilibili: "/bilibili",
  custom: "/custom",
  player: "/player",
} as const;

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomeScreen platform="douyu" />} />
        <Route path="/huya" element={<HomeScreen platform="huya" />} />
        <Route path="/douyin" element={<HomeScreen platform="douyin" />} />
        <Route path="/bilibili" element={<HomeScreen platform="bilibili" />} />
        <Route path="/custom" element={<CustomHomePage />} />
        <Route path="/player" element={<PlayerPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
