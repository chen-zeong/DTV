<template>
  <div
    class="flex h-full w-full gap-4 overflow-hidden bg-app-bg p-4 text-text-main"
  >
    <!-- Left Column: Navigation / Library -->
    <div
      class="scrollbar-none flex h-full min-h-0 flex-col gap-4 overflow-y-auto border-r border-border-main bg-surface-low/30 p-4 transition-[width,padding,opacity] duration-300 ease-in-out"
      :class="isLeftCollapsed ? 'w-16 items-center px-2' : 'w-72'"
    >
      <div
        class="flex w-full items-center justify-between px-2"
        :class="{ 'flex-col gap-4': isLeftCollapsed }"
      >
        <h2 v-if="!isLeftCollapsed" class="truncate text-lg font-bold">
          收藏列表
        </h2>
        <div
          class="flex items-center gap-1"
          :class="{ 'flex-col': isLeftCollapsed }"
        >
          <button
            v-if="!isLeftCollapsed"
            @click="showCollectionSearch = !showCollectionSearch"
            class="rounded-md p-1.5 text-text-muted hover:bg-surface-high hover:text-text-main"
            :class="{ 'bg-brand/10 text-brand': showCollectionSearch }"
          >
            <Search class="size-4" />
          </button>

          <button
            @click="isLeftCollapsed = !isLeftCollapsed"
            class="rounded-md p-1.5 text-text-muted hover:bg-surface-high hover:text-text-main"
            title="收起/展开"
          >
            <PanelLeft
              class="size-5 transition-transform duration-300"
              :class="{ 'rotate-180': isLeftCollapsed }"
            />
          </button>
        </div>
      </div>

      <template v-if="!isLeftCollapsed">
        <div class="flex flex-col gap-4 px-2">
          <div class="flex items-center justify-between">
            <div class="relative" ref="collectionSortPopoverRef">
              <button
                @click="showCollectionSortPopover = !showCollectionSortPopover"
                class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold text-text-muted hover:bg-surface-high hover:text-text-main"
                :class="{ 'text-brand': showCollectionSortPopover }"
              >
                {{ sortLabel }}
                <ChevronDown class="size-3" />
              </button>

              <!-- Sort & View Popover -->
              <div
                v-if="showCollectionSortPopover"
                class="absolute top-full left-0 z-50 mt-2 w-48 rounded-xl border border-border-strong bg-surface-low p-2 shadow-lg backdrop-blur-xl"
              >
                <div
                  class="mb-1 border-b border-border-main px-3 py-2 text-[10px] font-black tracking-widest text-text-muted uppercase"
                >
                  排序
                </div>
                <div class="mb-2 flex flex-col gap-0.5">
                  <button
                    @click="
                      collectionSortMode = 'recent_view';
                      showCollectionSortPopover = false;
                    "
                    class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium hover:bg-surface-high"
                    :class="
                      collectionSortMode === 'recent_view'
                        ? 'bg-brand/10 text-brand'
                        : 'text-text-dim'
                    "
                  >
                    <Clock class="size-3.5" /> 最近观看
                  </button>
                  <button
                    @click="
                      collectionSortMode = 'recent_follow';
                      showCollectionSortPopover = false;
                    "
                    class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium hover:bg-surface-high"
                    :class="
                      collectionSortMode === 'recent_follow'
                        ? 'bg-brand/10 text-brand'
                        : 'text-text-dim'
                    "
                  >
                    <Plus class="size-3.5" /> 最近关注
                  </button>
                  <button
                    @click="
                      collectionSortMode = 'alphabetical';
                      showCollectionSortPopover = false;
                    "
                    class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium hover:bg-surface-high"
                    :class="
                      collectionSortMode === 'alphabetical'
                        ? 'bg-brand/10 text-brand'
                        : 'text-text-dim'
                    "
                  >
                    <ArrowDownAZ class="size-3.5" /> 字母排序
                  </button>
                </div>

                <div
                  class="mb-1 border-b border-border-main px-3 py-2 text-[10px] font-black tracking-widest text-text-muted uppercase"
                >
                  视图
                </div>
                <div class="grid grid-cols-2 gap-1">
                  <button
                    @click="
                      collectionViewMode = 'current';
                      showCollectionSortPopover = false;
                    "
                    class="flex items-center justify-center rounded-lg p-2 hover:bg-surface-high"
                    :class="
                      collectionViewMode === 'current'
                        ? 'bg-brand/10 text-brand'
                        : 'text-text-muted'
                    "
                    title="默认视图"
                  >
                    <LayoutGrid class="size-4" />
                  </button>
                  <button
                    @click="
                      collectionViewMode = 'list';
                      showCollectionSortPopover = false;
                    "
                    class="flex items-center justify-center rounded-lg p-2 hover:bg-surface-high"
                    :class="
                      collectionViewMode === 'list'
                        ? 'bg-brand/10 text-brand'
                        : 'text-text-muted'
                    "
                    title="列表视图"
                  >
                    <List class="size-4" />
                  </button>
                  <button
                    @click="
                      collectionViewMode = 'card2';
                      showCollectionSortPopover = false;
                    "
                    class="flex items-center justify-center rounded-lg p-2 text-[10px] font-black hover:bg-surface-high"
                    :class="
                      collectionViewMode === 'card2'
                        ? 'bg-brand/10 text-brand'
                        : 'text-text-muted'
                    "
                    title="双列卡片"
                  >
                    2×2
                  </button>
                  <button
                    @click="
                      collectionViewMode = 'card3';
                      showCollectionSortPopover = false;
                    "
                    class="flex items-center justify-center rounded-lg p-2 text-[10px] font-black hover:bg-surface-high"
                    :class="
                      collectionViewMode === 'card3'
                        ? 'bg-brand/10 text-brand'
                        : 'text-text-muted'
                    "
                    title="三列卡片"
                  >
                    3×3
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div v-if="showCollectionSearch" class="relative">
            <input
              v-model="collectionSearchQuery"
              type="text"
              placeholder="搜索收藏..."
              class="w-full rounded-md border border-border-main bg-surface-mid px-3 py-1.5 text-xs outline-none focus:border-brand"
              autofocus
            />
          </div>
        </div>

        <!-- Collection List Area -->
        <div
          class="flex min-h-0 flex-col gap-1"
          :class="{
            'grid grid-cols-2 gap-2 px-2': collectionViewMode === 'card2',
            'grid grid-cols-3 gap-1 px-1': collectionViewMode === 'card3',
          }"
        >
          <div
            v-if="filteredSortedCollection.length === 0"
            class="flex flex-col items-center justify-center py-12 text-center"
          >
            <p class="text-xs text-text-muted">没有找到收藏主播</p>
          </div>

          <template v-else>
            <div
              v-for="value in filteredSortedCollection"
              :key="value.id"
              class="group flex cursor-pointer"
              :class="[
                collectionViewMode === 'current'
                  ? 'items-center gap-3 rounded-lg p-2 hover:bg-surface-high'
                  : '',
                collectionViewMode === 'list'
                  ? 'items-center gap-2 rounded p-1.5 hover:bg-surface-high'
                  : '',
                collectionViewMode === 'card2' || collectionViewMode === 'card3'
                  ? 'flex-col gap-2 rounded-xl border border-transparent bg-surface-mid/50 p-2 shadow-sm hover:border-brand/30 hover:bg-surface-high'
                  : '',
              ]"
              @click="handleSelectHistory(value)"
            >
              <div class="relative shrink-0">
                <SmoothImage
                  class="rounded-full border border-border-main shadow-sm"
                  :class="[
                    collectionViewMode === 'current' ? 'size-12' : '',
                    collectionViewMode === 'list' ? 'size-8' : '',
                    collectionViewMode === 'card2'
                      ? 'aspect-square size-full rounded-lg'
                      : '',
                    collectionViewMode === 'card3'
                      ? 'aspect-square size-full rounded-lg'
                      : '',
                  ]"
                  :src="value.avatarUrl || ''"
                  :alt="value.nickname"
                />
                <!-- Online Signal Dot -->
                <div
                  v-if="
                    value.liveStatus === 'LIVE' ||
                    value.isLive ||
                    value.liveStatus === 'REPLAY'
                  "
                  class="absolute right-0 bottom-0 size-3 rounded-full border-2 border-app-bg shadow-sm"
                  :class="
                    value.liveStatus === 'REPLAY'
                      ? 'bg-amber-500'
                      : 'bg-green-500'
                  "
                ></div>
              </div>

              <div
                class="flex min-w-0 flex-1 flex-col"
                :class="{
                  'items-center text-center':
                    collectionViewMode === 'card2' ||
                    collectionViewMode === 'card3',
                }"
              >
                <p
                  class="truncate text-sm font-semibold text-text-main transition-colors group-hover:text-brand"
                  :class="{
                    'text-xs':
                      collectionViewMode === 'list' ||
                      collectionViewMode === 'card3',
                  }"
                >
                  {{ value.nickname }}
                </p>
                <p
                  v-if="collectionViewMode !== 'list'"
                  class="truncate text-xs text-text-muted"
                  :class="{ 'text-[10px]': collectionViewMode === 'card3' }"
                >
                  {{ value.roomTitle || "正在直播" }}
                </p>
              </div>

              <!-- Delete Button -->
              <button
                @click.stop="
                  followStore.unfollowStreamer(value.platform, value.id)
                "
                class="ml-auto rounded-full p-1.5 text-text-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-500"
                :class="{
                  'absolute top-1 right-1 bg-surface-low/80 shadow-sm backdrop-blur-sm':
                    collectionViewMode === 'card2' ||
                    collectionViewMode === 'card3',
                  'ml-auto flex-shrink-0':
                    collectionViewMode === 'current' ||
                    collectionViewMode === 'list',
                }"
                title="取消关注"
              >
                <Trash2 class="size-3.5" />
              </button>
            </div>
          </template>
        </div>
      </template>
      <template v-else>
        <div class="mt-4 flex flex-col gap-4 opacity-100 transition-opacity">
          <div
            v-for="value in filteredSortedCollection.slice(0, 8)"
            :key="value.id"
            class="group relative size-10 cursor-pointer rounded-full border border-border-main shadow-sm hover:border-brand"
            @click="handleSelectHistory(value)"
          >
            <SmoothImage
              class="size-full overflow-hidden rounded-full"
              :src="value.avatarUrl || ''"
              :alt="value.nickname"
            />
            <!-- Online Signal Dot -->
            <div
              v-if="
                value.liveStatus === 'LIVE' ||
                value.isLive ||
                value.liveStatus === 'REPLAY'
              "
              class="absolute right-0 bottom-0 size-3 rounded-full border-2 border-app-bg shadow-sm"
              :class="
                value.liveStatus === 'REPLAY' ? 'bg-amber-500' : 'bg-green-500'
              "
            ></div>
            <!-- Delete overlay on hover -->
            <button
              @click.stop="
                followStore.unfollowStreamer(value.platform, value.id)
              "
              class="absolute inset-0 flex items-center justify-center rounded-full bg-red-500/80 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Trash2 class="size-4 text-white" />
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- Center Column: Main Feed -->
    <div
      ref="centerColumnRef"
      class="scrollbar-none bg-panel-gradient relative h-full min-h-0 flex-1 overflow-y-auto"
      @scroll="handleCenterScroll"
    >
      <!-- Spotify-like Sticky Header -->
      <div
        class="sticky top-0 z-20 transition-[padding,background-color,box-shadow] duration-300"
        :class="[
          isHeaderCollapsed
            ? 'border-b border-border-main bg-surface-low/95 py-3 shadow-md backdrop-blur-md dark:bg-neutral-900/95'
            : 'bg-transparent pt-12 pb-6',
        ]"
      >
        <div class="flex flex-col gap-6 px-8">
          <div
            class="flex items-end gap-4 transition-[opacity,transform,height,margin] duration-300"
            :class="{
              'pointer-events-none mb-0 h-0 -translate-y-4 opacity-0':
                isHeaderCollapsed,
              'opacity-100': !isHeaderCollapsed,
            }"
          >
            <h1
              class="truncate text-6xl font-black tracking-tighter text-text-main"
            >
              {{ currentCategoryName || "英雄联盟" }}
            </h1>
          </div>

          <div class="flex items-center justify-between gap-4">
            <!-- Dynamic Category Level 3 Shortcuts -->
            <div
              v-if="dynamicCate3List.length > 0"
              class="scrollbar-none flex gap-3 overflow-x-auto"
            >
              <button
                v-for="cate in dynamicCate3List"
                :key="cate.id"
                class="rounded-full border border-border-main px-4 py-1.5 text-sm font-bold whitespace-nowrap transition-all"
                :class="
                  currentSelectedCate3Id === cate.id
                    ? 'border-text-main bg-text-main text-app-bg'
                    : 'bg-surface-high/50 text-text-dim hover:bg-surface-high hover:text-text-main'
                "
                @click="handleCate3Select(cate)"
              >
                {{ cate.name }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Main Content Grid -->
      <div class="px-8 pb-12 transition-all duration-300">
        <div v-if="isDouyu" class="min-h-0">
          <div v-if="selectedCategoryInfo" class="min-h-0">
            <CommonStreamerList
              :douyu-category="selectedCategoryInfo"
              platformName="douyu"
              playerRouteName="UniversalPlayer"
              :key="
                selectedCategoryInfo.type +
                '-' +
                selectedCategoryInfo.id +
                (selectedCategoryInfo.type === 'cate3'
                  ? '-' + selectedCategoryInfo.id
                  : '')
              "
              :is-scrolling="isScrolling"
            />
          </div>
          <div
            v-else-if="isCategoryLoading"
            class="flex h-96 items-center justify-center"
          >
            <LoadingDots />
          </div>
        </div>
        <div v-else class="min-h-0">
          <CommonStreamerList
            :selectedCategory="selectedCategory"
            :categoriesData="categoriesData"
            :default-page-size="platformConfig.defaultPageSize"
            :platformName="activePlatform"
            :playerRouteName="platformConfig.playerRouteName"
            :is-scrolling="isScrolling"
          />
        </div>
      </div>
    </div>

    <!-- Right Column: Info / Actions -->
    <div
      class="scrollbar-none flex h-full min-h-0 flex-col gap-8 overflow-y-auto border-l border-border-main bg-surface-low/30 p-6 transition-[width,padding,opacity] duration-300 ease-in-out"
      :class="isRightCollapsed ? 'w-16 items-center px-2' : 'w-72'"
    >
      <div
        class="flex w-full items-center justify-between"
        :class="{ 'flex-col gap-4': isRightCollapsed }"
      >
        <p
          v-if="!isRightCollapsed"
          class="truncate text-xs font-black tracking-widest text-text-muted uppercase"
        >
          控制面板
        </p>
        <button
          @click="isRightCollapsed = !isRightCollapsed"
          class="rounded-md p-1.5 text-text-muted hover:bg-surface-high hover:text-text-main"
          title="收起/展开"
        >
          <PanelRight
            class="size-5 transition-transform duration-300"
            :class="{ 'rotate-180': isRightCollapsed }"
          />
        </button>
      </div>

      <template v-if="!isRightCollapsed">
        <div class="flex flex-col gap-4">
          <p
            class="text-xs font-black tracking-widest text-text-muted uppercase"
          >
            选择平台
          </p>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="plt in platforms"
              :key="plt.id"
              class="flex items-center gap-2 rounded-lg border border-border-main px-3 py-2 text-sm font-bold shadow-sm transition-all"
              :class="
                plt.id === activePlatform
                  ? 'border-brand bg-brand text-white shadow-brand/20'
                  : 'bg-surface-mid text-text-dim hover:border-border-strong hover:bg-surface-high'
              "
              @click="handlePlatformChange(plt.id)"
            >
              <img
                :src="plt.icon"
                :alt="plt.name"
                class="size-5 rounded-md object-contain"
              />
              <span class="truncate">{{ plt.name }}</span>
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-4">
          <p
            class="text-xs font-black tracking-widest text-text-muted uppercase"
          >
            快速分类
          </p>

          <!-- Sidebar Main Categories -->
          <div class="mb-2 flex flex-wrap gap-2">
            <button
              v-for="cate1 in sidebarCate1List"
              :key="cate1.id"
              class="rounded-md border px-3 py-1.5 text-xs font-bold shadow-sm transition-all"
              :class="
                sidebarSelectedCate1Id === cate1.id
                  ? 'border-text-main bg-text-main text-app-bg'
                  : 'border-border-main bg-surface-mid text-text-dim hover:border-border-strong'
              "
              @click="sidebarSelectedCate1Id = cate1.id"
            >
              {{ cate1.title }}
            </button>
          </div>

          <!-- Sidebar Sub Categories -->
          <div
            v-if="sidebarCate2List.length > 0"
            class="flex flex-wrap gap-2 border-t border-border-main pt-4"
          >
            <button
              v-for="cate2 in sidebarCate2List"
              :key="cate2.id"
              class="rounded-md border px-3 py-1.5 text-[11px] font-medium shadow-sm transition-all"
              :class="
                currentSelectedId === cate2.id
                  ? 'border-brand/30 bg-brand/10 text-brand'
                  : 'border-border-main bg-surface-low text-text-muted hover:border-border-strong hover:text-text-main'
              "
              @click="handleCategorySelect(cate2)"
            >
              {{ cate2.title }}
            </button>
          </div>
        </div>
      </template>
      <template v-else>
        <div class="mt-4 flex flex-col gap-4 opacity-100 transition-opacity">
          <div
            v-for="plt in platforms"
            :key="plt.id"
            class="flex size-10 cursor-pointer items-center justify-center rounded-lg border border-border-main p-2 shadow-sm hover:bg-surface-high"
            :class="{
              'border-brand/30 bg-brand/10': plt.id === activePlatform,
            }"
            @click="handlePlatformChange(plt.id)"
          >
            <img
              :src="plt.icon"
              :alt="plt.name"
              class="size-6 object-contain"
            />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Search,
  ChevronDown,
  LayoutGrid,
  List,
  ArrowDownAZ,
  Clock,
  Plus,
  PanelLeft,
  PanelRight,
  Trash2,
} from "lucide-vue-next";
import { onClickOutside, useWindowSize } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { useFollowStore } from "../stores/followStore";
import CommonStreamerList from "../components/CommonStreamerList/index.vue";
import SmoothImage from "../components/Common/SmoothImage.vue";
import LoadingDots from "../components/Common/LoadingDots.vue";
import { douyinCategoriesData } from "../platforms/douyin/douyinCategoriesData";
import { huyaCategoriesData } from "../platforms/huya/huyaCategoriesData";
import { biliCategoriesData } from "../platforms/bilibili/biliCategoriesData";
import { useCategories } from "../platforms/douyu/composables/useCategories";
import type { CategorySelectedEvent as CommonCategorySelectedEvent } from "../platforms/common/categoryTypes";
import {
  type UiPlatform,
  type FollowedStreamer,
} from "../platforms/common/types";

