<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center justify-between gap-3 px-4 py-3">
      <h3
        class="flex items-center gap-2 text-base font-semibold"
        aria-label="关注列表"
      >
        <UsersRound class="h-4 w-4" aria-hidden="true" :stroke-width="1.9" />
      </h3>
      <div class="flex items-center gap-2">
        <button
          v-if="!isRefreshing"
          @click="refreshList"
          class="flex h-9 w-9 items-center justify-center rounded-[10px] border hover:-translate-y-0.5"
          title="刷新列表"
        >
          <span class="flex items-center justify-center">
            <svg
              v-if="!showCheckIcon"
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-5 w-5"
            >
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
            <svg
              v-else
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-[18px] w-[18px]"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </span>
        </button>
        <span
          v-if="isRefreshing"
          class="inline-flex h-[34px] items-center gap-1.5 rounded-[10px] border px-3"
          aria-live="polite"
        >
          <span
            class="h-[14px] w-[14px] animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          ></span>
          <span>{{ progressCurrent }}/{{ progressTotal }}</span>
        </span>
        <button
          class="flex h-9 w-9 items-center justify-center rounded-[10px] border hover:-translate-y-0.5"
          @click="createNewFolder"
          title="新建文件夹"
        >
          <span class="flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
              ></path>
              <line x1="12" y1="11" x2="12" y2="17"></line>
              <line x1="9" y1="14" x2="15" y2="14"></line>
            </svg>
          </span>
        </button>
        <button
          ref="expandBtnRef"
          @click="openOverlay"
          class="flex h-9 w-9 items-center justify-center rounded-[10px] border hover:-translate-y-0.5"
          title="展开关注列表"
        >
          <span class="flex items-center justify-center">
            <ListCollapse aria-hidden="true" :stroke-width="1.9" />
          </span>
        </button>
      </div>
    </div>

    <div
      class="relative flex-1 overflow-y-auto px-3 pb-3"
      ref="listRef"
      @scroll.passive="handleListScroll"
      @mouseleave="handleListMouseLeave"
    >
      <div
        class="pointer-events-none absolute top-0 left-0 h-8 w-full rounded-[12px] opacity-0"
      ></div>
      <div
        v-if="listItems.length === 0"
        class="flex flex-col items-center justify-center gap-3 py-10"
      >
        <div class="text-[var(--secondary-text)]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="feather feather-heart"
          >
            <path
              d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
            ></path>
          </svg>
        </div>
        <h3 class="text-base font-semibold">暂无关注主播</h3>
        <p class="text-sm">关注主播后，他们会出现在这里</p>
      </div>

      <ul
        v-else
        class="flex flex-col gap-2"
        :class="{
          'pointer-events-none': isDragging && draggedItemType === 'streamer',
        }"
      >
        <FollowListItem
          v-for="(item, index) in listItems"
          :key="item.type === 'folder' ? `folder_${item.data.id}` : `${item.data.platform}:${item.data.id}`"
          :item="item"
          :is-dragging="isDragging && draggedIndex === index"
          :is-drag-over="dragOverFolderId === (item.type === 'folder' ? item.data.id : null)"
          :can-accept-drop="draggedStreamerKey !== null"
          :global-dragging="isDragging"
          :followed-anchors="props.followedAnchors"
          :just-added-ids="justAddedIds"
          :proxy-base="proxyBase"
          :get-avatar-src="getAvatarSrc"
          :handle-img-error="handleImgError"
          :get-live-indicator-class="getLiveIndicatorClass"
          :get-streamer-item-class="getStreamerItemClass"
          @mousedown="handleMouseDown($event, index)"
          @mouseenter="handleItemMouseEnter($event, index)"
          @mouseleave="handleItemMouseLeave(index)"
          @select-anchor="(s) => emit('selectAnchor', s)"
          @toggle-folder-expand="handleToggleFolderExpand"
          @drag-start="handleFolderDragStart"
          @context-menu="handleFolderContextMenu"
          @drag-over="handleFolderDragOver"
          @drag-leave="handleFolderDragLeave"
          @drop="handleFolderDrop"
          @streamer-drag-start="handleFolderStreamerDragStart"
          @click="handleClick"
        />
      </ul>
    </div>

    <FolderContextMenu
      :show="contextMenu.show"
      :position="contextMenu.position"
      :folder-name="contextMenu.folderName"
      @close="contextMenu.show = false"
      @rename="handleFolderRename"
      @delete="handleFolderDelete"
    />

    <FollowOverlay
      :show="showOverlay"
      :items="filteredStreamers"
      :getAvatarSrc="getAvatarSrc"
      :handleImgError="handleImgError"
      :getLiveIndicatorClass="getLiveIndicatorClass"
      :proxyBase="proxyBase"
      :alignTop="overlayAlignTop"
      :alignLeft="overlayAlignLeft"
      :isRefreshing="isRefreshing"
      :is-delete-mode="overlayDeleteMode"
      @select="selectFromOverlay"
      @close="closeOverlay"
      @refresh="refreshList"
      @toggle-remove="toggleOverlayDeleteMode"
      @remove="handleOverlayRemove"
    >
      <template #filters>
        <FilterChips
          :visiblePlatforms="visiblePlatforms"
          :activeFilter="activeFilter"
          @update:activeFilter="setFilter"
        />
      </template>
    </FollowOverlay>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch, onUnmounted } from "vue";
