import { Activity, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import type { LivePlatform } from "@/api";
import { HomeScreen } from "@/screens/HomeScreen";

/** 当前路径对应的平台首页；播放页 / 订阅页返回 null。 */
export function homePlatformFromPath(pathname: string): LivePlatform | null {
  if (pathname === "/" || pathname === "") return "douyu";
  if (pathname.startsWith("/huya")) return "huya";
  if (pathname.startsWith("/douyin")) return "douyin";
  if (pathname.startsWith("/bilibili")) return "bilibili";
  return null;
}

/**
 * 平台首页的 keep-alive 容器。
 *
 * React Router 的路由切换会卸载页面，从直播间返回时首页会重新挂载、重新拉取
 * 分区和列表。这里把已经访问过的平台首页放进 React 19 的 <Activity>：
 *   - 可见时正常渲染（状态、DOM、滚动位置都保留）
 *   - 隐藏时保留 state，只卸载 effect（不会在播放页里误写 URL / 发请求）
 *
 * 因此退出直播间回到首页时，分区选择、列表数据与滚动位置都还在。
 */
export function HomeStack() {
  const { pathname } = useLocation();
  const active = homePlatformFromPath(pathname);
  const [visited, setVisited] = useState<LivePlatform[]>(() =>
    active ? [active] : [],
  );

  useEffect(() => {
    if (!active) return;
    setVisited((prev) => (prev.includes(active) ? prev : [...prev, active]));
  }, [active]);

  // 首次切到某个平台时，effect 还没落地；先在本轮渲染里补上，避免一帧空白
  const platforms =
    active && !visited.includes(active) ? [...visited, active] : visited;

  return (
    <>
      {platforms.map((platform) => (
        <Activity key={platform} mode={active === platform ? "visible" : "hidden"}>
          <HomeScreen platform={platform} />
        </Activity>
      ))}
    </>
  );
}