// Import platform icons
import bilibiliIcon from "../assets/bilibili.webp";
import douyinIcon from "../assets/douyin.webp";
import douyuIcon from "../assets/douyu.webp";
import huyaIcon from "../assets/huya.webp";

defineOptions({
  name: "PlatformHomeView",
});

const router = useRouter();
const route = useRoute();
const followStore = useFollowStore();
const { followedStreamers } = storeToRefs(followStore);

// Collection List State
const { width: windowWidth } = useWindowSize();
const isLeftCollapsed = ref(false);
const isRightCollapsed = ref(false);

watch(
  windowWidth,
  (newWidth) => {
    if (newWidth < 1024) {
      isLeftCollapsed.value = true;
    } else if (newWidth > 1200) {
      isLeftCollapsed.value = false;
    }
  },
  { immediate: true },
);

const collectionSearchQuery = ref("");
const showCollectionSearch = ref(false);
const collectionSortMode = ref<
  "recent_view" | "recent_follow" | "alphabetical"
>("recent_view");
const collectionViewMode = ref<"list" | "card2" | "card3" | "current">(
  "current",
);
const showCollectionSortPopover = ref(false);
const collectionSortPopoverRef = ref<HTMLElement | null>(null);

onClickOutside(collectionSortPopoverRef, () => {
  showCollectionSortPopover.value = false;
});