import type { FollowedStreamer } from "../../../types/models/streamer";
import { Platform, type SupportedPlatform } from "../../../types/app/platform";

import { refreshDouyuFollowedStreamer } from "../../../services/platforms/douyu/followListHelper";
import { refreshDouyinFollowedStreamer } from "../../../services/platforms/douyin/followListHelper";
import { getLiveStreamV2 } from "../../../api/live";
import FollowOverlay from "./FollowOverlay.vue";
import FilterChips from "./FilterChips.vue";
import FolderContextMenu from "./FolderContextMenu.vue";
import FollowListItem from "./FollowListItem.vue";
import { useImageProxy } from "../composables/useProxy";
import { useFollowStore } from "../../../store/followStore";
import { ListCollapse, UsersRound } from "lucide-vue-next";
import { useStreamerDrag } from "../composables/useStreamerDrag";

const expandBtnRef = ref<HTMLButtonElement | null>(null);
const overlayAlignTop = ref<number>(64);
const overlayAlignLeft = ref<number>(240);

const followStore = useFollowStore();

const props = defineProps<{
  followedAnchors: FollowedStreamer[];
}>();

const emit = defineEmits<{
  (e: "selectAnchor", streamer: FollowedStreamer): void;
  (e: "unfollow", payload: { platform: Platform; id: string }): void;
  (e: "reorderList", newList: FollowedStreamer[]): void;
}>();

// 右键菜单状态
const contextMenu = ref({
  show: false,
  position: { x: 0, y: 0 },
  folderId: "",
  folderName: "",
});

const isRefreshing = ref(false);
const showCheckIcon = ref(false);
watch(isRefreshing, (newVal, oldVal) => {
  if (oldVal && !newVal) {
    showCheckIcon.value = true;
    setTimeout(() => showCheckIcon.value = false, 1000);
  }
});

const listRef = ref<HTMLElement | null>(null);
let hoveredItem: HTMLElement | null = null;
let hoverRaf: number | null = null;
let hoverAnimating = false;
let hoverCurrentY = 0;
let hoverCurrentH = 0;
let hoverTargetY = 0;
let hoverTargetH = 0;

const justAddedIds = ref<string[]>([]);
const animationTimeout = ref<number | null>(null);

// 使用拖拽组合式函数
const {
  isDragging,
  draggedIndex,
  draggedItemType,
  draggedStreamerKey,
  dragOverFolderId,
  handleMouseDown,
  handleFolderDragStart,
  handleFolderStreamerDragStart
} = useStreamerDrag(
  listRef,
  computed(() => followStore.displayList),
  followStore.updateListOrder,
  followStore.beginTransaction,
  followStore.commitTransaction,
  followStore.rollbackTransaction,
  followStore.moveStreamerToFolder,
  followStore.removeStreamerFromFolder,
  computed(() => followStore.folders)
);

