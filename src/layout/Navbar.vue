<template>
  <nav
    :class="['navbar', { 'navbar--dark': effectiveTheme === 'dark' }]"
    data-tauri-drag-region
    :style="{
      height: 'var(--navbar-height)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 32px',
      paddingLeft: '10px',
      paddingRight: shouldShowWindowsControls && !isMacPreview ? '160px' : '16px',
      borderBottom: 'none',
      position: 'sticky',
      top: 0,
      zIndex: 50,
      gap: '32px',
    }"
  >
    <div v-if="isMacPreview" class="mac-controls" aria-hidden="true">
      <span class="mac-dot mac-dot--close"></span>
      <span class="mac-dot mac-dot--min"></span>
      <span class="mac-dot mac-dot--max"></span>
    </div>

    <div class="platform-tabs-wrap" data-tauri-drag-region>
      <div class="platform-tabs" ref="platformTabsRef" data-tauri-drag-region>
        <motion.div
          class="platform-highlight"
          data-tauri-drag-region
          :initial="false"
          :animate="highlightMotion"
          :transition="platformHighlightTransition"
        />
      <button
        v-for="platform in platforms"
        :key="platform.id"
        type="button"
        class="platform-tab"
        :class="{ active: activePlatform === platform.id }"
        data-tauri-drag-region="false"
        :ref="(el) => setPlatformRef(platform.id, el)"
        @click="emit('platform-change', platform.id)"
      >
        <LayoutGrid v-if="platform.id === 'custom'" :size="16" />
        <span v-else>{{ platform.name }}</span>
      </button>
    </div>
    </div>

    <div
      v-if="playerIsland.visible && isPlayerRoute"
      class="navbar-player-island"
      data-tauri-drag-region="false"
    >
      <div class="navbar-player-island__left">
        <img
          v-if="playerIsland.avatarUrl"
          :src="playerIsland.avatarUrl"
          :alt="islandDisplayName"
          class="navbar-player-island__avatar"
        />
        <div v-else class="navbar-player-island__avatar navbar-player-island__avatar--fallback">
          {{ islandDisplayName.slice(0, 1) }}
        </div>
        <div class="navbar-player-island__meta">
          <div class="navbar-player-island__name">{{ islandDisplayName }}</div>
          <div class="navbar-player-island__title">{{ islandDisplayTitle }}</div>
        </div>
      </div>
      <button
        type="button"
        class="navbar-player-island__follow"
        :class="{ 'is-followed': islandIsFollowed }"
        @click="toggleIslandFollow"
      >
        {{ islandIsFollowed ? '取关' : '关注' }}
      </button>
      <button
        type="button"
        class="navbar-player-island__expand"
        @click="requestExpandDanmu"
      >
        <ChevronDown :size="14" />
      </button>
    </div>

    <div class="nav-actions" :class="{ 'nav-actions--windows': shouldShowWindowsControls }" data-tauri-drag-region>
      <div v-if="!shouldCompactSearch" class="search-container" ref="searchContainerRef" data-tauri-drag-region="false">
          <div class="search-shell" :class="{ focused: isSearchFocused }">
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="placeholderText"
              data-tauri-drag-region="false"
              class="search-input"
              ref="searchInputRef"
              @focus="handleFocus"
              @blur="handleBlur"
              @input="handleSearch"
              @keydown.enter.prevent="handleSearchButtonClick"
            />
            <button
              v-if="searchQuery"
              type="button"
              class="search-clear-btn"
              data-tauri-drag-region="false"
              aria-label="清除搜索"
              @click="resetSearchState"
            >
              <X :size="14" />
            </button>
            <button
              type="button"
              class="search-submit-btn"
              data-tauri-drag-region="false"
              aria-label="搜索"
              @click="handleSearchButtonClick"
            >
              <Search :size="15" />
            </button>
          </div>

          <div v-show="showResults" class="search-results-wrapper">
            <div v-if="isLoadingSearch" class="search-loading">搜索中...</div>
            <div v-else-if="searchError" class="search-error-message">{{ searchError }}</div>
            <div v-else-if="searchResults.length > 0" class="search-results-list">
              <div
                v-for="anchor in searchResults"
                :key="anchor.platform + '-' + anchor.roomId"
                class="search-result-item"
                @mousedown="selectAnchor(anchor)"
              >
                <div class="result-avatar">
                  <img v-if="anchor.avatar" :src="anchor.avatar" :alt="anchor.userName" class="avatar-img" />
                  <div v-else class="avatar-placeholder">{{ anchor.userName[0] }}</div>
                </div>

                <div class="result-main-content">
                  <div class="result-line-1-main">
                    <span class="result-name" :title="anchor.userName">{{ anchor.userName }}</span>
                  </div>
                  <div class="result-line-2-main">
                    <span class="result-room-title" :title="anchor.roomTitle || '暂无标题'">{{ anchor.roomTitle || '暂无标题' }}</span>
                  </div>
                </div>
                <span class="live-status-dot" :class="{ 'is-live': anchor.liveStatus }" aria-hidden="true"></span>
              </div>
            </div>

            <div v-else-if="trimmedQuery && !isLoadingSearch && !searchError" class="search-no-results">
              未找到结果
              <button
                v-if="isPureNumeric(trimmedQuery)"
                class="search-fallback-btn"
                @mousedown.prevent="tryEnterRoom(trimmedQuery)"
                @click.prevent="tryEnterRoom(trimmedQuery)"
              >
                进入房间 {{ trimmedQuery }}
              </button>
            </div>
          </div>
      </div>

      <div v-else class="search-compact" ref="searchCompactRef" data-tauri-drag-region="false">
        <button
          type="button"
          class="nav-icon-btn search-toggle-btn"
          data-tauri-drag-region="false"
          aria-label="搜索"
          @click="toggleSearchPopup"
        >
          <Search :size="20" />
        </button>
        <div v-if="showSearchPopup" class="search-popup" data-tauri-drag-region="false">
          <div class="search-container search-container--popup" ref="searchContainerRef" data-tauri-drag-region="false">
            <div class="search-shell" :class="{ focused: isSearchFocused }">
              <input
                v-model="searchQuery"
                type="text"
                :placeholder="placeholderText"
                data-tauri-drag-region="false"
                class="search-input"
                ref="searchInputRef"
                @focus="handleFocus"
                @blur="handleBlur"
                @input="handleSearch"
                @keydown.enter.prevent="handleSearchButtonClick"
              />
              <button
                v-if="searchQuery"
                type="button"
                class="search-clear-btn"
                data-tauri-drag-region="false"
                aria-label="清除搜索"
                @click="resetSearchState"
              >
                <X :size="14" />
              </button>
              <button
                type="button"
                class="search-submit-btn"
                data-tauri-drag-region="false"
                aria-label="搜索"
                @click="handleSearchButtonClick"
              >
                <Search :size="15" />
              </button>
            </div>

            <div v-show="showResults" class="search-results-wrapper">
              <div v-if="isLoadingSearch" class="search-loading">搜索中...</div>
              <div v-else-if="searchError" class="search-error-message">{{ searchError }}</div>
              <div v-else-if="searchResults.length > 0" class="search-results-list">
                <div
                  v-for="anchor in searchResults"
                  :key="anchor.platform + '-' + anchor.roomId"
                  class="search-result-item"
                  @mousedown="selectAnchor(anchor)"
                >
                  <div class="result-avatar">
                    <img v-if="anchor.avatar" :src="anchor.avatar" :alt="anchor.userName" class="avatar-img" />
                    <div v-else class="avatar-placeholder">{{ anchor.userName[0] }}</div>
                  </div>

                  <div class="result-main-content">
                    <div class="result-line-1-main">
                      <span class="result-name" :title="anchor.userName">{{ anchor.userName }}</span>
                    </div>
                    <div class="result-line-2-main">
                      <span class="result-room-title" :title="anchor.roomTitle || '暂无标题'">{{ anchor.roomTitle || '暂无标题' }}</span>
                    </div>
                  </div>
                  <span class="live-status-dot" :class="{ 'is-live': anchor.liveStatus }" aria-hidden="true"></span>
                </div>
              </div>

              <div v-else-if="trimmedQuery && !isLoadingSearch && !searchError" class="search-no-results">
                未找到结果
                <button
                  v-if="isPureNumeric(trimmedQuery)"
                  class="search-fallback-btn"
                  @mousedown.prevent="tryEnterRoom(trimmedQuery)"
                  @click.prevent="tryEnterRoom(trimmedQuery)"
                >
                  进入房间 {{ trimmedQuery }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <button type="button" class="nav-icon-btn github-btn" data-tauri-drag-region="false" @click="openGithub">
        <Github :size="20" />
        <span class="github-badge">{{ appVersion || '-' }}</span>
      </button>
      <button
        type="button"
        class="nav-icon-btn"
        data-tauri-drag-region="false"
        @click="toggleTheme"
      >
        <Sun v-if="effectiveTheme === 'dark'" :size="20" />
        <Moon v-else :size="20" />
      </button>

      <div v-if="shouldShowWindowsControls && !isMacPreview" class="win-controls-wrap">
        <WindowsWindowControls />
      </div>
  </div>
  </nav>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { platform as detectPlatform } from '@tauri-apps/plugin-os';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getVersion } from '@tauri-apps/api/app';
