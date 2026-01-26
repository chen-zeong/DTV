<template>
  <nav
    class="sticky top-0 z-50 flex items-center border-b border-border-main bg-surface-low/40 px-5 py-2 backdrop-blur-md"
    data-tauri-drag-region
    :style="{
      paddingRight:
        shouldShowWindowsControls && !isMacPreview ? '160px' : '20px',
    }"
  >
    <div class="flex w-full items-center gap-4" data-tauri-drag-region>
      <!-- Balanced Flex Spacer for left side -->
      <div
        class="flex flex-1 items-center justify-start"
        data-tauri-drag-region
      ></div>

      <!-- Center Search Area -->
      <div
        class="relative flex flex-none items-center gap-3"
        data-tauri-drag-region
      >
        <button
          type="button"
          class="flex size-10 items-center justify-center rounded-full border border-border-main bg-surface-mid text-text-muted hover:scale-[1.03] hover:bg-surface-high"
          aria-label="首页"
          @click="goHome"
        >
          <Home :size="18" />
        </button>

        <div class="relative" ref="gridMenuRef">
          <button
            type="button"
            class="flex size-10 items-center justify-center rounded-full border border-border-main bg-surface-mid text-text-muted hover:scale-[1.03] hover:bg-surface-high"
            :class="{ 'text-brand border-brand/30 bg-brand/10': route.name === 'MultiView' }"
            aria-label="分屏模式"
            title="切换分屏模式"
            @click="showGridMenu = !showGridMenu"
          >
            <LayoutGrid :size="18" />
          </button>

          <!-- Grid Selection Menu -->
          <div
            v-if="showGridMenu"
            class="absolute top-[calc(100%+12px)] right-0 z-[1001] w-32 rounded-xl border border-border-strong bg-surface-low/95 p-2 shadow-2xl backdrop-blur-xl"
          >
            <div
              class="mb-2 px-2 py-1 text-[10px] font-black tracking-widest text-text-muted uppercase"
            >
              分屏布局
            </div>
            <div class="flex flex-col gap-1">
              <button
                v-for="mode in [4, 6, 9]"
                :key="mode"
                @click="switchGridMode(mode)"
                class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-colors hover:bg-surface-high"
                :class="playerStore.gridMode === mode ? 'text-brand bg-brand/10' : 'text-text-main'"
              >
                <div class="grid gap-0.5 size-4" :class="mode === 4 ? 'grid-cols-2' : 'grid-cols-3'">
                  <span v-for="i in mode" :key="i" class="bg-current rounded-[1px] opacity-50"></span>
                </div>
                <span>{{ mode }}宫格</span>
              </button>
            </div>
          </div>
        </div>

        <div
          class="relative max-w-full transition-all duration-300 ease-in-out"
          :class="playerStore.currentStreamer ? 'w-90' : 'w-130'"
          ref="searchContainerRef"
          data-tauri-drag-region="false"
        >
          <div
            class="relative z-1000 flex h-10 w-full items-center gap-2 rounded-full border border-border-main bg-surface-high/50 px-4 text-sm text-text-main dark:bg-neutral-800"
            :class="{ 'shadow-md ring-1 ring-brand/50': isSearchFocused }"
          >
            <Search class="size-4 text-text-muted" />
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="placeholderText"
              data-tauri-drag-region="false"
              class="w-full bg-transparent text-sm outline-none placeholder:text-text-muted"
              @focus="handleFocus"
              @blur="handleBlur"
              @input="handleSearch"
            />
            <button
              v-if="searchQuery"
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-full text-text-muted hover:bg-surface-high"
              data-tauri-drag-region="false"
              aria-label="清除搜索"
              @click="resetSearchState"
            >
              <X :size="14" />
            </button>
          </div>

          <div
            v-show="showResults && trimmedQuery"
            class="scrollbar-none absolute top-[calc(100%+12px)] right-0 left-0 z-[1001] max-h-[520px] overflow-y-auto rounded-xl border border-border-strong bg-surface-low/95 p-3 shadow-2xl backdrop-blur-xl dark:bg-neutral-900/95"
          >
            <!-- Loading/Error -->
            <div
              v-if="isLoadingSearch"
              class="flex items-center justify-center gap-3 py-8 text-text-muted"
            >
              <div
                class="size-4 animate-spin rounded-full border-2 border-brand border-t-transparent"
              ></div>
              <span class="text-sm font-medium">搜索中...</span>
            </div>
            <div
              v-else-if="searchError"
              class="rounded-lg border border-red-500/10 bg-red-500/5 px-3 py-4 text-center text-sm text-red-500"
            >
              {{ searchError }}
            </div>

            <!-- Category Results -->
            <div
              v-if="categoryResults.length > 0 && !isLoadingSearch"
              class="mb-4"
            >
              <div
                class="mb-1 flex items-center gap-2 px-2 py-1 text-[10px] font-black tracking-widest text-text-muted uppercase"
              >
                <Tag class="size-3" /> 分类
              </div>
              <div class="grid grid-cols-1 gap-1">
                <div
                  v-for="cat in categoryResults"
                  :key="cat.platform + '-' + cat.id"
                  class="group flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-surface-high"
                  @mousedown="selectCategory(cat)"
                >
                  <div class="flex items-center gap-3 overflow-hidden">
                    <div
                      class="flex size-8 items-center justify-center rounded bg-surface-mid text-text-muted group-hover:bg-brand/20 group-hover:text-brand"
                    >
                      <Tag class="size-4" />
                    </div>
                    <span
                      class="truncate text-sm font-semibold text-text-main"
                      >{{ cat.name }}</span
                    >
                  </div>
                  <span
                    class="rounded bg-surface-mid px-2 py-0.5 text-[10px] font-bold tracking-wider text-text-muted uppercase"
                    >{{ cat.platform }}</span
                  >
                </div>
              </div>
            </div>

            <!-- Anchor Results -->
            <div v-if="searchResults.length > 0 && !isLoadingSearch">
              <div
                class="mb-1 flex items-center gap-2 px-2 py-1 text-[10px] font-black tracking-widest text-text-muted uppercase"
              >
                <User class="size-3" /> 主播与房间
              </div>
              <div class="space-y-1">
                <div
                  v-for="anchor in searchResults"
                  :key="anchor.platform + '-' + anchor.roomId"
                  class="group flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2.5 hover:bg-surface-high"
                  @mousedown="selectAnchor(anchor)"
                >
                  <div
                    class="h-10 w-10 flex-shrink-0 overflow-hidden rounded-full border border-border-main shadow-lg"
                  >
                    <img
                      v-if="anchor.avatar"
                      :src="anchor.avatar"
                      :alt="anchor.userName"
                      class="h-full w-full object-cover group-hover:scale-110"
                    />
                    <div
                      v-else
                      class="flex h-full w-full items-center justify-center bg-surface-mid text-lg font-bold text-text-muted"
                    >
                      {{ anchor.userName[0] }}
                    </div>
                  </div>

                  <div class="min-w-0 flex-1">
                    <div class="mb-0.5 flex items-center gap-2">
                      <span
                        class="truncate text-sm font-bold text-text-main group-hover:text-brand"
                        :title="anchor.userName"
                      >
                        {{ anchor.userName }}
                      </span>
                      <span
                        v-if="anchor.liveStatus"
                        class="flex size-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"
                      ></span>
                    </div>
                    <div class="flex items-center gap-2">
                      <span
                        class="truncate text-xs font-medium text-text-dim"
                        :title="anchor.roomTitle || '暂无标题'"
                      >
                        {{ anchor.roomTitle || "暂无标题" }}
                      </span>
                    </div>
                  </div>

                  <div class="flex flex-col items-end gap-1.5">
                    <span
                      class="rounded border border-border-main bg-surface-mid px-2 py-0.5 text-[10px] font-black tracking-[0.5px] uppercase group-hover:border-brand/30 group-hover:bg-brand/20 group-hover:text-brand"
                      :style="{
                        color:
                          anchor.platform === Platform.DOUYU
                            ? '#ff7a1c'
                            : anchor.platform === Platform.DOUYIN
                              ? '#fe2c55'
                              : anchor.platform === Platform.HUYA
                                ? '#f5a623'
                                : anchor.platform === Platform.BILIBILI
                                  ? '#fb7299'
                                  : '',
                      }"
                    >
                      {{ PLATFORM_MAP[anchor.platform.toLowerCase() as UiPlatform]?.name || anchor.platform }}
                    </span>
                    <span
                      class="flex items-center gap-1 font-mono text-[9px] text-text-muted"
                    >
                      <Hash class="size-2.5" />
                      {{ anchor.webId || anchor.roomId }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Empty State / Direct Join -->
            <div
              v-if="
                trimmedQuery &&
                !isLoadingSearch &&
                searchResults.length === 0 &&
                categoryResults.length === 0
              "
              class="flex flex-col items-center justify-center px-6 py-12 text-center"
            >
              <div
                class="mb-4 flex size-16 items-center justify-center rounded-full bg-surface-mid text-text-muted"
              >
                <Search class="size-8" />
              </div>
              <p class="mb-1 text-sm font-medium text-text-main">
                未找到相关结果
              </p>
              <p class="mb-6 text-xs text-text-muted">
                试试搜索其他关键词或直接输入房间号
              </p>

              <button
                v-if="isPureNumeric(trimmedQuery)"
                class="rounded-full bg-brand px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-brand/20 hover:bg-brand-hover active:scale-95"
                @mousedown.prevent="tryEnterRoom(trimmedQuery)"
                @click.prevent="tryEnterRoom(trimmedQuery)"
              >
                进入房间 {{ trimmedQuery }}
              </button>
            </div>
          </div>
        </div>
        <TransitionGroup
          name="list"
          tag="div"
          class="scrollbar-none flex items-center gap-2 overflow-x-auto"
        >
          <NavbarPlayerTab
            v-for="(streamer, index) in playerStore.activeStreamers"
            :key="`${streamer.platform}:${streamer.roomId}`"
            :room-id="streamer.roomId"
            :platform="streamer.platform"
            :anchor-name="streamer.anchorName"
            :avatar="streamer.avatar"
            :is-live="streamer.isLive"
            :is-muted="!!streamer.isMuted"
            :is-active="isTabActive(streamer.platform, streamer.roomId)"
            @select="switchToPlayer(streamer)"
            @close="closePlayer(streamer)"
            @toggle-mute="playerStore.toggleMute(streamer.platform, streamer.roomId)"
            @dragstart="onDragStart(index)"
            @drop="onDrop(index)"
          />
        </TransitionGroup>
      </div>

      <div
        class="flex flex-1 items-center justify-end gap-2"
        data-tauri-drag-region="false"
      >
        <button
          type="button"
          class="flex h-10 w-10 items-center justify-center rounded-full border border-border-main bg-surface-mid text-text-muted hover:scale-[1.03] hover:bg-surface-high"
          @click="openGithub"
        >
          <Github :size="18" />
        </button>
        <div class="relative" ref="colorPaletteRef">
          <button
            type="button"
            class="flex h-10 w-10 items-center justify-center rounded-full border border-border-main bg-surface-mid text-text-muted hover:scale-[1.03] hover:bg-surface-high"
            @click="changeThemeColor"
            :class="{
              'border-brand/30 bg-brand/10 text-brand': showColorPalette,
            }"
            title="切换主题色"
          >
            <Palette :size="18" />
          </button>

          <!-- Color Palette Popover -->
          <div
            v-if="showColorPalette"
            class="absolute top-[calc(100%+12px)] right-0 z-[1001] w-48 rounded-xl border border-border-strong bg-surface-low/95 p-3 shadow-2xl backdrop-blur-xl"
          >
            <div
              class="mb-3 px-1 text-[10px] font-black tracking-widest text-text-muted uppercase"
            >
              选择主题色
            </div>
            <div class="grid grid-cols-4 gap-2">
              <button
                v-for="color in availableColors"
                :key="color.value"
                @click="selectThemeColor(color.value)"
                class="size-8 rounded-full border-2 transition-transform hover:scale-110 active:scale-95"
                :style="{
                  backgroundColor: color.value,
                  borderColor:
                    themeStore.primaryColor === color.value
                      ? 'white'
                      : 'transparent',
                }"
                :title="color.name"
              ></button>
            </div>

            <!-- RGB Picker -->
            <div class="mt-4 flex flex-col gap-2 border-t border-white/5 pt-3">
              <div
                class="px-1 text-[10px] font-black tracking-widest text-text-muted uppercase"
              >
                自定义 RGB
              </div>
              <div
                class="flex items-center gap-3 rounded-lg border border-border-main bg-surface-mid p-2"
              >
                <input
                  type="color"
                  :value="themeStore.primaryColor"
                  @input="
                    (e) =>
                      selectThemeColor((e.target as HTMLInputElement).value)
                  "
                  class="size-10 cursor-pointer rounded border-0 bg-transparent"
                />
                <div class="flex min-w-0 flex-col">
                  <span class="font-mono text-[10px] text-text-muted uppercase"
                    >Hex Code</span
                  >
                  <span
                    class="truncate font-mono text-xs font-bold text-text-main uppercase"
                    >{{ themeStore.primaryColor }}</span
                  >
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="shouldShowWindowsControls && !isMacPreview"
        class="absolute top-[-1px] right-[-1px] flex flex-col items-end gap-1"
      >
        <WindowsWindowControls />
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { platform as detectPlatform } from "@tauri-apps/plugin-os";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useRoute, useRouter } from "vue-router";
import {
  Github,
  Search,
  X,
  Tag,
  User,
  Hash,
  Home,
  Palette,
  LayoutGrid,
} from "lucide-vue-next";
import { onClickOutside } from "@vueuse/core";
import WindowsWindowControls from "../window-controls/WindowsWindowControls.vue";
import NavbarPlayerTab from "./NavbarPlayerTab.vue";
import { useThemeStore } from "../../store/theme";
import { usePlayerStore } from "../../store/playerStore";
import { Platform, type UiPlatform } from "../../types/app/platform";
import { huyaCategoriesData } from "../../services/platforms/huya/huyaCategoriesData";
import { douyinCategoriesData } from "../../services/platforms/douyin/douyinCategoriesData";
import { biliCategoriesData } from "../../services/platforms/bilibili/biliCategoriesData";
import type { Category1, Category2 } from "../../types/models/category";
import { PLATFORM_MAP } from "../../config/platforms";
import Fuse from "fuse.js";
import { 
  searchDouyuAnchor, 
  searchHuyaAnchors, 
  searchBilibiliRooms,
} from "../../api/search";
import { startStaticProxyServer } from "../../api/proxy";
import { getLiveStreamV2 } from "../../api/live";