const FOLLOW_REFRESH_CONCURRENCY = 2;
const REFRESH_INITIAL_DELAY_MS = 1500;
function requestIdle(fn: () => void, timeout = REFRESH_INITIAL_DELAY_MS) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(fn, { timeout });
  } else setTimeout(fn, timeout);
}

const {
  proxyBase,
  ensureProxyStarted,
  getAvatarSrc: proxyGetAvatarSrc,
} = useImageProxy();

function getAvatarSrc(s: FollowedStreamer): string {
  return proxyGetAvatarSrc(s.platform as unknown as string, s.avatarUrl);
}

function handleImgError(ev: Event, s: FollowedStreamer) {
  const target = ev.target as HTMLImageElement | null;
  if (!target) return;
  const base = proxyBase.value;
  const isProxied = !!base && target.src.startsWith(base);
  if (s.platform === Platform.BILIBILI) return;
  if (isProxied) target.src = s.avatarUrl || "";
}

const MIN_ANIMATION_DURATION = 1500;

type RefreshUpdateEntry = { originalKey: string; updated: FollowedStreamer };

const toStreamerKey = (streamer: Pick<FollowedStreamer, "platform" | "id">) =>
  `${String(streamer.platform).toUpperCase()}:${streamer.id}`;

const normalizeRawKey = (rawKey?: string | null) => {
  if (!rawKey) return "";
  const segments = String(rawKey).split(":");
  if (segments.length < 2) return "";
  const platformPart = segments.shift();
  const idPart = segments.join(":");
  if (!platformPart || !idPart) return "";
  return `${String(platformPart).toUpperCase()}:${idPart}`;
};

const isLiveStreamer = (streamer?: FollowedStreamer | null) => {
  if (!streamer) return false;
  if (streamer.liveStatus && streamer.liveStatus !== "UNKNOWN") {
    return streamer.liveStatus === "LIVE";
  }
  return !!streamer.isLive;
};

const getStatusBucket = (
  streamer?: FollowedStreamer | null,
): "LIVE" | "LOOPING" | "OFFLINE" => {
  if (!streamer) return "OFFLINE";
  if (isLiveStreamer(streamer)) return "LIVE";
  if (streamer.liveStatus === "REPLAY") return "LOOPING";
  return "OFFLINE";
};

function buildPostRefreshOrdering(updateEntries: RefreshUpdateEntry[]): {
  nextListOrder: { type: 'folder' | 'streamer', id: string }[];
  streamerSequence: FollowedStreamer[];
} | null {
  const baseOrderSource = followStore.listOrder;
  const folderStreamerKeys = new Set<string>();
  followStore.folders.forEach((folder) => {
    folder.streamerIds.forEach((id) => {
      const normalized = normalizeRawKey(id);
      if (normalized) folderStreamerKeys.add(normalized);
    });
  });

  const streamerDataMap = new Map<string, FollowedStreamer>();
  props.followedAnchors.forEach((streamer) => {
    streamerDataMap.set(toStreamerKey(streamer), streamer);
  });
  updateEntries.forEach((entry) => {
    const normalized = normalizeRawKey(entry.originalKey) || toStreamerKey(entry.updated);
    streamerDataMap.set(normalized, entry.updated);
  });

  const folderItems: { type: 'folder', id: string }[] = [];
  const liveItems: string[] = [];
  const loopingItems: string[] = [];
  const offlineItems: string[] = [];
  const seenFolderIds = new Set<string>();
  const seenStreamerKeys = new Set<string>();

  const pushFolder = (folderId: string) => {
    if (seenFolderIds.has(folderId)) return;
    folderItems.push({ type: "folder", id: folderId });
    seenFolderIds.add(folderId);
  };

  const pushStreamerByKey = (key: string) => {
    const normalizedKey = normalizeRawKey(key) || key;
    if (!normalizedKey || seenStreamerKeys.has(normalizedKey)) return;
    const streamer = streamerDataMap.get(normalizedKey);
    if (!streamer) return;
    const bucket = getStatusBucket(streamer);
    if (bucket === "LIVE") liveItems.push(normalizedKey);
    else if (bucket === "LOOPING") loopingItems.push(normalizedKey);
    else offlineItems.push(normalizedKey);
    seenStreamerKeys.add(normalizedKey);
  };

  baseOrderSource.forEach((item) => {
    if (item.type === "folder") pushFolder(item.id);
    else pushStreamerByKey(item.id);
  });

  streamerDataMap.forEach((_s, key) => pushStreamerByKey(key));

  const filterOutFoldered = (keys: string[]) =>
    keys.filter((key) => !folderStreamerKeys.has(key)).map(id => ({ type: 'streamer' as const, id }));

  const nextListOrder = [
    ...folderItems,
    ...filterOutFoldered(liveItems),
    ...filterOutFoldered(loopingItems),
    ...filterOutFoldered(offlineItems),
  ];

  const streamerSequence: FollowedStreamer[] = [
    ...liveItems,
    ...loopingItems,
    ...offlineItems,
  ].map((key) => streamerDataMap.get(key)!).filter(Boolean);

  return { nextListOrder, streamerSequence };
}

