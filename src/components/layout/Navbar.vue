<template>
  <nav class="sticky top-0 z-50 flex py-2 items-center px-5 " data-tauri-drag-region :style="{
    paddingRight: shouldShowWindowsControls && !isMacPreview ? '160px' : '20px',
  }">


    <div class="flex w-full items-center gap-2" data-tauri-drag-region>
      <div class="flex flex-1"> </div>
      <div class="size-10 rounded-full bg-white/30"></div>
      <div class="relative flex-none" data-tauri-drag-region>
       
        <div class="relative w-130 max-w-full" ref="searchContainerRef" data-tauri-drag-region="false">
          <div
            class="relative z-1000 flex h-10 w-full items-center gap-2 rounded-full bg-neutral-700   px-4 text-sm   transition-transform duration-200"
            :class="{ '  ring-1': isSearchFocused }">
            <Search class="size-4" />
            <input v-model="searchQuery" type="text" :placeholder="placeholderText" data-tauri-drag-region="false"
              class="w-full bg-transparent text-sm  outline-none" @focus="handleFocus" @blur="handleBlur"
              @input="handleSearch" />
            <button v-if="searchQuery" type="button"
              class="flex h-7 w-7 items-center justify-center rounded-full  transition-all duration-200 "
              data-tauri-drag-region="false" aria-label="清除搜索" @click="resetSearchState">
              <X :size="14" />
            </button>
          </div>

          <div v-show="showResults && trimmedQuery"
            class="absolute left-0 right-0 top-[calc(100%+12px)] z-[1001] max-h-[480px] overflow-y-auto  border   p-2">
            <div v-if="isLoadingSearch" class="px-3 py-2 text-[13px]">搜索中...</div>
            <div v-else-if="searchError" class="px-3 py-2 text-[13px]">{{ searchError }}
            </div>
            <div v-else-if="searchResults.length > 0" class="space-y-1">
              <div v-for="anchor in searchResults" :key="anchor.platform + '-' + anchor.roomId"
                class="flex items-center gap-2.5  px-2.5 py-2 transition-all duration-200 hover:translate-x-1"
                @mousedown="selectAnchor(anchor)">
                <div class="h-9 w-9 flex-shrink-0 overflow-hidden rounded-full border-2 ">
                  <img v-if="anchor.avatar" :src="anchor.avatar" :alt="anchor.userName"
                    class="h-full w-full object-cover" />
                  <div v-else class="flex h-full w-full items-center justify-center ">{{
                    anchor.userName[0] }}</div>
                </div>

                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="truncate text-[13px] font-semibold" :title="anchor.userName">{{ anchor.userName
                    }}</span>
                    <span class="rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.5px]"
                      :class="anchor.liveStatus ? 'border-[rgba(168,85,247,0.3)] bg-[rgba(168,85,247,0.22)]' : 'border-[var(--border)] '">
                      {{ anchor.liveStatus ? '直播' : '未播' }}
                    </span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="truncate text-xs" :title="anchor.roomTitle || '暂无标题'">{{
                      anchor.roomTitle || '暂无标题' }}</span>
                    <span
                      class="rounded-full border   px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.5px]">{{
                        anchor.webId || anchor.roomId }}</span>
                  </div>
                </div>

                <div class="flex items-center">
                  <span class="rounded-full border   px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.5px]"
                    :class="[
                      anchor.platform.toLowerCase(),
                      { douyu: anchor.platform === Platform.DOUYU, douyin: anchor.platform === Platform.DOUYIN, huya: anchor.platform === Platform.HUYA }
                    ]"
                    :style="anchor.platform === Platform.DOUYU ? 'color: #ff7a1c' : anchor.platform === Platform.DOUYIN ? 'color: #fe2c55' : anchor.platform === Platform.HUYA ? 'color: #f5a623' : anchor.platform === Platform.BILIBILI ? 'color: #fb7299' : ''">
                    {{ anchor.platform === Platform.DOUYU ? '斗鱼' : (anchor.platform === Platform.DOUYIN ? '抖音' :
                      (anchor.platform === Platform.HUYA ? '虎牙' : anchor.platform)) }}
                  </span>
                </div>
              </div>
            </div>

            <div v-else-if="trimmedQuery && !isLoadingSearch && !searchError" class="px-3 py-2 text-[13px]">
              未找到结果
              <button v-if="isPureNumeric(trimmedQuery)" class="font-semibold"
                @mousedown.prevent="tryEnterRoom(trimmedQuery)" @click.prevent="tryEnterRoom(trimmedQuery)">
                进入房间 {{ trimmedQuery }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="flex flex-1 items-center justify-end gap-2" data-tauri-drag-region="false">
        <!-- History Popover -->
        <div class="relative" ref="historyContainerRef">
          <button type="button"
            class="flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-200 hover:scale-[1.03]"
            :class="{ 'bg-[var(--surface-3)]': showHistory }" @click="toggleHistory">
            <History :size="18" />
          </button>

          <div v-if="showHistory"
            class="absolute right-0 top-[calc(100%+12px)] z-[1001] w-72 max-h-[480px] overflow-y-auto border p-2">
            <div class="px-3 py-2 text-xs font-bold uppercase tracking-wider border-b mb-2">
              最近播放
            </div>
            <div v-if="recentItems.length === 0" class="px-3 py-8 text-center text-sm">
              暂无播放记录
            </div>
            <div v-else class="space-y-1">
              <button v-for="streamer in recentItems" :key="streamer.id"
                class="flex w-full items-center gap-3 p-2 text-left transition-all duration-200 group"
                @click="handleSelectHistory(streamer)">
                <div class="flex size-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border">
                  <img v-if="streamer.avatarUrl" :src="streamer.avatarUrl" :alt="streamer.nickname"
                    class="h-full w-full object-cover" />
                  <div v-else class="text-[10px] font-bold">LIVE</div>
                </div>
                <div class="min-w-0 flex-1 flex flex-col justify-center">
                  <div class="truncate text-[13px] font-semibold">{{ streamer.nickname || '未知主播' }}</div>
                  <div class="truncate text-[11px]">{{ streamer.platform }} · {{ streamer.roomTitle || '正在直播' }}</div>
                </div>
              </button>
            </div>
          </div>
        </div>

        <button type="button"
          class="flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-200 hover:scale-[1.03]"
          @click="openGithub">
          <Github :size="18" />
        </button>
        <button type="button"
          class="flex h-10 w-10 items-center justify-center rounded-full border    transition-all duration-200 hover:scale-[1.03]">
          <Bell :size="18" />
        </button>
        <button type="button"
          class="flex h-10 w-10 items-center justify-center rounded-full border    transition-all duration-200 hover:scale-[1.03]"
          @click="toggleTheme">
          <Sun v-if="effectiveTheme === 'dark'" :size="18" />
          <Moon v-else :size="18" />
        </button>
      </div>

      <div v-if="shouldShowWindowsControls && !isMacPreview"
        class="absolute right-[-1px] top-[-1px] flex flex-col items-end gap-1">
        <WindowsWindowControls />
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { platform as detectPlatform } from '@tauri-apps/plugin-os';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useRoute } from 'vue-router';
import { Bell, Github, Menu, Moon, Search, Sun, X, History } from 'lucide-vue-next';
import { onClickOutside } from '@vueuse/core';
import WindowsWindowControls from '../window-controls/WindowsWindowControls.vue';
import { useThemeStore } from '../../stores/theme';
import { useFollowStore } from '../../stores/followStore';
import { Platform, type UiPlatform } from '../../platforms/common/types';
import type { FollowedStreamer } from '../../platforms/common/types';

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