interface CategorySearchResult {
  type: "category";
  platform: Platform;
  name: string;
  id: string;
  href: string;
}

// Prepare categories for indexing once
const flatCategories = [
  ...huyaCategoriesData.flatMap((c1: Category1) =>
    (c1.subcategories || []).map((c2: Category2) => ({
      name: c2.title,
      id: String((c2 as any).id || c2.href),
      href: c2.href,
      platform: Platform.HUYA,
    })),
  ),
  ...douyinCategoriesData.flatMap((c1: Category1) =>
    (c1.subcategories || []).map((c2: Category2) => ({
      name: c2.title,
      id: String(c2.href),
      href: c2.href,
      platform: Platform.DOUYIN,
    })),
  ),
  ...biliCategoriesData.flatMap((c1: Category1) =>
    (c1.subcategories || []).map((c2: Category2) => ({
      name: c2.title,
      id: String((c2 as any).id || c2.href),
      href: c2.href,
      platform: Platform.BILIBILI,
    })),
  ),
];

const fuse = new Fuse(flatCategories, {
  keys: [
    { name: "name", weight: 0.7 },
    { name: "id", weight: 0.3 },
  ],
  threshold: 0.35,
  distance: 100,
  minMatchCharLength: 1,
});

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
  searchQuery?: string;
  activePlatform: UiPlatform | "all";
}>();