const streamers = computed(() => props.followedAnchors);
const listItems = computed(() => followStore.displayList);

const createNewFolder = () => {
  const name = `新文件夹 ${followStore.folders.length + 1}`;
  followStore.createFolder(name);
};

const animateHoverHighlight = () => {
  const listEl = listRef.value;
  if (!listEl) { hoverAnimating = false; return; }
  const dy = hoverTargetY - hoverCurrentY;
  const dh = hoverTargetH - hoverCurrentH;
  hoverCurrentY += dy * 0.18;
  hoverCurrentH += dh * 0.18;
  if (Math.abs(dy) < 0.4) hoverCurrentY = hoverTargetY;
  if (Math.abs(dh) < 0.4) hoverCurrentH = hoverTargetH;
  listEl.style.setProperty("--hover-y", `${hoverCurrentY}px`);
  listEl.style.setProperty("--hover-h", `${hoverCurrentH}px`);
  if (hoveredItem || Math.abs(dy) >= 0.4 || Math.abs(dh) >= 0.4) {
    hoverRaf = window.requestAnimationFrame(animateHoverHighlight);
    return;
  }
  hoverAnimating = false;
  hoverRaf = null;
};

const applyHoverHighlight = () => {
  const listEl = listRef.value;
  if (!listEl) return;
  if (!hoveredItem) {
    listEl.style.setProperty("--hover-opacity", "0");
    hoverTargetY = hoverCurrentY;
    hoverTargetH = hoverCurrentH;
    if (!hoverAnimating) { hoverAnimating = true; hoverRaf = window.requestAnimationFrame(animateHoverHighlight); }
    return;
  }
  const listRect = listEl.getBoundingClientRect();
  const itemRect = hoveredItem.getBoundingClientRect();
  const y = itemRect.top - listRect.top + listEl.scrollTop;
  const h = hoveredItem.offsetHeight;
  listEl.style.setProperty("--hover-opacity", "1");
  hoverTargetY = Math.max(0, y);
  hoverTargetH = Math.max(0, h);
  if (!hoverAnimating) { hoverAnimating = true; hoverRaf = window.requestAnimationFrame(animateHoverHighlight); }
};

const scheduleHoverHighlight = () => applyHoverHighlight();

const handleItemMouseEnter = (event: MouseEvent, index: number) => {
  const item = listItems.value[index];
  if (!item || item.type !== "streamer") { hoveredItem = null; scheduleHoverHighlight(); return; }
  hoveredItem = event.currentTarget as HTMLElement;
  scheduleHoverHighlight();
};

const handleItemMouseLeave = (_index: number) => { hoveredItem = null; scheduleHoverHighlight(); };
const handleListMouseLeave = () => { hoveredItem = null; scheduleHoverHighlight(); };
const handleListScroll = () => { if (hoveredItem) scheduleHoverHighlight(); };