import { useRoute } from 'vue-router';
import { ChevronDown, Github, LayoutGrid, Moon, Search, Sun, X } from 'lucide-vue-next';
import { motion } from 'motion-v';
import WindowsWindowControls from '../components/window-controls/WindowsWindowControls.vue';
import { useThemeStore } from '../stores/theme';
import { Platform } from '../platforms/common/types';
import type { Platform as UiPlatform } from './types';
import { useFollowStore } from '../store/followStore';
import { useCustomCategoryStore } from '../store/customCategoryStore';

interface DouyinApiStreamInfo {
  title?: string | null;
  anchor_name?: string | null;
  avatar?: string | null;
  status?: number | null;
  error_message?: string | null;
  web_rid?: string | null;
}

interface HuyaAnchorItem {
  room_id: string;
  avatar: string;
  user_name: string;
  live_status: boolean;
  title: string;
}

type BilibiliSearchItem = {
  room_id: string;
  title: string;
  cover: string;
  anchor: string;
  avatar: string;
  watching: string;
  area: string;
  is_live: boolean;
};

interface SearchResultItem {
  platform: Platform;
  roomId: string;
  webId?: string | null;
  userName: string;
  roomTitle?: string | null;
  avatar: string | null;
  liveStatus: boolean;
  fansCount?: string;
  category?: string;
  rawStatus?: number | null;
}

const props = defineProps<{
  theme: 'light' | 'dark';
  searchQuery?: string;
  activePlatform: UiPlatform | 'all';
}>();

const emit = defineEmits<{
  (event: 'theme-toggle'): void;
  (event: 'search-change', value: string): void;
  (event: 'platform-change', value: UiPlatform | 'all'): void;
  (event: 'select-anchor', payload: { id: string; platform: Platform; nickname: string; avatarUrl: string | null; currentRoomId?: string }): void;
}>();

const basePlatforms: { id: UiPlatform | 'all'; name: string }[] = [
  { id: 'douyu', name: '斗鱼' },
  { id: 'huya', name: '虎牙' },
  { id: 'douyin', name: '抖音' },
  { id: 'bilibili', name: 'Bilibili' },
];

const activePlatform = computed(() => props.activePlatform);
const searchQuery = ref(props.searchQuery ?? '');
const trimmedQuery = computed(() => searchQuery.value.trim());
const searchResults = ref<SearchResultItem[]>([]);
const showResults = ref(false);
const searchError = ref<string | null>(null);
const isLoadingSearch = ref(false);
const hasCompletedSearch = ref(false);
const isSearchFocused = ref(false);
const searchContainerRef = ref<HTMLElement | null>(null);
const searchCompactRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const platformTabsRef = ref<HTMLElement | null>(null);
const platformItemRefs = new Map<UiPlatform | 'all', HTMLElement>();
const highlight = ref({ left: 0, width: 0, opacity: 0 });
const highlightMotion = computed(() => ({
  x: highlight.value.left,
  width: highlight.value.width,
  opacity: highlight.value.opacity,
  scale: highlight.value.opacity ? 1 : 0.96,
}));
const platformHighlightTransition = {
  type: 'spring' as const,
  stiffness: 430,
  damping: 24,
  mass: 0.72,
};

const themeStore = useThemeStore();
const customCategoryStore = useCustomCategoryStore();
customCategoryStore.ensureLoaded();
const platforms = computed(() => {
  const list = [...basePlatforms];
  if (customCategoryStore.hasEntries) {
    list.unshift({ id: 'custom', name: '自定义' });
  }
  return list;
});
const effectiveTheme = computed(() => themeStore.getEffectiveTheme());
const route = useRoute();