const emit = defineEmits<{
  (event: "search-change", value: string): void;
  (event: "platform-change", value: UiPlatform | "all"): void;
  (
    event: "select-anchor",
    payload: {
      id: string;
      platform: Platform;
      nickname: string;
      avatarUrl: string | null;
      currentRoomId?: string;
    },
  ): void;
}>();

const searchQuery = ref(props.searchQuery ?? "");
const trimmedQuery = computed(() => searchQuery.value.trim());
const searchResults = ref<SearchResultItem[]>([]);
const categoryResults = ref<CategorySearchResult[]>([]);
const showResults = ref(false);
const searchError = ref<string | null>(null);
const isLoadingSearch = ref(false);
const isSearchFocused = ref(false);
const searchContainerRef = ref<HTMLElement | null>(null);
const colorPaletteRef = ref<HTMLElement | null>(null);
const showGridMenu = ref(false);
const gridMenuRef = ref<HTMLElement | null>(null);
const showColorPalette = ref(false);

const themeStore = useThemeStore();
const playerStore = usePlayerStore();
const route = useRoute();
const router = useRouter();

const switchGridMode = (mode: number) => {
  playerStore.setGridMode(mode);
  showGridMenu.value = false;
  if (route.name !== 'MultiView') {
    router.push({ name: 'MultiView' });
  }
};