const handleToggleFolderExpand = (folderId: string) => followStore.toggleFolderExpanded(folderId);

const handleFolderContextMenu = (folderId: string, event: MouseEvent) => {
  const folder = followStore.folders.find((f) => f.id === folderId);
  if (folder) {
    contextMenu.value = { show: true, position: { x: event.clientX, y: event.clientY }, folderId, folderName: folder.name };
  }
};

const handleFolderRename = (newName: string) => {
  if (!contextMenu.value.folderId) return;
  followStore.renameFolder(contextMenu.value.folderId, newName);
  contextMenu.value.show = false;
};

const handleFolderDelete = () => {
  followStore.deleteFolder(contextMenu.value.folderId);
  contextMenu.value.show = false;
};

const showOverlay = ref(false);
const overlayDeleteMode = ref(false);
type FilterType = "ALL" | Platform;
const activeFilter = ref<FilterType>("ALL");
const openOverlay = () => {
  const headerRect = document.querySelector(".app-header")?.getBoundingClientRect() as DOMRect | undefined;
  overlayAlignTop.value = headerRect ? Math.round(headerRect.bottom + 8) : 72;
  const rect = expandBtnRef.value?.getBoundingClientRect();
  overlayAlignLeft.value = rect ? Math.round(rect.right + 12) : 240;
  overlayDeleteMode.value = false;
  showOverlay.value = true;
};
const closeOverlay = () => { showOverlay.value = false; overlayDeleteMode.value = false; };
const toggleOverlayDeleteMode = () => overlayDeleteMode.value = !overlayDeleteMode.value;
const setFilter = (f: FilterType) => activeFilter.value = f;

const platformsOrder: Platform[] = [Platform.DOUYU, Platform.DOUYIN, Platform.HUYA, Platform.BILIBILI];
const visiblePlatforms = computed(() => {
  const present = new Set<Platform>();
  for (const s of streamers.value) if (s.platform !== undefined) present.add(s.platform);
  return platformsOrder.filter((p) => present.has(p));
});
const filteredStreamers = computed(() => {
  if (activeFilter.value === "ALL") return streamers.value;
  return streamers.value.filter((s) => s.platform === activeFilter.value);
});

const selectFromOverlay = (s: FollowedStreamer) => { if (overlayDeleteMode.value) return; emit("selectAnchor", s); closeOverlay(); };
const handleOverlayRemove = (s: FollowedStreamer) => emit("unfollow", { platform: s.platform, id: s.id });

const getStreamerItemClass = (streamer: FollowedStreamer) => ({
  "status-live": streamer.liveStatus === "LIVE",
  "status-replay": streamer.liveStatus === "REPLAY",
  "status-offline": streamer.liveStatus === "OFFLINE" || !streamer.liveStatus || streamer.liveStatus === "UNKNOWN",
});

const getLiveIndicatorClass = (streamer: FollowedStreamer) => {
  switch (streamer.liveStatus) {
    case "LIVE": return "is-live";
    case "REPLAY": return "is-replay";
    default: return "is-offline";
  }
};

watch(
  () => props.followedAnchors,
  (newVal, oldVal) => {
    if (!oldVal || oldVal.length === 0) return;
    const oldIds = oldVal.map((s) => s.id);
    const newStreamers = newVal.filter((s) => !oldIds.includes(s.id));
    if (newStreamers.length > 0) {
      newStreamers.forEach((s) => {
        justAddedIds.value.push(s.id);
        setTimeout(() => justAddedIds.value = justAddedIds.value.filter((id) => id !== s.id), 3000);
      });
    }
  },
  { deep: true },
);

const handleClick = (e: MouseEvent, streamer: FollowedStreamer) => {
  if (isDragging.value && draggedIndex.value !== -1) { e.preventDefault(); return; }
  emit("selectAnchor", streamer);
};