const detectedPlatform = ref<string | null>(null);
const isMacPreview = false;
const isWindowsPreview = false;
const appVersion = ref('');
const isWindowsPlatform = computed(() => {
  if (isWindowsPreview) return true;
  const name = detectedPlatform.value?.toLowerCase() ?? '';
  return name.startsWith('win');
});
const shouldShowWindowsControls = computed(() => isWindowsPlatform.value);
const isPlayerRoute = computed(() => {
  const name = route.name as string | undefined;
  return name === 'douyuPlayer' || name === 'douyinPlayer' || name === 'huyaPlayer' || name === 'bilibiliPlayer';
});
const PLAYER_ISLAND_EVENT = 'dtv-player-island-state';
const PLAYER_ISLAND_EXPAND_EVENT = 'dtv-player-island-expand';
const playerIsland = ref({
  visible: false,
  anchorName: '',
  title: '',
  avatarUrl: null as string | null,
  roomId: null as string | null,
  platform: null as Platform | null,
});
const followStore = useFollowStore();
const islandIsFollowed = computed(() => {
  if (!playerIsland.value.platform || !playerIsland.value.roomId) {
    return false;
  }
  return followStore.isFollowed(playerIsland.value.platform, playerIsland.value.roomId);
});
const islandDisplayName = computed(() => {
  if (playerIsland.value.anchorName) {
    return playerIsland.value.anchorName;
  }
  if (playerIsland.value.roomId) {
    return `主播${playerIsland.value.roomId}`;
  }
  return '主播';
});
const islandDisplayTitle = computed(() => {
  if (playerIsland.value.title) {
    return playerIsland.value.title;
  }
  if (playerIsland.value.roomId) {
    return `房间 ${playerIsland.value.roomId}`;
  }
  return '直播间';
});

const shouldCompactSearch = computed(() => playerIsland.value.visible);
const showSearchPopup = ref(false);

const openSearchPopup = async () => {
  showSearchPopup.value = true;
  await nextTick();
  searchInputRef.value?.focus();
  handleFocus();
};

const closeSearchPopup = () => {
  showSearchPopup.value = false;
  showResults.value = false;
  isSearchFocused.value = false;
};

const toggleSearchPopup = () => {
  if (showSearchPopup.value) {
    closeSearchPopup();
  } else {
    openSearchPopup();
  }
};
const resolveIslandFallback = (platform?: Platform | null, roomId?: string | null) => {
  if (!platform || !roomId) {
    return null;
  }
  return followStore.getFollowedStreamers.find((item) => {
    if (item.platform !== platform) {
      return false;
    }
    return item.id === roomId || item.currentRoomId === roomId;
  }) ?? null;
};

const proxyBase = ref<string | null>(null);
const ensureProxyStarted = async () => {
  if (!proxyBase.value) {
    try {
      const base = await invoke<string>('start_static_proxy_server');
      proxyBase.value = base;
    } catch (e) {
      console.error('[Navbar] Failed to start static proxy server', e);
    }
  }
};
const proxify = (url?: string | null): string | null => {
  if (!url) return null;
  if (proxyBase.value) {
    return `${proxyBase.value}/image?url=${encodeURIComponent(url)}`;
  }
  return url;
};

const currentPlatform = computed<Platform>(() => {
  const name = route.name as string | undefined;
  const path = route.path;

  if (name) {
    if (name === 'douyinPlayer' || name === 'DouyinHome') return Platform.DOUYIN;
    if (name === 'huyaPlayer' || name === 'HuyaHome') return Platform.HUYA;
    if (name === 'bilibiliPlayer' || name === 'BilibiliHome') return Platform.BILIBILI;
    if (name === 'douyuPlayer' || name === 'DouyuHome') return Platform.DOUYU;
  }

  if (path.startsWith('/player/douyin') || path.startsWith('/douyin')) return Platform.DOUYIN;
  if (path.startsWith('/player/huya') || path.startsWith('/huya')) return Platform.HUYA;
  if (path.startsWith('/player/bilibili') || path.startsWith('/bilibili')) return Platform.BILIBILI;
  if (path.startsWith('/player/douyu') || path.startsWith('/')) return Platform.DOUYU;

  return Platform.DOUYU;
});

const placeholderText = computed(() => {
  if (currentPlatform.value === Platform.DOUYU) return '搜索斗鱼主播名称/房间号';
  if (currentPlatform.value === Platform.HUYA) return '搜索虎牙主播名称/房间号';
  if (currentPlatform.value === Platform.DOUYIN) return '搜索抖音房间号';
  if (currentPlatform.value === Platform.BILIBILI) return '搜索B站主播名称/房间号';
  return '搜索主播/房间';
});

onMounted(async () => {
  try {
    detectedPlatform.value = await detectPlatform();
  } catch (error) {
    console.error('[Navbar] Failed to detect platform', error);
    if (typeof navigator !== 'undefined') {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes('windows')) {
        detectedPlatform.value = 'windows';
      } else if (ua.includes('mac')) {
        detectedPlatform.value = 'darwin';
      }
    }
  }
});

watch(
  detectedPlatform,
  (platformName) => {
    if (typeof document === 'undefined') return;
    const normalized = platformName?.toLowerCase() ?? '';
    const isMac = isMacPreview || normalized.startsWith('darwin') || normalized.startsWith('mac');
    if (isMac) {
      document.documentElement.setAttribute('data-platform', 'darwin');
    } else {
      document.documentElement.removeAttribute('data-platform');
    }
  },
  { immediate: true },
);

onMounted(async () => {
  try {
    appVersion.value = await getVersion();
  } catch (error) {
    console.error('[Navbar] Failed to read app version', error);
  }
});

const handleDocumentPointerDown = (event: PointerEvent) => {
  if (!showSearchPopup.value) return;
  const target = event.target as HTMLElement | null;
  if (!target) return;
  const withinSearch = searchContainerRef.value?.contains(target);
  const withinToggle = searchCompactRef.value?.contains(target);
  if (!withinSearch && !withinToggle) {
    closeSearchPopup();
  }
};

const setPlatformRef = (key: UiPlatform | 'all', el: Element | ComponentPublicInstance | null) => {
  if (!el) {
    platformItemRefs.delete(key);
    return;
  }
  const element = (el as ComponentPublicInstance).$el ?? el;
  if (element instanceof HTMLElement) {
    platformItemRefs.set(key, element);
  }
};

