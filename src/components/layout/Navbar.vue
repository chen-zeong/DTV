<template>
  <nav
    class="sticky top-0 z-50 flex items-center border-b border-border-main bg-surface-low/80 px-5 py-2 shadow-md backdrop-blur-md"
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
                      :style="
                        anchor.platform === Platform.DOUYU
                          ? 'color: #ff7a1c'
                          : anchor.platform === Platform.DOUYIN
                            ? 'color: #fe2c55'
                            : anchor.platform === Platform.HUYA
                              ? 'color: #f5a623'
                              : anchor.platform === Platform.BILIBILI
                                ? 'color: #fb7299'
                                : ''
                      "
                    >
                      {{
                        anchor.platform === Platform.DOUYU
                          ? "斗鱼"
                          : anchor.platform === Platform.DOUYIN
                            ? "抖音"
                            : anchor.platform === Platform.HUYA
                              ? "虎牙"
                              : anchor.platform
                      }}
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
        <Transition
          enter-active-class="transition-all duration-300 ease-out"
          enter-from-class="opacity-0 -translate-x-2 scale-95"
          enter-to-class="opacity-100 translate-x-0 scale-100"
          leave-active-class="transition-all duration-200 ease-in"
          leave-from-class="opacity-100 translate-x-0 scale-100"
          leave-to-class="opacity-0 -translate-x-2 scale-95"
        >
          <NavbarStreamerInfo
            v-if="playerStore.currentStreamer"
            :room-id="playerStore.currentStreamer.roomId"
            :platform="playerStore.currentStreamer.platform"
            :title="playerStore.currentStreamer.title"
            :anchor-name="playerStore.currentStreamer.anchorName"
            :avatar="playerStore.currentStreamer.avatar"
            :is-live="playerStore.currentStreamer.isLive"
          />
        </Transition>
      </div>

      <div
        class="flex flex-1 items-center justify-end gap-2"
        data-tauri-drag-region="false"
      >
      <!-- todo 窗口置顶现在 只能维持在当前桌面，切换桌面无效 -->
        <!-- <button
          type="button"
          class="flex h-10 w-10 items-center justify-center rounded-full border border-border-main bg-surface-mid text-text-muted hover:scale-[1.03] hover:bg-surface-high transition-all"
          :class="{ 'text-brand border-brand/30 bg-brand/10': isAlwaysOnTop }"
          @click="toggleAlwaysOnTop"
          :title="isAlwaysOnTop ? '取消置顶' : '窗口置顶'"
        >
          <Pin :size="18" :class="{ 'fill-current': isAlwaysOnTop }" />
        </button> -->
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
            class="absolute top-[calc(100%+12px)] right-0 z-[1001] w-48 rounded-xl border border-border-strong bg-surface-low/95 p-3 shadow-2xl backdrop-blur-xl dark:bg-neutral-900/95"
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
        <button
          type="button"
          class="flex h-10 w-10 items-center justify-center rounded-full border border-border-main bg-surface-mid text-text-muted hover:scale-[1.03] hover:bg-surface-high"
          @click="toggleTheme"
        >
          <Sun v-if="effectiveTheme === 'dark'" :size="18" />
          <Moon v-else :size="18" />
        </button>
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
import { invoke } from "@tauri-apps/api/core";
// import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform as detectPlatform } from "@tauri-apps/plugin-os";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useRoute, useRouter } from "vue-router";
import {
  Github,
  Moon,
  Search,
  Sun,
  X,
  Tag,
  User,
  Hash,
  Home,
  Palette,
  // Pin,
} from "lucide-vue-next";
import { onClickOutside } from "@vueuse/core";
import WindowsWindowControls from "../window-controls/WindowsWindowControls.vue";
import NavbarStreamerInfo from "./NavbarStreamerInfo.vue";
import { useThemeStore } from "../../stores/theme";
// import { useFollowStore } from "../../stores/followStore";
import { usePlayerStore } from "../../stores/playerStore";
import { Platform, type UiPlatform } from "../../platforms/common/types";
// import type { FollowedStreamer } from "../../platforms/common/types";
import { huyaCategoriesData } from "../../platforms/huya/huyaCategoriesData";
import { douyinCategoriesData } from "../../platforms/douyin/douyinCategoriesData";
import { biliCategoriesData } from "../../platforms/bilibili/biliCategoriesData";
import Fuse from "fuse.js";

