import { Activity, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { SubscriptionsPage } from "@/screens/SubscriptionsPage";

/** 订阅页也是主播列表入口，和平台首页一样常驻，进入直播间再返回不丢状态。 */
export function SubscribeStack() {
  const { pathname } = useLocation();
  const active = pathname.startsWith("/subscribe") || pathname.startsWith("/custom");
  const [visited, setVisited] = useState(active);

  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);

  return (
    <Activity mode={active ? "visible" : "hidden"}>
      {(visited || active) ? <SubscriptionsPage /> : null}
    </Activity>
  );
}