const filteredSortedCollection = computed(() => {
  let list = [...followedStreamers.value];

  // Filter
  if (collectionSearchQuery.value.trim()) {
    const q = collectionSearchQuery.value.toLowerCase();
    list = list.filter(
      (s) =>
        s.nickname.toLowerCase().includes(q) ||
        (s.roomTitle && s.roomTitle.toLowerCase().includes(q)),
    );
  }

  // Sort
  list.sort((a, b) => {
    if (collectionSortMode.value === "recent_view") {
      return (b.lastViewedAt || 0) - (a.lastViewedAt || 0);
    }
    if (collectionSortMode.value === "recent_follow") {
      return (b.followedAt || 0) - (a.followedAt || 0);
    }
    if (collectionSortMode.value === "alphabetical") {
      return a.nickname.localeCompare(b.nickname);
    }
    return 0;
  });

  return list;
});

const sortLabel = computed(() => {
  if (collectionSortMode.value === "recent_view") return "最近观看";
  if (collectionSortMode.value === "recent_follow") return "最近关注";
  if (collectionSortMode.value === "alphabetical") return "字母排序";
  return "排序方式";
});

// Layout State
const centerColumnRef = ref<HTMLElement | null>(null);
const isHeaderCollapsed = ref(false);
const isScrolling = ref(false);
let scrollTimer: number | null = null;