interface CategorySearchResult {
  type: "category";
  platform: Platform;
  name: string;
  id: string;
  href: string;
}

// Prepare categories for indexing once
const flatCategories = [
  ...huyaCategoriesData.flatMap((c1) =>
    (c1.subcategories || []).map((c2: any) => ({
      name: c2.title,
      id: String(c2.id || c2.href),
      href: c2.href,
      platform: Platform.HUYA,
    })),
  ),
  ...douyinCategoriesData.flatMap((c1) =>
    (c1.subcategories || []).map((c2: any) => ({
      name: c2.title,
      id: String(c2.href),
      href: c2.href,
      platform: Platform.DOUYIN,
    })),
  ),
  ...biliCategoriesData.flatMap((c1) =>
    (c1.subcategories || []).map((c2: any) => ({
      name: c2.title,
      id: String(c2.id || c2.href),
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
  theme: "light" | "dark";
  searchQuery?: string;
  activePlatform: UiPlatform | "all";
}>();

const emit = defineEmits<{
  (event: "theme-toggle"): void;
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
const showColorPalette = ref(false);
// const isAlwaysOnTop = ref(false);

const themeStore = useThemeStore();
// const followStore = useFollowStore();
const playerStore = usePlayerStore();
const effectiveTheme = computed(() => themeStore.getEffectiveTheme());
const route = useRoute();
const router = useRouter();

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
  router.push({ name: "PlatformHome" });
};

// const toggleAlwaysOnTop = async () => {
//   try {
//     const win = getCurrentWindow();
//     const nextState = !isAlwaysOnTop.value;
//     await win.setAlwaysOnTop(nextState);
//     isAlwaysOnTop.value = nextState;
//   } catch (error) {
//     console.error("[Navbar] Failed to set always on top:", error);
//   }
// };

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
    (c) => c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
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
  // Navigation to platform home with category usually happens via router.
  // Currently PlatformHomeView manages its own selection based on platform change.
  // We can pass the category via query params or just rely on platform switch.
  // For now, let's navigate to the platform.
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
      const base = await invoke<string>("start_static_proxy_server");
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
    // Initialize Always On Top state
    // Note: isAlwaysOnTop() might not be available in all contexts or versions, check docs. 
    // Tauri v2 Window has isAlwaysOnTop(): Promise<boolean>??
    // Actually, looking at docs, it seems there is no direct getter for this property in some versions or it's named differently?
    // Let's assume there isn't a simple getter exposed in the generic Window interface without verifying. 
    // But wait, standard APIs usually have it. 
    // Let's wrap it in try-catch to be safe.
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

const toggleTheme = () => {
  emit("theme-toggle");
};

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
    const payloadData = { args: { room_id_str: userInputRoomId } };
    const douyinInfo = await invoke<DouyinApiStreamInfo>(
      "fetch_douyin_streamer_info",
      {
        payload: payloadData,
      },
    );
    if (douyinInfo?.anchor_name) {
      const isLive = douyinInfo.status === 2;
      const webId = (douyinInfo as any).web_rid ?? userInputRoomId;
      searchResults.value = [
        {
          platform: Platform.DOUYIN,
          roomId: webId,
          webId,
          userName: douyinInfo.anchor_name || "抖音主播",
          roomTitle: douyinInfo.title || null,
          avatar: douyinInfo.avatar || null,
          liveStatus: isLive,
          rawStatus: douyinInfo.status,
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
    const items = await invoke<HuyaAnchorItem[]>("search_huya_anchors", {
      keyword,
      page: 1,
    });
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
    const response = await invoke<string>("search_anchor", { keyword });
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
    const response = await invoke<BilibiliSearchItem[]>(
      "search_bilibili_rooms",
      {
        keyword,
        page: 1,
      },
    );
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
