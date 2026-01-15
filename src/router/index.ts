import { createRouter, createWebHistory } from "vue-router";
import type { Platform } from "../platforms/common/types";

const PlatformHomeView = () => import("../pages/PlatformHomeView.vue");
const UniversalPlayerView = () => import("../pages/UniversalPlayerView.vue");

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/:platform?",
      name: "PlatformHome",
      component: PlatformHomeView,
    },
    {
      path: "/player/:platform/:roomId",
      name: "UniversalPlayer",
      component: UniversalPlayerView,
      props: (route) => ({
        roomId: String(route.params.roomId ?? ""),
        platform: String(route.params.platform ?? "")
          .toUpperCase() as Platform,
      }),
    },
  ],
});

export default router;