onClickOutside(gridMenuRef, () => {
  showGridMenu.value = false;
});

const availableColors = [
  { name: "红色", value: "#ef4444" },
  { name: "橙色", value: "#f97316" },
  { name: "琥珀", value: "#f59e0b" },
  { name: "翠绿", value: "#10b981" },
  { name: "青色", value: "#06b6d4" },
  { name: "蓝色", value: "#3b82f6" },
  { name: "靛蓝", value: "#6366f1" },
  { name: "紫罗兰", value: "#8b5cf6" },
  { name: "紫色", value: "#a855f7" },
  { name: "洋红", value: "#d946ef" },
  { name: "粉色", value: "#ec4899" },
];

const goHome = () => {
  router.push({ name: "ChannelList" });
};

const draggedIndex = ref<number | null>(null);

const onDragStart = (index: number) => {
  draggedIndex.value = index;
};

const onDrop = (targetIndex: number) => {
  if (draggedIndex.value === null) return;
  const list = [...playerStore.activeStreamers];
  const [movedItem] = list.splice(draggedIndex.value, 1);
  list.splice(targetIndex, 0, movedItem);
  playerStore.updateActiveOrder(list);
  draggedIndex.value = null;
};

const isTabActive = (platform: string, roomId: string) => {
  return (
    route.name === "StreamRoom" &&
    route.params.platform?.toString().toLowerCase() === platform.toLowerCase() &&
    route.params.roomId?.toString() === roomId
  );
};