const sidebarSelectedCate1Id = ref<string | null>(null);

const handleCenterScroll = (e: Event) => {
  const target = e.target as HTMLElement;
  isHeaderCollapsed.value = target.scrollTop > 80;

  isScrolling.value = true;
  if (scrollTimer) clearTimeout(scrollTimer);
  scrollTimer = window.setTimeout(() => {
    isScrolling.value = false;
  }, 150);
};

const handleSelectHistory = (streamer: FollowedStreamer) => {
  followStore.updateLastViewed(streamer.platform, streamer.id);
  router.push({
    name: "UniversalPlayer",
    params: {
      platform: streamer.platform.toLowerCase(),
      roomId: streamer.id,
    },
  });
};

// Data Mapping
const platforms: { id: UiPlatform; name: string; icon: string }[] = [
  { id: "douyu", name: "斗鱼", icon: douyuIcon },
  { id: "huya", name: "虎牙", icon: huyaIcon },
  { id: "douyin", name: "抖音", icon: douyinIcon },
  { id: "bilibili", name: "Bilibili", icon: bilibiliIcon },
];

interface SelectedCategoryInfo {
  type: "cate2" | "cate3";
  id: string;
  name?: string;
}

interface CategoryItem {
  id: string;
  title: string;
}

interface CategoryGroup {
  id: string;
  title: string;
  items: CategoryItem[];
}