const updateHighlight = async () => {
  await nextTick();
  const container = platformTabsRef.value;
  const active = platformItemRefs.get(props.activePlatform);
  if (!container || !active) {
    highlight.value.opacity = 0;
    return;
  }
  const rect = active.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  highlight.value = {
    left: rect.left - containerRect.left,
    width: rect.width,
    opacity: 1,
  };
};

watch(() => props.activePlatform, () => {
  updateHighlight();
}, { immediate: true });

watch(platforms, () => {
  updateHighlight();
});

watch(shouldCompactSearch, (value) => {
  if (!value) {
    closeSearchPopup();
  }
});

onMounted(() => {
  window.addEventListener('resize', updateHighlight);
  window.addEventListener('pointerdown', handleDocumentPointerDown);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateHighlight);
  window.removeEventListener('pointerdown', handleDocumentPointerDown);
});

const handleDocumentMouseDown = (event: MouseEvent) => {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (searchContainerRef.value && !searchContainerRef.value.contains(target)) {
    showResults.value = false;
    isSearchFocused.value = false;
  }
};

onMounted(() => {
  document.addEventListener('mousedown', handleDocumentMouseDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleDocumentMouseDown);
});

const handlePlayerIslandEvent = (event: Event) => {
  const customEvent = event as CustomEvent<{ visible?: boolean; anchorName?: string; title?: string; avatarUrl?: string | null; roomId?: string | null; platform?: Platform | null }>;
  const detail = customEvent.detail;
  if (!detail) {
    return;
  }
  playerIsland.value = {
    visible: !!detail.visible,
    roomId: detail.roomId ?? null,
    platform: detail.platform ?? null,
    anchorName: detail.anchorName ?? resolveIslandFallback(detail.platform, detail.roomId)?.nickname ?? '',
    title: detail.title ?? resolveIslandFallback(detail.platform, detail.roomId)?.roomTitle ?? '',
    avatarUrl: detail.avatarUrl ?? resolveIslandFallback(detail.platform, detail.roomId)?.avatarUrl ?? null,
  };
};

const requestExpandDanmu = () => {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(PLAYER_ISLAND_EXPAND_EVENT));
};

const toggleIslandFollow = () => {
  const platform = playerIsland.value.platform;
  const roomId = playerIsland.value.roomId;
  if (!platform || !roomId) {
    return;
  }
  if (followStore.isFollowed(platform, roomId)) {
    followStore.unfollowStreamer(platform, roomId);
    return;
  }
  followStore.followStreamer({
    platform,
    id: roomId,
    nickname: playerIsland.value.anchorName || roomId,
    avatarUrl: playerIsland.value.avatarUrl || '',
    roomTitle: playerIsland.value.title || '',
    currentRoomId: roomId,
    liveStatus: 'UNKNOWN',
  });
};

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener(PLAYER_ISLAND_EVENT, handlePlayerIslandEvent as EventListener);
  }
});

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener(PLAYER_ISLAND_EVENT, handlePlayerIslandEvent as EventListener);
  }
});

const toggleTheme = () => {
  emit('theme-toggle');
};

const openGithub = async () => {
  try {
    await openUrl('https://github.com/chen-zeong/DTV/releases');
  } catch (error) {
    if (typeof window !== 'undefined') {
      window.open('https://github.com/chen-zeong/DTV/releases', '_blank', 'noopener,noreferrer');
      return;
    }
    console.error('[Navbar] Failed to open GitHub', error);
  }
};

let searchTimeout: number | null = null;

const isPureNumeric = (value: string): boolean => /^\d+$/.test(value);

const resetSearchState = () => {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
    searchTimeout = null;
  }
  searchQuery.value = '';
  searchResults.value = [];
  searchError.value = null;
  showResults.value = false;
  isLoadingSearch.value = false;
  hasCompletedSearch.value = false;
};

const handleSearch = () => {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }
  searchError.value = null;
  isLoadingSearch.value = true;
  hasCompletedSearch.value = false;
  showResults.value = false;
  emit('search-change', searchQuery.value);

  searchTimeout = window.setTimeout(() => {
    performSearchBasedOnInput();
  }, 500);
};

const handleSearchButtonClick = async () => {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
    searchTimeout = null;
  }
  searchError.value = null;
  emit('search-change', searchQuery.value);
  if (!trimmedQuery.value) {
    searchResults.value = [];
    showResults.value = false;
    isLoadingSearch.value = false;
    hasCompletedSearch.value = false;
    return;
  }
  isLoadingSearch.value = true;
  hasCompletedSearch.value = false;
  showResults.value = false;
  await performSearchBasedOnInput();
};

const performSearchBasedOnInput = async () => {
  const query = trimmedQuery.value;
  if (!query) {
    searchResults.value = [];
    showResults.value = false;
    isLoadingSearch.value = false;
    hasCompletedSearch.value = false;
    return;
  }
  searchQuery.value = query;

  if (currentPlatform.value === Platform.DOUYIN) {
    await performDouyinIdSearch(query);
  } else if (currentPlatform.value === Platform.HUYA) {
    await performHuyaSearch(query);
  } else if (currentPlatform.value === Platform.BILIBILI) {
    await performBilibiliSearch(query);
  } else {
    await performDouyuSearch(query);
  }
  isLoadingSearch.value = false;
};

const performDouyinIdSearch = async (userInputRoomId: string) => {
  searchResults.value = [];
  searchError.value = null;
  isLoadingSearch.value = true;
  try {
    const payloadData = { args: { room_id_str: userInputRoomId } };
    const douyinInfo = await invoke<DouyinApiStreamInfo>('fetch_douyin_streamer_info', {
      payload: payloadData,
    });
    isLoadingSearch.value = false;
    if (douyinInfo?.anchor_name) {
      const isLive = douyinInfo.status === 2;
      const webId = (douyinInfo as any).web_rid ?? userInputRoomId;
      searchResults.value = [{
        platform: Platform.DOUYIN,
        roomId: webId,
        webId,
        userName: douyinInfo.anchor_name || '抖音主播',
        roomTitle: douyinInfo.title || null,
        avatar: douyinInfo.avatar || null,
        liveStatus: isLive,
        rawStatus: douyinInfo.status,
      }];
    } else {
      searchError.value = '搜索失败，请重试。';
    }
  } catch (e) {
    isLoadingSearch.value = false;
    searchError.value = '搜索失败，请重试。';
  }
  hasCompletedSearch.value = true;
  showResults.value = true;
};

