<template>
  <div class="app-shell">
    <Sidebar
      v-show="!shouldHidePlayerChrome"
      :is-collapsed="isSidebarCollapsed"
      :followed-anchors="followedStreamers"
      @toggle="toggleSidebar"
      @select-anchor="handleSelectAnchor"
      @unfollow="handleUnfollowStore"
      @reorder-list="handleReorderListStore"
    />

    <div class="app-main">
      <Navbar
        v-show="!shouldHidePlayerChrome"
        :theme="theme"
        :active-platform="activePlatform"
        @theme-toggle="toggleTheme"
        @platform-change="handlePlatformChange"
        @select-anchor="handleSelectAnchorFromSearch"
      />

      <main class="app-body" :class="{ 'app-body--player': isPlayerRoute }">
        <router-view
          v-slot="{ Component, route }"
          @follow="handleFollowStore"
          @unfollow="handleUnfollowStore"
          @fullscreen-change="handleFullscreenChange"
        >
          <transition name="fade" mode="out-in">
            <keep-alive :include="['CustomHomeView', 'DouyuHomeView', 'DouyinHomeView', 'HuyaHomeView', 'BilibiliHomeView']">
              <component :is="Component" :key="route.path" />
            </keep-alive>
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Navbar from './layout/Navbar.vue';
import Sidebar from './layout/Sidebar.vue';
import type { Platform as UiPlatform } from './layout/types';
import { useThemeStore } from './stores/theme';
import { useFollowStore } from './store/followStore';
import { Platform } from './platforms/common/types';
import type { FollowedStreamer } from './platforms/common/types';
import './styles/global.css';

const router = useRouter();
const route = useRoute();
const followStore = useFollowStore();

const isSidebarCollapsed = ref(false);
const isPlayerFullscreen = ref(false);

const themeStore = useThemeStore();
const theme = computed(() => themeStore.getEffectiveTheme());

const routePlatform = computed<UiPlatform>(() => {
  const name = route.name as string | undefined;
  const path = route.path;
  if (name === 'CustomHome' || path.startsWith('/custom')) return 'custom';
  if (name === 'douyinPlayer' || name === 'DouyinHome' || path.startsWith('/douyin')) return 'douyin';
  if (name === 'huyaPlayer' || name === 'HuyaHome' || path.startsWith('/huya')) return 'huya';
  if (name === 'bilibiliPlayer' || name === 'BilibiliHome' || path.startsWith('/bilibili')) return 'bilibili';
  return 'douyu';
});

const activePlatform = computed<UiPlatform>(() => routePlatform.value);

const followedStreamers = computed<FollowedStreamer[]>(() => followStore.getFollowedStreamers);

const isPlayerRoute = computed(() => {
  const name = route.name as string | undefined;
  return (
    name === 'douyuPlayer' ||
    name === 'douyinPlayer' ||
    name === 'huyaPlayer' ||
    name === 'bilibiliPlayer'
  );
});

const shouldHidePlayerChrome = computed(() => (
  isPlayerRoute.value && isPlayerFullscreen.value
));

const toggleSidebar = () => {
  isSidebarCollapsed.value = !isSidebarCollapsed.value;
};

const toggleTheme = () => {
  themeStore.setUserPreference(theme.value === 'light' ? 'dark' : 'light');
};

const handlePlatformChange = (platform: UiPlatform | 'all') => {
  if (platform === 'custom') {
    router.push({ name: 'CustomHome' });
  } else if (platform === 'douyin') {
    router.push({ name: 'DouyinHome' });
  } else if (platform === 'huya') {
    router.push({ name: 'HuyaHome' });
  } else if (platform === 'bilibili') {
    router.push({ name: 'BilibiliHome' });
  } else {
    router.push({ name: 'DouyuHome' });
  }
};

const handleSelectAnchor = (streamer: FollowedStreamer) => {
  if (streamer.platform === Platform.DOUYIN) {
    router.push({ name: 'douyinPlayer', params: { roomId: streamer.id } });
  } else if (streamer.platform === Platform.HUYA) {
    router.push({ name: 'huyaPlayer', params: { roomId: streamer.id } });
  } else if (streamer.platform === Platform.BILIBILI) {
    router.push({ name: 'bilibiliPlayer', params: { roomId: streamer.id } });
  } else {
    router.push({ name: 'douyuPlayer', params: { roomId: streamer.id } });
  }
};

const handleSelectAnchorFromSearch = (payload: { id: string; platform: Platform; nickname?: string; avatarUrl?: string | null }) => {
  handleSelectAnchor({
    id: payload.id,
    platform: payload.platform,
    nickname: payload.nickname ?? payload.id,
    avatarUrl: payload.avatarUrl ?? '',
    currentRoomId: payload.id,
    liveStatus: 'UNKNOWN',
  });
};

const handleFollowStore = (streamer: FollowedStreamer) => {
  followStore.followStreamer(streamer);
};

const handleUnfollowStore = (payload: { platform: Platform; id: string } | string) => {
  if (typeof payload === 'string') {
    followStore.unfollowStreamer(Platform.DOUYU, payload);
  } else {
    followStore.unfollowStreamer(payload.platform, payload.id);
  }
};

const handleReorderListStore = (reorderedList: FollowedStreamer[]) => {
  followStore.updateOrder(reorderedList);
};

const handleFullscreenChange = (isFullscreen: boolean) => {
  isPlayerFullscreen.value = isFullscreen;
};
</script>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background-color: var(--bg-primary);
  transition: none;
}

.app-body {
  flex: 1;
  overflow-y: auto;
  padding: 6px 10px 0 0;
  position: relative;
}

.app-body.app-body--player {
  padding: 0;
}
</style>