const platformConfigMap: Record<
  UiPlatform,
  { playerRouteName: string; defaultPageSize?: number }
> = {
  douyu: { playerRouteName: "UniversalPlayer" },
  douyin: { playerRouteName: "UniversalPlayer" },
  huya: { playerRouteName: "UniversalPlayer", defaultPageSize: 120 },
  bilibili: { playerRouteName: "UniversalPlayer" },
};

const activePlatform = computed<UiPlatform>(
  () => (route.params.platform as UiPlatform) || "douyu",
);
const platformConfig = computed(() => platformConfigMap[activePlatform.value]);
const isDouyu = computed(() => activePlatform.value === "douyu");

const categoriesData = computed(() => {
  if (activePlatform.value === "douyin") return douyinCategoriesData;
  if (activePlatform.value === "huya") return huyaCategoriesData;
  if (activePlatform.value === "bilibili") return biliCategoriesData;
  return [];
});

// Douyu Data Logic
const douyuSelectedC1 = ref<number | null>(null);
const douyuSelectedC2 = ref<number | null>(null);
const {
  cate1List: douyuCate1List,
  cate2List: douyuCate2List,
  fetchCategories: fetchDouyuCategories,
  currentCate3List,
  fetchThreeCate,
} = useCategories(douyuSelectedC1, douyuSelectedC2);
const isDouyuLoading = ref(false);