const performHuyaSearch = async (keyword: string) => {
  searchResults.value = [];
  searchError.value = null;
  isLoadingSearch.value = true;
  try {
    const items = await invoke<HuyaAnchorItem[]>('search_huya_anchors', { keyword, page: 1 });
    await ensureProxyStarted();
    isLoadingSearch.value = false;
    if (Array.isArray(items) && items.length > 0) {
      searchResults.value = items.map((item): SearchResultItem => ({
        platform: Platform.HUYA,
        roomId: item.room_id,
        userName: item.user_name || '虎牙主播',
        roomTitle: item.title || null,
        avatar: proxify(item.avatar || null),
        liveStatus: !!item.live_status,
      }));
      searchError.value = null;
    }
  } catch (e) {
    isLoadingSearch.value = false;
    searchError.value = '搜索失败，请重试。';
  }
  hasCompletedSearch.value = true;
  showResults.value = true;
};

const performDouyuSearch = async (keyword: string) => {
  searchResults.value = [];
  searchError.value = null;
  isLoadingSearch.value = true;
  try {
    const response = await invoke<string>('search_anchor', { keyword });
    isLoadingSearch.value = false;
    const data = JSON.parse(response);
    if (data.error === 0 && data.data && data.data.relateUser) {
      searchResults.value = data.data.relateUser
        .filter((item: any) => item.type === 1)
        .map((item: any): SearchResultItem => {
          const anchorInfo = item.anchorInfo;
          const isReallyLive = anchorInfo.isLive === 1 && anchorInfo.videoLoop !== 1;
          return {
            platform: Platform.DOUYU,
            roomId: anchorInfo.rid.toString(),
            userName: anchorInfo.nickName,
            roomTitle: anchorInfo.roomName || anchorInfo.description || null,
            avatar: anchorInfo.avatar,
            liveStatus: isReallyLive,
            fansCount: anchorInfo.fansNumStr,
            category: anchorInfo.cateName,
          };
        });
      searchError.value = null;
    } else {
      searchError.value = '搜索失败，请重试。';
    }
  } catch (e) {
    isLoadingSearch.value = false;
    searchError.value = '搜索失败，请重试。';
  }
  hasCompletedSearch.value = true;
  showResults.value = true;
};

const performBilibiliSearch = async (keyword: string) => {
  searchResults.value = [];
  searchError.value = null;
  isLoadingSearch.value = true;
  try {
    const response = await invoke<BilibiliSearchItem[]>('search_bilibili_rooms', {
      keyword,
      page: 1,
    });
    await ensureProxyStarted();
    if (Array.isArray(response) && response.length > 0) {
      searchResults.value = response.map((item) => ({
        platform: Platform.BILIBILI,
        roomId: item.room_id,
        webId: item.room_id,
        userName: item.anchor || 'B站主播',
        roomTitle: item.title || null,
        avatar: proxify(item.avatar),
        liveStatus: item.is_live,
        fansCount: item.watching,
        category: item.area,
      }));
    }
  } catch (e) {
    searchError.value = '搜索失败，请重试。';
  } finally {
    isLoadingSearch.value = false;
    hasCompletedSearch.value = true;
    showResults.value = true;
  }
};

const handleFocus = () => {
  isSearchFocused.value = true;
  showResults.value = hasCompletedSearch.value && !isLoadingSearch.value && !!trimmedQuery.value;
};

const handleBlur = () => {
  isSearchFocused.value = false;
  setTimeout(() => {
    if (!isLoadingSearch.value && !searchError.value) {
      showResults.value = false;
    }
  }, 300);
};

const selectAnchor = (anchor: SearchResultItem) => {
  emit('select-anchor', {
    id: anchor.webId || anchor.roomId,
    platform: anchor.platform,
    nickname: anchor.userName,
    avatarUrl: anchor.avatar,
    currentRoomId: undefined,
  });
  resetSearchState();
};

const tryEnterRoom = (roomId: string) => {
  if (!roomId) return;
  emit('select-anchor', {
    id: roomId,
    platform: currentPlatform.value,
    nickname: roomId,
    avatarUrl: null,
    currentRoomId: undefined,
  });
  resetSearchState();
};
</script>
<style scoped>
.navbar {
  background: var(--bg-primary);
}

.navbar.navbar--dark {
  background: transparent;
  border-bottom: none !important;
}

.navbar.navbar--dark .platform-tabs,
.navbar.navbar--dark .search-shell,
.navbar.navbar--dark .nav-icon-btn {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  border-style: solid !important;
  border-width: 0.6px 0.24px !important;
  border-color: rgba(233, 241, 246, 0.42) !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    inset 0 -1px 0 rgba(0, 0, 0, 0.28),
    0 4px 10px rgba(0, 0, 0, 0.12) !important;
}

.navbar.navbar--dark .platform-highlight {
  background: rgba(145, 154, 160, 0.28) !important;
  background-image: none !important;
  border-style: solid !important;
  border-width: 0.55px 0.24px !important;
  border-color: rgba(237, 244, 248, 0.34) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    0 1px 4px rgba(0, 0, 0, 0.1) !important;
}

.navbar.navbar--dark .search-shell.focused {
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    inset 0 -1px 0 rgba(0, 0, 0, 0.3),
    0 6px 14px rgba(0, 0, 0, 0.14) !important;
}

.navbar.navbar--dark .platform-tab:hover:not(.active),
.navbar.navbar--dark .search-clear-btn:hover,
.navbar.navbar--dark .nav-icon-btn:hover,
.navbar.navbar--dark .nav-icon-btn:active {
  background-color: transparent !important;
  background-image: none !important;
}

.navbar.navbar--dark .nav-icon-btn:hover {
  border-color: rgba(240, 246, 250, 0.52) !important;
}

.platform-tabs-wrap {
  flex: 0 0 auto;
}

.navbar-player-island {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: min(320px, calc(100% - 640px));
  min-height: 42px;
  padding: 6px 10px 6px 8px;
  border-radius: 999px;
  background: rgba(16, 16, 18, 0.94);
  border: 1px solid rgba(0, 0, 0, 0.22);
  box-shadow: none;
}

.navbar-player-island__left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
}

.navbar-player-island__avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.24);
  object-fit: cover;
  flex: 0 0 auto;
}

.navbar-player-island__avatar--fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #f8fafc;
  background: rgba(148, 163, 184, 0.2);
  font-size: 12px;
  font-weight: 700;
}

.navbar-player-island__meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}


.navbar-player-island__name {
  color: rgba(248, 250, 252, 0.98);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: clip;
}