const handleFolderDragOver = (folderId: string) => {
  if (isDragging.value && draggedItemType.value === "streamer" && draggedStreamerKey.value) {
    const folder = followStore.folders.find((f) => f.id === folderId);
    if (folder) {
      const [rp, rid] = (draggedStreamerKey.value || "").split(":");
      const normKey = `${String(rp || "").toUpperCase()}:${rid}`;
      const exists = folder.streamerIds.some((id: string) => {
        const [p, i] = (id || "").split(":");
        return `${String(p || "").toUpperCase()}:${i}` === normKey;
      });
      if (!exists) dragOverFolderId.value = folderId;
    }
  }
};

const handleFolderDragLeave = () => dragOverFolderId.value = null;

const handleFolderDrop = (folderId: string) => {
  if (isDragging.value && draggedItemType.value === "streamer" && draggedStreamerKey.value) {
    followStore.moveStreamerToFolder(draggedStreamerKey.value, folderId);
    followStore.commitTransaction();
    dragOverFolderId.value = null;
  }
};

const clearAnimationTimeout = () => { if (animationTimeout.value !== null) { clearTimeout(animationTimeout.value); animationTimeout.value = null; } };
const progressCurrent = ref(0);
const progressTotal = ref(0);

async function runWithConcurrency<T>(items: T[], worker: (item: T, index: number) => Promise<void>, limit: number) {
  let cursor = 0;
  const runners: Promise<void>[] = [];
  const runner = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await worker(items[i], i);
      await new Promise((res) => setTimeout(res, 0));
    }
  };
  const n = Math.min(limit, items.length);
  for (let k = 0; k < n; k++) runners.push(runner());
  await Promise.all(runners);
}