// Shared Selection State
const selectedCategory = ref<CommonCategorySelectedEvent | null>(null);
const selectedCategoryInfo = ref<SelectedCategoryInfo | null>(null);

const isCategoryLoading = computed(() =>
  isDouyu.value ? isDouyuLoading.value : false,
);

const currentSelectedId = computed(() => {
  if (isDouyu.value) {
    return selectedCategoryInfo.value?.id ?? null;
  } else {
    return selectedCategory.value?.cate2Href ?? null;
  }
});

const currentSelectedCate3Id = computed(() => {
  if (isDouyu.value && selectedCategoryInfo.value?.type === "cate3") {
    return selectedCategoryInfo.value.id;
  }
  // Default to "all" if we are in a C2 that has subcategories
  if (
    isDouyu.value &&
    selectedCategoryInfo.value?.type === "cate2" &&
    currentCate3List.value.length > 0
  ) {
    return "all";
  }
  return null;
});

const dynamicCate3List = computed(() => {
  if (isDouyu.value && currentCate3List.value.length > 0) {
    return [{ id: "all", name: "全部" }, ...currentCate3List.value];
  }
  return [];
});

// Transform data for Sidebar/General Use
const categoryGroups = computed<CategoryGroup[]>(() => {
  if (isDouyu.value) {
    return douyuCate1List.value.map((c1) => ({
      id: String(c1.cate1Id),
      title: c1.cate1Name,
      items: douyuCate2List.value
        .filter((c2) => c2.cate1Id === c1.cate1Id)
        .map((c2) => ({
          id: c2.shortName, // Use shortName for Douyu ID
          title: c2.cate2Name,
        })),
    }));
  } else {
    // Common Platforms
    return categoriesData.value.map((c1) => ({
      id: c1.href,
      title: c1.title,
      items: c1.subcategories.map((c2:any) => ({
        id: c2.href,
        title: c2.title,
      })),
    }));
  }
});