.navbar-player-island__title {
  color: rgba(203, 213, 225, 0.9);
  font-size: 11px;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: clip;
}

.navbar-player-island__expand {
  border: none;
  border-radius: 999px;
  width: 28px;
  height: 28px;
  padding: 0;
  color: rgba(248, 250, 252, 0.96);
  background: rgba(148, 163, 184, 0.22);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 0.2s ease;
  flex: 0 0 auto;
}

.navbar-player-island__expand:hover {
  background: rgba(148, 163, 184, 0.3);
}

.navbar-player-island__follow {
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  padding: 5px 11px;
  font-size: 11px;
  font-weight: 700;
  color: rgba(248, 250, 252, 0.96);
  background: linear-gradient(180deg, rgba(120, 133, 147, 0.32), rgba(92, 104, 118, 0.26));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.28),
    inset 0 -1px 0 rgba(0, 0, 0, 0.2);
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
  flex: 0 0 auto;
}

.navbar-player-island__follow:hover {
  background: linear-gradient(180deg, rgba(134, 147, 161, 0.38), rgba(104, 117, 132, 0.3));
  transform: translateY(-1px);
}

.navbar-player-island__follow.is-followed {
  border-color: rgba(110, 231, 183, 0.28);
  background: linear-gradient(180deg, rgba(45, 212, 191, 0.34), rgba(16, 185, 129, 0.28));
  color: rgba(236, 253, 245, 0.98);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.24),
    inset 0 -1px 0 rgba(0, 0, 0, 0.16);
}

:global([data-theme='light']) .navbar-player-island,
:global(html[data-theme='light']) .navbar-player-island,
:global(:root[data-theme='light']) .navbar-player-island {
  background: rgba(248, 250, 252, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.9);
}

:global([data-theme='light']) .navbar-player-island__avatar,
:global(html[data-theme='light']) .navbar-player-island__avatar,
:global(:root[data-theme='light']) .navbar-player-island__avatar {
  border-color: rgba(148, 163, 184, 0.38);
}

:global([data-theme='light']) .navbar-player-island__avatar--fallback,
:global(html[data-theme='light']) .navbar-player-island__avatar--fallback,
:global(:root[data-theme='light']) .navbar-player-island__avatar--fallback {
  color: #0f172a;
  background: rgba(148, 163, 184, 0.24);
}

:global([data-theme='light']) .navbar-player-island__name,
:global(html[data-theme='light']) .navbar-player-island__name,
:global(:root[data-theme='light']) .navbar-player-island__name {
  color: #111827;
}

:global([data-theme='light']) .navbar-player-island__title,
:global(html[data-theme='light']) .navbar-player-island__title,
:global(:root[data-theme='light']) .navbar-player-island__title {
  color: #475569;
}


:global([data-theme='light']) .navbar-player-island__expand,
:global(html[data-theme='light']) .navbar-player-island__expand,
:global(:root[data-theme='light']) .navbar-player-island__expand,
:global([data-theme='light']) .navbar-player-island__follow,
:global(html[data-theme='light']) .navbar-player-island__follow,
:global(:root[data-theme='light']) .navbar-player-island__follow {
  color: #0f172a;
  border-color: rgba(148, 163, 184, 0.35);
  background: linear-gradient(180deg, rgba(241, 245, 249, 0.98), rgba(226, 232, 240, 0.92));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    inset 0 -1px 0 rgba(148, 163, 184, 0.24);
}

:global([data-theme='light']) .navbar-player-island__follow.is-followed,
:global(html[data-theme='light']) .navbar-player-island__follow.is-followed,
:global(:root[data-theme='light']) .navbar-player-island__follow.is-followed {
  border-color: rgba(16, 185, 129, 0.35);
  background: linear-gradient(180deg, rgba(209, 250, 229, 0.98), rgba(167, 243, 208, 0.9));
  color: #065f46;
}

:global([data-theme='dark']) .navbar-player-island,
:global(html[data-theme='dark']) .navbar-player-island,
:global(:root[data-theme='dark']) .navbar-player-island {
  background: rgba(248, 250, 252, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: none;
}

:global([data-theme='dark']) .navbar-player-island__avatar,
:global(html[data-theme='dark']) .navbar-player-island__avatar,
:global(:root[data-theme='dark']) .navbar-player-island__avatar {
  border-color: rgba(148, 163, 184, 0.38);
}

:global([data-theme='dark']) .navbar-player-island__avatar--fallback,
:global(html[data-theme='dark']) .navbar-player-island__avatar--fallback,
:global(:root[data-theme='dark']) .navbar-player-island__avatar--fallback {
  color: #0f172a;
  background: rgba(148, 163, 184, 0.24);
}

:global([data-theme='dark']) .navbar-player-island__name,
:global(html[data-theme='dark']) .navbar-player-island__name,
:global(:root[data-theme='dark']) .navbar-player-island__name {
  color: #111827;
}

:global([data-theme='dark']) .live-wave,
:global(html[data-theme='dark']) .live-wave,
:global(:root[data-theme='dark']) .live-wave {
  background: rgba(15, 23, 42, 0.9);
}

:global([data-theme='dark']) .navbar-player-island__title,
:global(html[data-theme='dark']) .navbar-player-island__title,
:global(:root[data-theme='dark']) .navbar-player-island__title {
  color: #475569;
}

:global([data-theme='dark']) .navbar-player-island__expand,
:global(html[data-theme='dark']) .navbar-player-island__expand,
:global(:root[data-theme='dark']) .navbar-player-island__expand {
  color: #0f172a;
  background: rgba(148, 163, 184, 0.24);
}

:global([data-theme='dark']) .navbar-player-island__expand:hover,
:global(html[data-theme='dark']) .navbar-player-island__expand:hover,
:global(:root[data-theme='dark']) .navbar-player-island__expand:hover {
  background: rgba(148, 163, 184, 0.34);
}

:global([data-theme='dark']) .navbar-player-island__follow,
:global(html[data-theme='dark']) .navbar-player-island__follow,
:global(:root[data-theme='dark']) .navbar-player-island__follow {
  color: #0f172a;
  background: rgba(148, 163, 184, 0.24);
}

:global([data-theme='dark']) .navbar-player-island__follow:hover,
:global(html[data-theme='dark']) .navbar-player-island__follow:hover,
:global(:root[data-theme='dark']) .navbar-player-island__follow:hover {
  background: rgba(148, 163, 184, 0.34);
}

.mac-controls {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding-left: 2px;
}

.mac-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}