const switchToPlayer = (streamer: any) => {
  router.push({
    name: "StreamRoom",
    params: {
      platform: streamer.platform.toLowerCase(),
      roomId: streamer.roomId,
    },
  });
};

const closePlayer = (streamer: any) => {
  playerStore.removeStreamer(streamer.platform, streamer.roomId);
  // If we closed the active tab, navigate to the new current one or home
  if (isTabActive(streamer.platform, streamer.roomId)) {
    if (playerStore.currentStreamer) {
      switchToPlayer(playerStore.currentStreamer);
    } else {
      goHome();
    }
  }
};

const changeThemeColor = () => {
  showColorPalette.value = !showColorPalette.value;
};

const selectThemeColor = (color: string) => {
  themeStore.setPrimaryColor(color);
  showColorPalette.value = false;
};

onClickOutside(colorPaletteRef, () => {
  showColorPalette.value = false;
});

const performLocalCategorySearch = (query: string): CategorySearchResult[] => {
  if (!query) return [];

  const q = query.toLowerCase();

  // 1. Precise substring match (guarantees results like "999" -> "9999")
  const substringMatches = flatCategories.filter(
    (c) => c.id.toLowerCase().includes(q) || c.name?.toLowerCase().includes(q),
  );

  // 2. Fuzzy match via Fuse.js
  const fuseResults = fuse.search(query).map((r) => r.item);

  // 3. Combine and deduplicate
  const combined = [...substringMatches, ...fuseResults];
  const seen = new Set<string>();
  const uniqueResults: CategorySearchResult[] = [];

  for (const res of combined) {
    const key = `${res.platform}-${res.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueResults.push({
        type: "category",
        ...res,
      } as CategorySearchResult);
    }
    if (uniqueResults.length >= 10) break;
  }

  return uniqueResults;
};

const selectCategory = (cat: CategorySearchResult) => {
  router.push({
    name: "PlatformHome",
    params: { platform: cat.platform.toLowerCase() },
  });
  showResults.value = false;
  resetSearchState();
};

const detectedPlatform = ref<string | null>(null);
const isMacPreview = false;
const isWindowsPlatform = computed(() => {
  const name = detectedPlatform.value?.toLowerCase() ?? "";
  return name.startsWith("win");
});
const shouldShowWindowsControls = computed(() => isWindowsPlatform.value);

const proxyBase = ref<string | null>(null);
const ensureProxyStarted = async () => {
  if (!proxyBase.value) {
    try {
      const base = await startStaticProxyServer();
      proxyBase.value = base;
    } catch (e) {
      console.error("[Navbar] Failed to start static proxy server", e);
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
  return "搜索主播名称/房间号，热门游戏，分区";
});

onMounted(async () => {
  try {
    detectedPlatform.value = await detectPlatform();
  } catch (error) {
    console.error("[Navbar] Failed to detect platform", error);
    if (typeof navigator !== "undefined") {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes("windows")) {
        detectedPlatform.value = "windows";
      }
    }
  }
});

onMounted(() => {
  if (isMacPreview && typeof document !== "undefined") {
    document.documentElement.setAttribute("data-platform", "darwin");
  } else if (typeof document !== "undefined") {
    document.documentElement.removeAttribute("data-platform");
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
  document.addEventListener("mousedown", handleDocumentMouseDown);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", handleDocumentMouseDown);
});

const openGithub = async () => {
  try {
    await openUrl("https://github.com/chen-zeong/DTV/releases");
  } catch (error) {
    if (typeof window !== "undefined") {
      window.open(
        "https://github.com/chen-zeong/DTV/releases",
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }
    console.error("[Navbar] Failed to open GitHub", error);
  }
};

let searchTimeout: number | null = null;


const isPureNumeric = (value: string): boolean => /^\d+$/.test(value);

const resetSearchState = () => {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
    searchTimeout = null;
  }
  searchQuery.value = "";
  searchResults.value = [];
  categoryResults.value = [];
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
  emit("search-change", searchQuery.value);

  searchTimeout = window.setTimeout(() => {
    performSearchBasedOnInput();
  }, 500);
};

const performSearchBasedOnInput = async () => {
  const query = trimmedQuery.value;
  if (!query) {
    searchResults.value = [];
    categoryResults.value = [];
    showResults.value = false;
    isLoadingSearch.value = false;
    return;
  }
  searchQuery.value = query;

  // Clear previous results
  searchResults.value = [];
  categoryResults.value = [];

  // Local Category Search (Synchronous)
  categoryResults.value = performLocalCategorySearch(query);

  // Platform specific Anchor Search
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
  try {
    const resp = await getLiveStreamV2({
      platform: "douyin",
      room_id: userInputRoomId,
      debug: false,
      mode: "meta",
    });

    if (resp.status !== "error" && resp.room?.anchor_name) {
      const isLive = resp.status === "live";
      const webId = resp.room.web_rid ?? userInputRoomId;
      searchResults.value = [
        {
          platform: Platform.DOUYIN,
          roomId: webId,
          webId,
          userName: resp.room.anchor_name || "抖音主播",
          roomTitle: resp.room.title || null,
          avatar: resp.room.avatar || null,
          liveStatus: isLive,
          rawStatus: isLive ? 2 : 0,
        },
      ];
    }
  } catch (e) {
    console.error("Douyin search error:", e);
    // Only set error on actual failure
    searchError.value = "搜索服务暂时不可用";
  }
  showResults.value = true;
};

const performHuyaSearch = async (keyword: string) => {
  try {
    const items = await searchHuyaAnchors(keyword);
    await ensureProxyStarted();
    if (Array.isArray(items) && items.length > 0) {
      searchResults.value = items.map(
        (item): SearchResultItem => ({
          platform: Platform.HUYA,
          roomId: item.room_id,
          userName: item.user_name || "虎牙主播",
          roomTitle: item.title || null,
          avatar: proxify(item.avatar || null),
          liveStatus: !!item.live_status,
        }),
      );
    }
  } catch (e) {
    console.error("Huya search error:", e);
    searchError.value = "搜索服务暂时不可用";
  }
  showResults.value = true;
};

const performDouyuSearch = async (keyword: string) => {
  try {
    const response = await searchDouyuAnchor(keyword);
    const data = JSON.parse(response);
    if (data.error === 0 && data.data && data.data.relateUser) {
      searchResults.value = data.data.relateUser
        .filter((item: any) => item.type === 1)
        .map((item: any): SearchResultItem => {
          const anchorInfo = item.anchorInfo;
          const isReallyLive =
            anchorInfo.isLive === 1 && anchorInfo.videoLoop !== 1;
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
    }
  } catch (e) {
    console.error("Douyu search error:", e);
    searchError.value = "搜索服务暂时不可用";
  }
  showResults.value = true;
};

const performBilibiliSearch = async (keyword: string) => {
  try {
    const response = await searchBilibiliRooms(keyword);
    await ensureProxyStarted();
    if (Array.isArray(response) && response.length > 0) {
      searchResults.value = response.map((item) => ({
        platform: Platform.BILIBILI,
        roomId: item.room_id,
        webId: item.room_id,
        userName: item.anchor || "B站主播",
        roomTitle: item.title || null,
        avatar: proxify(item.avatar),
        liveStatus: item.is_live,
        fansCount: item.watching,
        category: item.area,
      }));
    }
  } catch (e) {
    console.error("Bilibili search error:", e);
    searchError.value = "搜索服务暂时不可用";
  } finally {
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
  emit("select-anchor", {
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
  emit("select-anchor", {
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
.list-enter-active,
.list-leave-active {
  transition: all 0.3s ease;
}
.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateX(-10px) scale(0.9);
}
</style>