// Sidebar Navigation Logic
const sidebarCate1List = computed(() => {
  return categoryGroups.value.map((g) => ({ id: g.id, title: g.title }));
});

const sidebarCate2List = computed(() => {
  if (!sidebarSelectedCate1Id.value) return [];
  const group = categoryGroups.value.find(
    (g) => g.id === sidebarSelectedCate1Id.value,
  );
  return group ? group.items : [];
});

const currentCategoryName = computed(() => {
  if (isDouyu.value) return selectedCategoryInfo.value?.name;
  return selectedCategory.value?.cate2Name;
});

const handleCate3Select = (cate: { id: string; name: string }) => {
  if (isDouyu.value) {
    if (cate.id === "all") {
      // Find the C2 that owns this C3 list
      const parentC2 = douyuCate2List.value.find(
        (c) => c.cate2Id === douyuSelectedC2.value,
      );
      if (parentC2) {
        selectedCategoryInfo.value = {
          type: "cate2",
          id: parentC2.shortName,
          name: parentC2.cate2Name,
        };
      }
      return;
    }

    selectedCategoryInfo.value = {
      type: "cate3",
      id: cate.id,
      name: cate.name,
    };
  }
};

const handlePlatformChange = (platform: UiPlatform) => {
  if (platform === activePlatform.value) return;
  router.push({ name: "PlatformHome", params: { platform } });
};

