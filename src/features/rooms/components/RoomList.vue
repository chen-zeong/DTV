<template>
  <div class="flex h-full w-full flex-col overflow-hidden">
    <div
      v-if="isLoading && rooms.length === 0"
      class="flex min-h-100 flex-1 flex-col items-center justify-center gap-3 p-6"
    >
      <LoadingDots />
    </div>
    <div
      v-else-if="!isLoading && rooms.length === 0 && hasCategory"
      class="flex min-h-100 flex-col items-center justify-center gap-3 p-6"
    >
      <p>分类下暂无主播</p>
    </div>
    <div
      v-else-if="!hasCategory && !isLoading"
      class="flex min-h-100 flex-col items-center justify-center gap-3 p-6"
    >
      <p>请选择一个分类开始浏览</p>
    </div>

    <div ref="scrollComponentRef" class="flex-1 [--card-radius:18px]">
      <div
        class="grid gap-x-4 gap-y-8 pb-3"
        :style="{
          gridTemplateColumns: `repeat(${itemsPerRow}, minmax(0, 1fr))`,
        }"
      >
        <div
          v-for="room in rooms"
          :key="room.room_id"
          class="relative will-change-transform"
          :class="isScrolling ? 'hover:translate-y-0' : ''"
          @click="goToPlayer(room.room_id)"
        >
          <div
            class="group z-9999 flex cursor-pointer flex-col overflow-hidden rounded-sm border-border-main duration-100 hover:-translate-y-2 hover:border-border-strong"
          >
            <div class="relative aspect-video w-full overflow-hidden">
              <div class="relative h-full w-full">
                <SmoothImage
                  :src="room.room_cover || ''"
                  :alt="room.title"
                  class="h-full w-full"
                />
                <div
                  class="pointer-events-none absolute inset-0 bg-black/5 group-hover:bg-transparent"
                ></div>
                <span
                  class="absolute top-2 right-2 flex items-center gap-1 rounded-full border border-border-main bg-surface-low/80 px-1.5 py-0.5 text-[10px] font-bold text-text-main shadow-sm backdrop-blur-sm"
                >
                  <svg
                    class="size-3 text-brand"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path
                      d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
                    />
                  </svg>
                  {{ room.viewer_count_str || "0" }}
                </span>
                <div class="absolute bottom-1 left-1.5 flex items-center gap-2">
                  <div class="relative shrink-0">
                    <SmoothImage
                      :src="room.avatar || ''"
                      :alt="room.nickname"
                      class="size-8 rounded-full border border-border-main object-cover shadow-sm"
                    />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <span
                        class="truncate text-[11px] font-medium text-text-muted hover:text-brand"
                      >
                        {{ room.nickname || "主播" }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <h3
              class="mb-0.5 truncate pt-2 pl-3 text-[13px] text-text-main"
              :title="room.title"
            >
              {{ room.title }}
            </h3>
          </div>
        </div>
      </div>

      <!-- Bottom Sentinel for Infinite Loading -->
      <div
        ref="loadMoreSentinel"
        class="flex h-10 w-full items-center justify-center py-4"
      >
        <div v-if="isLoadingMore || (isLoading && rooms.length > 0)">
          <LoadingDots />
        </div>
        <div
          v-else-if="!hasMore && rooms.length > 0"
          class="text-xs text-neutral-500"
        >
          已经到底啦
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useRouter } from "vue-router";
import { useResizeObserver, useIntersectionObserver } from "@vueuse/core";
import type { CategorySelectedEvent, Category1, Category2 } from "../../../types/models/category";
import { useHuyaLiveRooms } from "../composables/useHuyaLiveRooms.ts";
import { useDouyinLiveRooms } from "../composables/useDouyinLiveRooms.ts";
import { useBilibiliLiveRooms } from "../composables/useBilibiliLiveRooms.ts";
import { useDouyuLiveRooms } from "../composables/useDouyuLiveRooms.ts";
import SmoothImage from "../../../components/ui/SmoothImage.vue";
import LoadingDots from "../../../components/ui/LoadingDots.vue";

type DouyuCategorySelection = {
  type: "cate2" | "cate3";
  id: string;
  name?: string;
};

const props = defineProps<{
  selectedCategory?: CategorySelectedEvent | null;
  categoriesData?: Category1[];
  playerRouteName?: string;
  platformName?: "huya" | "douyin" | "douyu" | "bilibili" | string;
  defaultPageSize?: number;
  douyuCategory?: DouyuCategorySelection | null;
  isScrolling?: boolean; // Prop from parent
}>();

const router = useRouter();
const scrollComponentRef = ref<HTMLElement | null>(null);
const loadMoreSentinel = ref<HTMLElement | null>(null);
const containerWidth = ref(0);

// Infinite Loading Logic
useIntersectionObserver(
  loadMoreSentinel,
  ([{ isIntersecting }]) => {
    if (
      isIntersecting &&
      hasMore.value &&
      !isLoading.value &&
      !isLoadingMore.value
    ) {
      loadMoreRooms();
    }
  },
  { threshold: 0.1 },
);

const categoryHref = computed(() => props.selectedCategory?.cate2Href || null);
const platformName = computed(() => props.platformName ?? "huya");
const douyuCategoryId = computed(() => props.douyuCategory?.id || null);
const douyuCategoryType = computed(() => props.douyuCategory?.type || null);
const hasCategory = computed(() => {
  if (platformName.value === "douyu") return !!douyuCategoryId.value;
  return !!categoryHref.value;
});