const refreshList = async () => {

  if (isRefreshing.value) return;

  const startTime = Date.now();

  isRefreshing.value = true;

  progressCurrent.value = 0;

  

    // Smart Refresh: Calculate visible items to prioritize them

  

    if (listRef.value) {

  

      const listRect = listRef.value.getBoundingClientRect();

  

  

    const items = listRef.value.querySelectorAll('.list-item-wrapper');

    items.forEach((el) => {

      const rect = el.getBoundingClientRect();

      // Simple visibility check: overlaps with container's vertical range

      if (rect.bottom > listRect.top && rect.top < listRect.bottom) {

        // Try to find streamer ID from DOM attributes or context if possible

        // Since we don't have IDs on the wrapper easily accessible without adding them, 

        // let's rely on the store's order vs index if possible, OR

        // Add data-id to FollowListItem wrapper in template.

      }

    });

  }

  

  // Note: Since we didn't add data-id to the wrapper yet, let's just pass empty for now 

  // and I will add data-id in the next step to make this work.

  // Actually, I can update refreshAll to just take the list from store, 

  // but here I want to use the store's action.

  

  // Wait, I replaced refreshAll in store, but the local refreshList function here 

  // currently implements its own concurrency logic. I should delegate to the store 

  // or update the local logic to support priority.

  // The local logic is quite complex with progress tracking.

  // Let's UPDATE the local logic to use the new priority sort but keep the progress tracking here 

  // or move progress tracking to store?

  // Moving progress tracking to store is better but requires more changes.

  // Let's keep local logic but sort the items `props.followedAnchors` based on visibility.



  // 1. Get visible IDs

  const visibleKeys = new Set<string>();

  if (listRef.value) {

    const listRect = listRef.value.getBoundingClientRect();

    // We need to add data-key to FollowListItem to make this efficient

    const itemElements = listRef.value.querySelectorAll('[data-streamer-key]');

    itemElements.forEach((el) => {

      const rect = el.getBoundingClientRect();

      if (rect.bottom > listRect.top && rect.top < listRect.bottom) {

        const key = el.getAttribute('data-streamer-key');

        if (key) visibleKeys.add(key);

      }

    });

  }



  // 2. Sort anchors: visible first

  const sortedAnchors = [...props.followedAnchors].sort((a, b) => {

    const keyA = toStreamerKey(a);

    const keyB = toStreamerKey(b);

    const aVis = visibleKeys.has(keyA);

    const bVis = visibleKeys.has(keyB);

    if (aVis && !bVis) return -1;

    if (!aVis && bVis) return 1;

    return 0;

  });



  const totalFromStore = followStore.followedStreamers?.length ?? 0;

  progressTotal.value = totalFromStore > 0 ? totalFromStore : sortedAnchors.length;



  try {

    const hasBiliOrHuya = sortedAnchors.some((s) => s.platform === Platform.BILIBILI || s.platform === Platform.HUYA);

    if (hasBiliOrHuya) await ensureProxyStarted();



    const updates: { originalKey: string; updated: FollowedStreamer }[] = [];

    

    // Use sortedAnchors instead of props.followedAnchors

    await runWithConcurrency(sortedAnchors, async (streamer) => {

      let updatedData: Partial<FollowedStreamer> = { lastUpdateFailed: false, lastError: undefined };

      try {

        if (streamer.platform === Platform.DOUYU) updatedData = { ...updatedData, ...await refreshDouyuFollowedStreamer(streamer) };

        else if (streamer.platform === Platform.DOUYIN) updatedData = { ...updatedData, ...await refreshDouyinFollowedStreamer(streamer) };

        else if (streamer.platform === Platform.HUYA || streamer.platform === Platform.BILIBILI) {

          const resp = await getLiveStreamV2({ platform: streamer.platform.toLowerCase() as SupportedPlatform, room_id: streamer.id, mode: "meta" });

          const live = resp.status === "live";

          updatedData = {

            ...updatedData,

            liveStatus: live ? "LIVE" : "OFFLINE",

            isLive: live,

            nickname: resp.room?.anchor_name ?? streamer.nickname,

            roomTitle: resp.room?.title ?? streamer.roomTitle,

            avatarUrl: resp.room?.avatar ?? streamer.avatarUrl,

          };

        }

        updates.push({ originalKey: `${streamer.platform}:${streamer.id}`, updated: { ...streamer, ...updatedData } as FollowedStreamer });

      } catch (e: any) {

        updates.push({ 

          originalKey: `${streamer.platform}:${streamer.id}`, 

          updated: { 

            ...streamer, 

            lastUpdateFailed: true, 

            lastError: e.message || String(e) 

          } 

        });

      } finally {

        progressCurrent.value++;

      }

    }, FOLLOW_REFRESH_CONCURRENCY);



    const validUpdates = updates.filter((entry): entry is RefreshUpdateEntry => !!entry && !!entry.updated);

    

    // Batch update store to avoid reactivity storm

    // Note: buildPostRefreshOrdering logic might need to be adjusted if we want to preserve partial updates

    // But since we refreshed everyone (just sorted), we can update all.

    // However, we should also update the Store's map with new data.

    // The previous logic only updated listOrder. We need to update streamer details too.

    

    validUpdates.forEach(u => {

      followStore.updateStreamerDetails({ ...u.updated, platform: u.updated.platform, id: u.updated.id });

    });



    const result = buildPostRefreshOrdering(validUpdates);

    if (result) {

      followStore.updateListOrder(result.nextListOrder);

      if (JSON.stringify(result.streamerSequence) !== JSON.stringify(props.followedAnchors)) emit("reorderList", result.streamerSequence);

    }

  } finally {

    const elapsed = Date.now() - startTime;

    const finish = () => { isRefreshing.value = false; showCheckIcon.value = true; setTimeout(() => showCheckIcon.value = false, 1000); };

    if (elapsed < MIN_ANIMATION_DURATION) {

      clearAnimationTimeout();

      animationTimeout.value = window.setTimeout(finish, MIN_ANIMATION_DURATION - elapsed);

    } else finish();

  }

};



onMounted(async () => {
  if (!followStore.listOrder.length && props.followedAnchors.length > 0) followStore.initializeListOrder();
  if (props.followedAnchors.some(s => s.platform === Platform.BILIBILI)) await ensureProxyStarted();
  requestIdle(refreshList);
});

onUnmounted(() => {
  clearAnimationTimeout();
  if (hoverRaf !== null) { window.cancelAnimationFrame(hoverRaf); hoverRaf = null; }
});
</script>

<style src="./index.css" scoped></style>