const handleCategorySelect = (item: CategoryItem) => {
  if (isDouyu.value) {
    // Find the original C2 object to get its numeric ID for fetching C3
    const match = douyuCate2List.value.find((c) => c.shortName === item.id);
    if (match) {
      douyuSelectedC2.value = match.cate2Id;
      fetchThreeCate(match.cate2Id);
    }

    selectedCategoryInfo.value = {
      type: "cate2",
      id: item.id,
      name: item.title,
    };
  } else {
    // Find parent group for Common
    const group = categoryGroups.value.find((g) =>
      g.items.some((i) => i.id === item.id),
    );
    if (group) {
      selectedCategory.value = {
        type: "cate2",
        cate1Href: group.id,
        cate2Href: item.id,
        cate1Name: group.title,
        cate2Name: item.title,
      };
    }
  }
};

// Initial Data Fetch & Default Selection
const initDouyuData = async () => {
  if (douyuCate1List.value.length > 0) return; // Already loaded

  isDouyuLoading.value = true;
  try {
    await fetchDouyuCategories();

    // Default selection for Douyu
    if (douyuCate2List.value.length > 0 && !selectedCategoryInfo.value) {
      // Logic to find first valid C2 (e.g. from first C1)
      const firstC1 = douyuCate1List.value[0];
      if (firstC1) {
        const firstC2 = douyuCate2List.value.find(
          (c2) => c2.cate1Id === firstC1.cate1Id,
        );
        if (firstC2) {
          selectedCategoryInfo.value = {
            type: "cate2",
            id: firstC2.shortName,
            name: firstC2.cate2Name,
          };
        }
      }
    }
  } catch (e) {
    console.error("Failed to load Douyu categories", e);
  } finally {
    isDouyuLoading.value = false;
  }
};

const initCommonData = () => {
  // Default selection for Common
  if (categoriesData.value.length > 0 && !selectedCategory.value) {
    const firstC1 = categoriesData.value[0];
    if (firstC1 && firstC1.subcategories.length > 0) {
      const firstC2 = firstC1.subcategories[0];
      selectedCategory.value = {
        type: "cate2",
        cate1Href: firstC1.href,
        cate2Href: firstC2.href,
        cate1Name: firstC1.title,
        cate2Name: firstC2.title,
      };
    }
  }
};

watch(
  activePlatform,
  (newPlatform) => {
    selectedCategory.value = null;
    selectedCategoryInfo.value = null;
    sidebarSelectedCate1Id.value = null;

    if (newPlatform === "douyu") {
      initDouyuData();
    } else {
      initCommonData();
    }
  },
  { immediate: true },
);

watch(
  categoryGroups,
  (newGroups) => {
    if (newGroups.length > 0) {
      if (!sidebarSelectedCate1Id.value) {
        sidebarSelectedCate1Id.value = newGroups[0].id;
      }

      // Auto-select first category if nothing is selected
      if (!currentSelectedId.value) {
        const firstGroup = newGroups[0];
        if (firstGroup.items.length > 0) {
          handleCategorySelect(firstGroup.items[0]);
        }
      }
    }
  },
  { immediate: true },
);

watch(categoriesData, () => {
  if (!isDouyu.value) {
    initCommonData();
  }
});

onMounted(() => {
  if (isDouyu.value) {
    initDouyuData();
  } else {
    initCommonData();
  }

  // Refresh follow list statuses
  setTimeout(() => {
    followStore.refreshAll();
  }, 1000);
});
</script>