.mac-dot--close {
  background: #ff5f57;
}

.mac-dot--min {
  background: #febc2e;
}

.mac-dot--max {
  background: #28c840;
}

.platform-tabs {
  display: flex;
  background: rgba(250, 252, 255, 0.62);
  border-style: solid;
  border-color: #ffffff;
  border-width: 0.8px 0.35px;
  padding: 5px;
  border-radius: 22px;
  position: relative;
  overflow: hidden;
  box-shadow:
    0 1px 3px rgba(15, 23, 42, 0.04),
    0 4px 8px rgba(15, 23, 42, 0.05);
  backdrop-filter: blur(18px) saturate(1.05);
  -webkit-backdrop-filter: blur(18px) saturate(1.05);
}

:global([data-theme='light']) .platform-tabs,
:global(html[data-theme='light']) .platform-tabs,
:global(:root[data-theme='light']) .platform-tabs {
  border-width: 1px 0.6px !important;
  border-color: #ffffff !important;
  outline: 0.5px solid rgba(148, 163, 184, 0.35) !important;
  outline-offset: -1px;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.92),
    0 1px 3px rgba(15, 23, 42, 0.04),
    0 4px 8px rgba(15, 23, 42, 0.05) !important;
}

:global([data-theme='dark']) .platform-tabs {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  border-color: rgba(255, 255, 255, 0.42);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  box-shadow: none !important;
}

.platform-tab {
  padding: 9px 20px;
  border-radius: 16px;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
  position: relative;
  z-index: 2;
  transition: color 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s ease, background-color 0.2s ease;
}

.platform-tab:hover:not(.active) {
  background-color: rgba(15, 23, 42, 0.06);
}

.platform-tab.active {
  font-weight: 700;
  color: var(--text-primary);
}

:global([data-theme='dark']) .platform-tab {
  color: #cbd5e1;
}

:global([data-theme='dark']) .platform-tab:hover:not(.active) {
  background-color: transparent !important;
  background-image: none !important;
}

:global([data-theme='dark']) .platform-tab.active {
  color: #f8fafc;
}

.platform-highlight {
  position: absolute;
  top: 5px;
  bottom: 5px;
  left: 0;
  background: rgba(255, 255, 255, 0.9);
  border-style: solid;
  border-color: #ffffff;
  border-width: 0.75px 0.35px;
  border-radius: 16px;
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.04),
    0 3px 6px rgba(15, 23, 42, 0.05);
  transition:
    transform 240ms cubic-bezier(0.16, 1, 0.3, 1),
    width 240ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 160ms ease;
  z-index: 1;
}

:global([data-theme='light']) .platform-highlight,
:global(html[data-theme='light']) .platform-highlight,
:global(:root[data-theme='light']) .platform-highlight {
  border-width: 1px 0.6px !important;
  border-color: #ffffff !important;
  outline: 0.5px solid rgba(148, 163, 184, 0.3) !important;
  outline-offset: -1px;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.9),
    0 1px 2px rgba(15, 23, 42, 0.04),
    0 3px 6px rgba(15, 23, 42, 0.05) !important;
}

:global([data-theme='dark']) .platform-highlight {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  border-color: rgba(255, 255, 255, 0.22);
  box-shadow: none !important;
}

.search-container {
  position: relative;
  width: min(240px, 24vw);
}

.search-compact {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.search-popup {
  position: absolute;
  right: 0;
  top: 54px;
  z-index: 40;
  padding-top: 4px;
}

.search-container--popup {
  width: min(280px, 60vw);
}

.search-shell {
  width: 100%;
  max-width: 420px;
  position: relative;
  display: flex;
  align-items: center;
  z-index: 10;
  transform: scale(1);
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  background: rgba(250, 252, 255, 0.62);
  border-style: solid;
  border-color: #ffffff;
  border-width: 0.8px 0.35px;
  border-radius: 22px;
  box-shadow:
    0 1px 3px rgba(15, 23, 42, 0.04),
    0 4px 8px rgba(15, 23, 42, 0.05);
  backdrop-filter: blur(18px) saturate(1.05);
  -webkit-backdrop-filter: blur(18px) saturate(1.05);
}

:global([data-theme='light']) .search-shell,
:global(html[data-theme='light']) .search-shell,
:global(:root[data-theme='light']) .search-shell {
  border-width: 1px 0.6px !important;
  border-color: #ffffff !important;
  outline: 0.5px solid rgba(148, 163, 184, 0.35) !important;
  outline-offset: -1px;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.92),
    0 1px 3px rgba(15, 23, 42, 0.04),
    0 4px 8px rgba(15, 23, 42, 0.05) !important;
}

:global([data-theme='dark']) .search-shell {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  border-color: rgba(255, 255, 255, 0.42);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  box-shadow: none !important;
}

.search-shell.focused {
  transform: scale(1.01);
  box-shadow:
    0 1px 4px rgba(15, 23, 42, 0.06),
    0 5px 10px rgba(15, 23, 42, 0.08);
}

:global([data-theme='dark']) .search-shell.focused {
  box-shadow: none !important;
}

.search-input {
  flex: 1;
  width: auto;
  min-width: 0;
  padding: 12px 10px 12px 16px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 22px;
  font-size: 0.9rem;
  color: var(--text-primary);
  outline: none;
  appearance: none;
  -webkit-appearance: none;
}

:global([data-theme='dark']) .search-input {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
}