const searchQuery = ref(props.searchQuery ?? '');
const trimmedQuery = computed(() => searchQuery.value.trim());
const searchResults = ref<SearchResultItem[]>([]);
const showResults = ref(false);
const searchError = ref<string | null>(null);
const isLoadingSearch = ref(false);
const isSearchFocused = ref(false);
const searchContainerRef = ref<HTMLElement | null>(null);
const historyContainerRef = ref<HTMLElement | null>(null);
const showHistory = ref(false);

const themeStore = useThemeStore();
const followStore = useFollowStore();
const effectiveTheme = computed(() => themeStore.getEffectiveTheme());
const route = useRoute();

const recentItems = computed(() => followStore.getFollowedStreamers.slice(0, 12));

const toggleHistory = () => {
  showHistory.value = !showHistory.value;
};

onClickOutside(historyContainerRef, () => {
  showHistory.value = false;
});

const handleSelectHistory = (streamer: FollowedStreamer) => {
  emit('select-anchor', {
    id: streamer.id,
    platform: streamer.platform,
    nickname: streamer.nickname,
    avatarUrl: streamer.avatarUrl,
    currentRoomId: streamer.currentRoomId
  });
  showHistory.value = false;
};

const detectedPlatform = ref<string | null>(null);
const isMacPreview = false;
const isWindowsPlatform = computed(() => {
  const name = detectedPlatform.value?.toLowerCase() ?? '';
  return name.startsWith('win');
});
const shouldShowWindowsControls = computed(() => isWindowsPlatform.value);

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
  const platformParam = route.params.platform as string | undefined;
  if (platformParam) {
    return platformParam.toUpperCase() as Platform;
  }
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
      }
    }
  }
});

onMounted(() => {
  if (isMacPreview && typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-platform', 'darwin');
  } else if (typeof document !== 'undefined') {
    document.documentElement.removeAttribute('data-platform');
  }
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
};

const handleSearch = () => {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }
  searchError.value = null;
  isLoadingSearch.value = true;
  emit('search-change', searchQuery.value);

  searchTimeout = window.setTimeout(() => {
    performSearchBasedOnInput();
  }, 500);
};

const performSearchBasedOnInput = async () => {
  const query = trimmedQuery.value;
  if (!query) {
    searchResults.value = [];
    showResults.value = false;
    isLoadingSearch.value = false;
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
    showResults.value = true;
  }
};

const handleFocus = () => {
  isSearchFocused.value = true;
  showResults.value = true;
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
