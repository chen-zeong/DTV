<template>
  <div class="flex h-screen flex-col overflow-hidden bg-app-bg text-text-main">
    <Navbar
      v-show="!shouldHidePlayerChrome"
      :theme="theme"
      :active-platform="activePlatform"
      @theme-toggle="toggleTheme"
      @select-anchor="handleSelectAnchorFromSearch"
    />

    <div class="flex min-h-0 flex-1 overflow-hidden">
      <main
        class="relative min-h-0 flex-1 overflow-y-auto"
        :class="{ 'p-0': isPlayerRoute }"
      >
        <router-view
          v-slot="{ Component, route }"
          @follow="handleFollowStore"
          @unfollow="handleUnfollowStore"
          @fullscreen-change="handleFullscreenChange"
        >
          <keep-alive :include="['PlatformHomeView']">
            <component
              :is="Component"
              :key="route.name === 'UniversalPlayer' ? route.path : 'home'"
            />
          </keep-alive>
        </router-view>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Navbar from "./components/layout/Navbar.vue";
import type { UiPlatform } from "./platforms/common/types";
import { useThemeStore } from "./stores/theme";
import { useFollowStore } from "./stores/followStore";
import { Platform } from "./platforms/common/types";
import type { FollowedStreamer } from "./platforms/common/types";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import "./styles/global.css";

const router = useRouter();
const route = useRoute();
const followStore = useFollowStore();

const isPlayerFullscreen = ref(false);
const isWindowMaximized = ref(false);
const currentWindow = typeof window !== "undefined" ? getCurrentWindow() : null;
let unlistenResize: UnlistenFn | null = null;

const themeStore = useThemeStore();
const theme = computed(() => themeStore.getEffectiveTheme());

const routePlatform = computed<UiPlatform>(() => {
  const platform = route.params.platform as string | undefined;
  if (platform) return platform.toLowerCase() as UiPlatform;
  return "douyu";
});

const activePlatform = computed<UiPlatform>(() => routePlatform.value);

const syncWindowMaximizedState = async () => {
  if (!currentWindow) {
    return;
  }
  try {
    isWindowMaximized.value = await currentWindow.isMaximized();
  } catch (error) {
    console.error("[App] Failed to query maximized state", error);
  }
};

onMounted(async () => {
  if (!currentWindow) {
    return;
  }
  await syncWindowMaximizedState();
  try {
    unlistenResize = await currentWindow.onResized(syncWindowMaximizedState);
  } catch (error) {
    console.error("[App] Failed to listen for resize events", error);
  }
});

onBeforeUnmount(async () => {
  if (unlistenResize) {
    await unlistenResize();
    unlistenResize = null;
  }
});

const isPlayerRoute = computed(() => {
  return route.name === "UniversalPlayer";
});

const shouldHidePlayerChrome = computed(
  () => isPlayerRoute.value && isPlayerFullscreen.value,
);

const toggleTheme = () => {
  themeStore.setUserPreference(theme.value === "light" ? "dark" : "light");
};

const handleSelectAnchor = (streamer: FollowedStreamer) => {
  router.push({
    name: "UniversalPlayer",
    params: {
      platform: streamer.platform.toLowerCase(),
      roomId: streamer.id,
    },
  });
};

const handleSelectAnchorFromSearch = (payload: {
  id: string;
  platform: Platform;
  nickname?: string;
  avatarUrl?: string | null;
}) => {
  handleSelectAnchor({
    id: payload.id,
    platform: payload.platform,
    nickname: payload.nickname ?? payload.id,
    avatarUrl: payload.avatarUrl ?? "",
    currentRoomId: payload.id,
    liveStatus: "UNKNOWN",
  });
};

const handleFollowStore = (streamer: FollowedStreamer) => {
  followStore.followStreamer(streamer);
};

const handleUnfollowStore = (
  payload: { platform: Platform; id: string } | string,
) => {
  if (typeof payload === "string") {
    followStore.unfollowStreamer(Platform.DOUYU, payload);
  } else {
    followStore.unfollowStreamer(payload.platform, payload.id);
  }
};

const handleFullscreenChange = (isFullscreen: boolean) => {
  isPlayerFullscreen.value = isFullscreen;
};
</script>