.search-clear-btn {
  background: transparent;
  border: none;
  width: 32px;
  height: 32px;
  margin-right: 6px;
  border-radius: 50%;
  cursor: pointer;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.search-clear-btn:hover {
  color: var(--accent);
  background: rgba(0, 0, 0, 0.06);
}

:global([data-theme='dark']) .search-clear-btn:hover {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
}

.search-submit-btn {
  background: transparent;
  border: none;
  width: 32px;
  height: 32px;
  margin-right: 8px;
  border-radius: 50%;
  cursor: pointer;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.search-submit-btn:hover {
  color: var(--accent);
  background: rgba(0, 0, 0, 0.06);
}

:global([data-theme='dark']) .search-submit-btn:hover {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
}

.search-results-wrapper {
  position: absolute;
  top: calc(100% + 10px);
  left: 0;
  right: 0;
  transform: none;
  width: 100%;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-radius: var(--radius-md);
  box-shadow: var(--glass-shadow);
  max-height: 480px;
  overflow-y: auto;
  z-index: 1001;
  border: 1px solid var(--glass-border);
  padding: 8px;
}

:global([data-theme='dark']) .search-results-wrapper,
:global(html[data-theme='dark']) .search-results-wrapper,
:global(:root[data-theme='dark']) .search-results-wrapper {
  background: rgba(18, 18, 20, 0.96) !important;
  border-color: rgba(255, 255, 255, 0.08);
}

.search-result-item {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s ease;
  gap: 8px;
  overflow: hidden;
}

.search-result-item:hover {
  background: var(--hover-bg);
  transform: translateX(4px);
}

:global([data-theme='dark']) .search-result-item:hover,
:global(html[data-theme='dark']) .search-result-item:hover,
:global(:root[data-theme='dark']) .search-result-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.result-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--tertiary-bg);
  border: 2px solid var(--border-color);
  flex-shrink: 0;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.result-main-content {
  flex: 1;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.result-line-1-main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.result-name {
  font-weight: 600;
  font-size: 12px;
  color: var(--primary-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.live-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #9ca3af;
  margin-left: auto;
  flex: 0 0 auto;
}

.live-status-dot.is-live {
  background: #22c55e;
}

.result-line-2-main {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

:global([data-theme='dark']) .result-name,
:global(html[data-theme='dark']) .result-name,
:global(:root[data-theme='dark']) .result-name {
  color: #f3f4f6;
}

.result-room-title {
  display: block;
  max-width: 100%;
  font-size: 11px;
  color: var(--secondary-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:global([data-theme='dark']) .result-room-title,
:global(html[data-theme='dark']) .result-room-title,
:global(:root[data-theme='dark']) .result-room-title {
  color: #9ca3af;
}

.styled-badge {
  font-size: 10px;
  padding: 2px 10px;
  border-radius: 100px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

:global([data-theme='dark']) .styled-badge,
:global(html[data-theme='dark']) .styled-badge,
:global(:root[data-theme='dark']) .styled-badge {
  color: #e2e8f0;
}

.live-status-badge.is-live {
  background: rgba(255, 62, 62, 0.15);
  color: #ff3e3e;
  border: 1px solid rgba(255, 62, 62, 0.2);
}

.platform-tag {
  background: var(--hover-bg);
  color: var(--secondary-text);
  border: 1px solid var(--glass-border);
}

:global([data-theme='dark']) .platform-tag,
:global(html[data-theme='dark']) .platform-tag,
:global(:root[data-theme='dark']) .platform-tag {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
  color: #cbd5e1;
}

.platform-tag.douyu { color: #ff7a1c; }
.platform-tag.douyin { color: #fe2c55; }
.platform-tag.huya { color: #f5a623; }
.platform-tag.bilibili { color: #fb7299; }

.search-no-results {
  padding: 12px;
  font-size: 13px;
  color: var(--secondary-text);
}

:global([data-theme='dark']) .search-no-results,
:global(html[data-theme='dark']) .search-no-results,
:global(:root[data-theme='dark']) .search-no-results,
:global([data-theme='dark']) .search-loading,
:global(html[data-theme='dark']) .search-loading,
:global(:root[data-theme='dark']) .search-loading,
:global([data-theme='dark']) .search-error-message,
:global(html[data-theme='dark']) .search-error-message,
:global(:root[data-theme='dark']) .search-error-message {
  color: #cbd5e1;
}

:global([data-theme='dark']) .avatar-placeholder,
:global(html[data-theme='dark']) .avatar-placeholder,
:global(:root[data-theme='dark']) .avatar-placeholder {
  background: rgba(255, 255, 255, 0.08);
  color: #e5e7eb;
}

.search-fallback-btn {
  background: transparent;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-weight: 600;
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  justify-content: flex-end;
  position: relative;
}

.nav-actions > .search-container {
  margin-left: auto;
}

.nav-actions--windows {
  position: static;
  padding-right: 0;
}

.nav-actions--windows :deep(.win-controls) {
  position: static !important;
}

.nav-icon-btn {
  width: 42px;
  height: 42px;
  padding: 0;
  border-radius: 999px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(250, 252, 255, 0.62);
  border-style: solid;
  border-color: #ffffff;
  border-width: 0.8px 0.35px;
  box-shadow:
    0 1px 3px rgba(15, 23, 42, 0.04),
    0 4px 8px rgba(15, 23, 42, 0.05);
  backdrop-filter: blur(18px) saturate(1.05);
  -webkit-backdrop-filter: blur(18px) saturate(1.05);
  transition: background-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}

:global([data-theme='dark']) .nav-icon-btn {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  border-color: rgba(255, 255, 255, 0.42);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  box-shadow: none !important;
}

.nav-icon-btn:hover {
  background-color: rgba(255, 255, 255, 0.92);
  transform: translateY(-1px);
}

:global([data-theme='dark']) .nav-icon-btn:hover {
  background-color: transparent !important;
  background-image: none !important;
}

:global([data-theme='dark']) .nav-icon-btn:active {
  background-color: transparent !important;
  background-image: none !important;
}

.nav-icon-btn:active {
  transform: translateY(0);
}

.mini-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-color);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: mini-spin 0.8s linear infinite;
}

@keyframes mini-spin {
  to { transform: rotate(360deg); }
}

.win-controls-wrap {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
}

.win-controls-wrap :deep(.win-controls) {
  position: static !important;
}

.github-btn {
  position: relative;
  padding: 0;
  transform: translateY(-2px);
  overflow: hidden;
}

.github-btn :deep(svg) {
  transform: translateY(-4px);
}

.github-badge {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 17px;
  padding: 5px 0 0;
  border-radius: 0 0 999px 999px;
  font-size: 7px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.18px;
  text-transform: uppercase;
  color: rgba(20, 28, 36, 0.8);
  background: linear-gradient(180deg, rgba(245, 250, 253, 0.98), rgba(229, 236, 242, 0.94));
  border: none;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.8),
    inset 0 -1px 0 rgba(129, 141, 155, 0.24);
  text-shadow: 0 0.5px 0 rgba(255, 255, 255, 0.5);
  opacity: 0.99;
  text-align: center;
  pointer-events: none;
  z-index: 2;
}

:global([data-theme='dark']) .github-badge {
  color: #ffffff;
  background: linear-gradient(180deg, rgba(74, 84, 90, 0.34), rgba(56, 65, 71, 0.44));
  border: none;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    inset 0 -1px 0 rgba(0, 0, 0, 0.22);
  text-shadow: 0 0.5px 0 rgba(0, 0, 0, 0.28);
  opacity: 0.92;
}

</style>