const resolvedSubcategoryId = computed(() => {
  const href = props.selectedCategory?.cate2Href;
  const data = props.categoriesData;
  if (!href || !Array.isArray(data)) return null;
  for (const c1 of data) {
    if (!Array.isArray(c1.subcategories)) continue;
    const c2 = c1.subcategories.find((s: Category2) => s.href === href);
    if (c2 && ((c2 as any).id || (c2 as any).gid)) return String((c2 as any).id ?? (c2 as any).gid);
  }
  return null;
});

const douyinPartition = computed(() => {
  const href = props.selectedCategory?.cate2Href;
  if (!href) return null;
  const parts = href.split("_");
  return parts.length >= 1 ? parts[parts.length - 1] : null;
});
const douyinPartitionType = computed(() => {
  const href = props.selectedCategory?.cate2Href;
  if (!href) return null;
  const parts = href.split("_");
  return parts.length >= 2 ? parts[parts.length - 2] : null;
});

const resolvedParentCategoryId = computed(() => {
  const href = props.selectedCategory?.cate2Href;
  const data = props.categoriesData;
  if (!href || !Array.isArray(data)) return null;
  for (const c1 of data) {
    if (!Array.isArray(c1.subcategories)) continue;
    const c2 = c1.subcategories.find((s: Category2) => s.href === href);
    if (c2 && ((c2 as any).parent_id || (c2 as any).parentId || (c1 as any).id))
      return String((c2 as any).parent_id ?? (c2 as any).parentId ?? (c1 as any).id);
  }
  return null;
});

const huyaComposable = useHuyaLiveRooms(resolvedSubcategoryId, {
  defaultPageSize: props.defaultPageSize ?? 120,
});
const douyinComposable = useDouyinLiveRooms(
  douyinPartition,
  douyinPartitionType,
);
const bilibiliComposable = useBilibiliLiveRooms(
  resolvedSubcategoryId,
  resolvedParentCategoryId,
);
const douyuComposable = useDouyuLiveRooms(douyuCategoryType, douyuCategoryId);

const selectedComposable = computed(() => {
  if (platformName.value === "douyin") return douyinComposable;
  if (platformName.value === "bilibili") return bilibiliComposable;
  if (platformName.value === "douyu") return douyuComposable;
  return huyaComposable;
});

const rooms = computed(() => selectedComposable.value.rooms.value);
const isLoading = computed(() => selectedComposable.value.isLoading.value);
const isLoadingMore = computed(
  () => selectedComposable.value.isLoadingMore.value,
);
const hasMore = computed(() => selectedComposable.value.hasMore.value);
const loadInitialRooms = () => selectedComposable.value.loadInitialRooms();
const loadMoreRooms = () => selectedComposable.value.loadMoreRooms();

// let resizeRaf: number | null = null;
// let ensureTimer: number | null = null;
const minCardWidth = 180;
const gridGap = 18;

const scrollElement = computed<HTMLElement | null>(() => {
  const el = scrollComponentRef.value as any;
  return (el?.$el ?? el) as HTMLElement | null;
});

useResizeObserver(scrollElement, (entries) => {
  const entry = entries[0];
  if (entry) containerWidth.value = entry.contentRect.width;
});

const itemsPerRow = computed(() => {
  const width = containerWidth.value || minCardWidth;
  const calculated = Math.max(
    1,
    Math.floor((width + gridGap) / (minCardWidth + gridGap)),
  );
  return Math.min(calculated, 4);
});

const lastSelectionKey = ref<string | null>(null);

const getSelectionKey = (
  category: CategorySelectedEvent | null | undefined,
): string | null => {
  if (platformName.value === "douyu") {
    if (!douyuCategoryId.value || !douyuCategoryType.value)
      return `${platformName.value}:none`;
    return `${platformName.value}:${douyuCategoryType.value}:${douyuCategoryId.value}`;
  }
  if (!category?.cate2Href) return `${platformName.value}:none`;
  return `${platformName.value}:${category.cate2Href}`;
};

watch(
  [() => props.selectedCategory, () => props.douyuCategory, platformName],
  ([newCategory]) => {
    const nextKey = getSelectionKey(newCategory ?? null);
    const isSameSelection = nextKey === lastSelectionKey.value;
    lastSelectionKey.value = nextKey;

    if (isSameSelection && rooms.value.length > 0) {
      return;
    }

    if (platformName.value === "douyu") {
      if (douyuCategoryId.value) loadInitialRooms();
      else douyuComposable.rooms.value = [];
    } else if (newCategory?.cate2Href) {
      loadInitialRooms();
    } else {
      if (platformName.value === "douyin") douyinComposable.rooms.value = [];
      else if (platformName.value === "bilibili")
        bilibiliComposable.rooms.value = [];
      else huyaComposable.rooms.value = [];
    }
  },
  { immediate: true, deep: true },
);

const goToPlayer = (roomId: string) => {
  if (roomId && props.playerRouteName) {
    router.push({
      name: props.playerRouteName,
      params: {
        roomId,
        platform: platformName.value,
      },
    });
  }
};
</script>
