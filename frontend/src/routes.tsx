import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { SignalMark } from "@/components/common/SignalMark";
import { AppShell } from "@/components/shell/AppShell";
import { NotFoundPage } from "@/screens/NotFoundPage";
import styles from "./routes.module.css";
/**
 * 播放页单独拆包（P-01）。
 *
 * xgplayer + 弹幕库 + 播放器控制条只在进入直播间时下载/解析，
 * 首页首屏不再为它们付出体积与执行成本。卡片 hover 时由
 * StreamerCard 预取同一个 import()，点进去几乎无等待。
 */
const PlayerPage = lazy(() =>
  import("@/screens/PlayerPage").then((module) => ({ default: module.PlayerPage })),
);

/**
 * 播放页外壳：按「平台 + 房间号」给 PlayerPage 一个 key。
 *
 * 同一个路由从 A 房间跳到 B 房间时，React 会复用同一个组件实例，只能靠
 * effect 依赖变化去清理上一个房间的播放器 / 弹幕连接 / 定时器 —— 实测会出现
 * "旧直播间还在播（声音没断）、新直播间只是叠上去"的情况。
 * 加上 key 之后换房间等于整页重建：播放器 destroy、弹幕退订、定时器清理
 * 全部走正常卸载路径，不会残留旧实例。
 */
function PlayerRoute() {
  const [params] = useSearchParams();
  const roomKey = `${params.get("platform") ?? ""}:${params.get("roomId") ?? ""}`;
  return <PlayerPage key={roomKey} />;
}

/**
 * 路由表。
 *
 * 旧项目是 Next.js App Router 的 6 个 app/{平台}/page.tsx，URL 带尾斜杠
 *（trailingSlash: true），且 `usePathname()` 的比较在 4 个组件里各自硬编码。
 * 这里集中一张表；URL 形状保持一致（含 /player?platform=&roomId=），
 * 以便沿用旧的深链接习惯。
 *
 * `/custom` 是旧版"自定义分区"的地址，现在改叫订阅分区（`/subscribe`），
 * 保留一条重定向，旧的书签/深链接不会 404。
 */
export const ROUTES = {
  home: "/",
  huya: "/huya",
  douyin: "/douyin",
  bilibili: "/bilibili",
  subscribe: "/subscribe",
  custom: "/custom",
  player: "/player",
} as const;

function PlayerFallback() {
  return (
    <div className={styles.playerFallback} aria-busy="true">
      <SignalMark size={30} animated />
      <span>正在准备播放器…</span>
    </div>
  );
}

/** 首页由 AppShell 里的 HomeStack 常驻渲染，路由只需要占位。 */
function HomeRoute() {
  return null;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/huya" element={<HomeRoute />} />
        <Route path="/douyin" element={<HomeRoute />} />
        <Route path="/bilibili" element={<HomeRoute />} />
        <Route path="/subscribe" element={<HomeRoute />} />
        <Route path="/custom" element={<Navigate to="/subscribe" replace />} />
        <Route
          path="/player"
          element={
            <Suspense fallback={<PlayerFallback />}>
              <PlayerRoute />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
