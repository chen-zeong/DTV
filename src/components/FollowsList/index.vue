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
            <!-- 刷新按钮保留默认图标/完成勾号，刷新完成后展示 1 秒 -->
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
        <!-- 刷新转圈与进度文本合并为一个元素，转圈在左，进度在右；共享统一的圆角矩形背景 -->
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
        <!-- 新建文件夹 -->
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
        <!-- 展开悬浮关注列表按钮 -->
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
        <li
          v-for="(item, index) in listItems"
          :key="
            item.type === 'folder'
              ? `folder_${item.data.id}`
              : `${item.data.platform}:${item.data.id}`
          "
          class="list-item-wrapper"
          :class="{
            'is-dragging': isDragging && draggedIndex === index,
            'is-folder': item.type === 'folder',
            'is-streamer': item.type === 'streamer',
          }"
          @mousedown="handleMouseDown($event, index)"
          @mouseenter="handleItemMouseEnter($event, index)"
          @mouseleave="handleItemMouseLeave(index)"
        >
          <!-- 文件夹项 -->
          <FolderItem
            v-if="item.type === 'folder'"
            :folder="item.data"
            :all-streamers="props.followedAnchors"
            :get-avatar-src="getAvatarSrc"
            :handle-img-error="handleImgError"
            :get-live-indicator-class="getLiveIndicatorClass"
            :proxy-base="proxyBase"
            :is-dragging="isDragging && draggedIndex === index"
            :is-drag-over="dragOverFolderId === item.data.id"
            :can-accept-drop="draggedStreamerKey !== null"
            :global-dragging="isDragging"
            @select-anchor="(s) => emit('selectAnchor', s)"
            @toggle-expand="handleToggleFolderExpand"
            @drag-start="(id, e) => handleFolderDragStart(id, index, e)"
            @context-menu="(id, e) => handleFolderContextMenu(id, e)"
            @drag-over="handleFolderDragOver"
            @drag-leave="handleFolderDragLeave"
            @drop="handleFolderDrop"
            @streamer-drag-start="handleFolderStreamerDragStart"
          />

          <!-- 主播项 -->
          <div
            v-else
            class="rounded-[var(--radius-sm)] bg-transparent"
            :class="[
              getStreamerItemClass(item.data),
              {
                'just-added': justAddedIds.includes(item.data.id),
              },
            ]"
            @click="handleClick($event, item.data)"
          >
            <StreamerItem
              :streamer="item.data"
              :getAvatarSrc="getAvatarSrc"
              :handleImgError="handleImgError"
              :getLiveIndicatorClass="getLiveIndicatorClass"
              :proxyBase="proxyBase"
              @clickItem="(s) => emit('selectAnchor', s)"
            />
          </div>
        </li>
      </ul>
    </div>

    <!-- 文件夹右键菜单 -->
    <FolderContextMenu
      :show="contextMenu.show"
      :position="contextMenu.position"
      :folder-name="contextMenu.folderName"
      @close="contextMenu.show = false"
      @rename="handleFolderRename"
      @delete="handleFolderDelete"
    />

    <!-- 悬浮关注列表：使用组件 FollowOverlay -->
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
import type {
  FollowedStreamer,
  LiveStatus,
} from "../../platforms/common/types";
import { Platform } from "../../platforms/common/types";
// import type { DouyuRoomInfo } from '../../platforms/douyu/types'; // No longer needed here
// import type { DouyinRoomInfo } from './types'; // No longer defined here

import { refreshDouyuFollowedStreamer } from "../../platforms/douyu/followListHelper";
import { refreshDouyinFollowedStreamer } from "../../platforms/douyin/followListHelper";
import { invoke } from "@tauri-apps/api/core";
import StreamerItem from "./StreamerItem.vue";
import FollowOverlay from "./FollowOverlay.vue";
import FilterChips from "./FilterChips.vue";
import FolderItem from "./FolderItem.vue";
import FolderContextMenu from "./FolderContextMenu.vue";
import { useImageProxy } from "./useProxy";
import { useFollowStore, type FollowListItem } from "../../stores/followStore";
import { ListCollapse, UsersRound } from "lucide-vue-next";

const expandBtnRef = ref<HTMLButtonElement | null>(null);
const overlayAlignTop = ref<number>(64);
const overlayAlignLeft = ref<number>(240);

const followStore = useFollowStore();

// Updated DouyinRoomInfo to match the Rust struct DouyinFollowListRoomInfo
// interface DouyinRoomInfo { // This will be the type for `data` from invoke

const props = defineProps<{
  followedAnchors: FollowedStreamer[];
}>();

const emit = defineEmits<{
  (e: "selectAnchor", streamer: FollowedStreamer): void;
  (e: "unfollow", payload: { platform: Platform; id: string }): void; // Ensure Platform type is used here if not already
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
// 新增：刷新完成后显示打勾图标 1 秒
const showCheckIcon = ref(false);
watch(isRefreshing, (newVal, oldVal) => {
  if (oldVal && !newVal) {
    showCheckIcon.value = true;
    setTimeout(() => {
      showCheckIcon.value = false;
    }, 1000);
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
const isDragging = ref(false);
const draggedIndex = ref(-1);
const startY = ref(0);
const currentY = ref(0);
const startX = ref(0);
const pendingDragIndex = ref(-1);
const pendingDragType = ref<"streamer" | null>(null);
const dragStartPoint = ref<{ x: number; y: number } | null>(null);
const dragPrepTimer = ref<number | null>(null);
const justAddedIds = ref<string[]>([]);
const draggedFromFolder = ref(false);
const sourceFolderId = ref<string | null>(null);
const dragSessionId = ref(0);
const animationTimeout = ref<number | null>(null);
const DRAG_MIN_PX = 6; // 小于该阈值视为点击/误触，取消拖拽
const LONG_PRESS_MS = 220;
const FOLDER_HOVER_PADDING = 10;

// 拖拽到文件夹相关状态
const dragOverFolderId = ref<string | null>(null); // 当前悬停的文件夹ID
const draggedStreamerKey = ref<string | null>(null); // 正在拖拽的主播键值

// 并发与延迟设置：降低启动时对后端的压力，优先让分类/主播列表完成首屏加载
const FOLLOW_REFRESH_CONCURRENCY = 2; // 关注刷新单独小池，避免争抢首屏资源
const REFRESH_INITIAL_DELAY_MS = 1500; // 首次进入页面延迟触发关注列表刷新
function requestIdle(fn: () => void, timeout = REFRESH_INITIAL_DELAY_MS) {
  // 在浏览器空闲或设定超时后再触发，避免与首页的分类/主播列表争抢网络与后端资源
  if (typeof (window as any).requestIdleCallback === "function") {
    (window as any).requestIdleCallback(fn, { timeout });
  } else {
    setTimeout(fn, timeout);
  }
}

// 头像代理：使用可复用的组合式函数
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
  // 如果是代理后的 B 站图片加载失败，不再回退到原始地址（避免 403 报错）
  if (s.platform === Platform.BILIBILI) {
    // 可选择在此设置占位图，当前保持不变以显示 fallback 文本
    return;
  }
  if (isProxied) {
    target.src = s.avatarUrl || "";
  }
}
const MIN_ANIMATION_DURATION = 1500;

type RefreshUpdateEntry = { originalKey: string; updated: FollowedStreamer };

const streamerKey = (platform: Platform | string, id: string) =>
  `${String(platform).toUpperCase()}:${id}`;
const toStreamerKey = (streamer: Pick<FollowedStreamer, "platform" | "id">) =>
  streamerKey(streamer.platform, streamer.id);
const normalizeRawKey = (rawKey?: string | null) => {
  if (!rawKey) return "";
  const segments = String(rawKey).split(":");
  if (segments.length < 2) return "";
  const platformPart = segments.shift();
  const idPart = segments.join(":");
  if (!platformPart || !idPart) return "";
  return streamerKey(platformPart, idPart);
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
  if (isLiveStreamer(streamer)) {
    return "LIVE";
  }
  if (streamer.liveStatus === "REPLAY") {
    return "LOOPING";
  }
  return "OFFLINE";
};

type FolderListItem = Extract<FollowListItem, { type: "folder" }>;
type StreamerListItem = Extract<FollowListItem, { type: "streamer" }>;

function buildPostRefreshOrdering(updateEntries: RefreshUpdateEntry[]): {
  nextListOrder: FollowListItem[];
  streamerSequence: FollowedStreamer[];
} | null {
  const baseOrderSource: FollowListItem[] = followStore.listOrder.length
    ? [...followStore.listOrder]
    : [
        ...followStore.folders.map((folder) => ({
          type: "folder" as const,
          data: folder,
        })),
        ...props.followedAnchors.map((streamer) => ({
          type: "streamer" as const,
          data: streamer,
        })),
      ];
  const folderStreamerKeys = new Set<string>();
  followStore.folders.forEach((folder) => {
    folder.streamerIds.forEach((id) => {
      const normalized = normalizeRawKey(id);
      if (normalized) {
        folderStreamerKeys.add(normalized);
      }
    });
  });

  if (!baseOrderSource.length && !followStore.folders.length) {
    return props.followedAnchors.length
      ? {
          nextListOrder: props.followedAnchors.map((streamer) => ({
            type: "streamer" as const,
            data: streamer,
          })),
          streamerSequence: [...props.followedAnchors],
        }
      : null;
  }

  const streamerDataMap = new Map<string, FollowedStreamer>();
  props.followedAnchors.forEach((streamer) => {
    streamerDataMap.set(toStreamerKey(streamer), streamer);
  });
  updateEntries.forEach((entry) => {
    const normalized =
      normalizeRawKey(entry.originalKey) || toStreamerKey(entry.updated);
    streamerDataMap.set(normalized, entry.updated);
  });

  const folderItems: FolderListItem[] = [];
  const liveItems: StreamerListItem[] = [];
  const loopingItems: StreamerListItem[] = [];
  const offlineItems: StreamerListItem[] = [];
  const seenFolderIds = new Set<string>();
  const seenStreamerKeys = new Set<string>();

  const pushFolder = (folderId: string) => {
    if (seenFolderIds.has(folderId)) return;
    const folder = followStore.folders.find((f) => f.id === folderId);
    if (!folder) return;
    folderItems.push({ type: "folder", data: folder });
    seenFolderIds.add(folderId);
  };

  const pushStreamerByKey = (key: string) => {
    const normalizedKey = normalizeRawKey(key) || key;
    if (!normalizedKey || seenStreamerKeys.has(normalizedKey)) return;
    const streamer = streamerDataMap.get(normalizedKey);
    if (!streamer) return;
    const item: StreamerListItem = { type: "streamer", data: streamer };
    const bucket = getStatusBucket(streamer);
    if (bucket === "LIVE") {
      liveItems.push(item);
    } else if (bucket === "LOOPING") {
      loopingItems.push(item);
    } else {
      offlineItems.push(item);
    }
    seenStreamerKeys.add(normalizedKey);
  };

  baseOrderSource.forEach((item) => {
    if (item.type === "folder") {
      pushFolder(item.data.id);
    } else {
      pushStreamerByKey(toStreamerKey(item.data));
    }
  });

  streamerDataMap.forEach((_streamer, key) => {
    pushStreamerByKey(key);
  });

  const filterOutFoldered = (items: StreamerListItem[]) =>
    items.filter((item) => !folderStreamerKeys.has(toStreamerKey(item.data)));
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
  ].map((item) => item.data);
  return { nextListOrder, streamerSequence };
}

const streamers = computed(() => props.followedAnchors);

// 列表项：使用 store 的 listOrder，如果为空则使用 followedAnchors
const listItems = computed((): FollowListItem[] => {
  if (followStore.listOrder.length > 0) {
    // 同步更新 listOrder 中的 streamer 数据，并确保文件夹数据是最新的
    return followStore.listOrder
      .map((item) => {
        if (item.type === "streamer") {
          const streamer = props.followedAnchors.find(
            (s) => s.platform === item.data.platform && s.id === item.data.id,
          );
          if (streamer) {
            return { type: "streamer" as const, data: streamer };
          }
        } else if (item.type === "folder") {
          // 确保文件夹数据是最新的（从 folders 数组中获取最新的文件夹对象）
          const latestFolder = followStore.folders.find(
            (f) => f.id === item.data.id,
          );
          if (latestFolder) {
            return { type: "folder" as const, data: latestFolder };
          }
        }
        return item;
      })
      .filter((item) => {
        // 如果是主播项但找不到对应的主播，则过滤掉
        if (item.type === "streamer") {
          return props.followedAnchors.some(
            (s) => s.platform === item.data.platform && s.id === item.data.id,
          );
        }
        // 如果是文件夹项但找不到对应的文件夹，则过滤掉
        if (item.type === "folder") {
          return followStore.folders.some((f) => f.id === item.data.id);
        }
        return true;
      });
  } else {
    // 如果没有 listOrder，则初始化为所有主播
    return props.followedAnchors.map((s) => ({
      type: "streamer" as const,
      data: s,
    }));
  }
});

// 自定义文件夹
const createNewFolder = () => {
  const name = `新文件夹 ${followStore.folders.length + 1}`;
  followStore.createFolder(name);
};

// 文件夹展开/折叠
const animateHoverHighlight = () => {
  const listEl = listRef.value;
  if (!listEl) {
    hoverAnimating = false;
    return;
  }
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
    if (!hoverAnimating) {
      hoverAnimating = true;
      hoverRaf = window.requestAnimationFrame(animateHoverHighlight);
    }
    return;
  }
  const listRect = listEl.getBoundingClientRect();
  const itemRect = hoveredItem.getBoundingClientRect();
  const y = itemRect.top - listRect.top + listEl.scrollTop;
  const h = hoveredItem.offsetHeight;
  listEl.style.setProperty("--hover-opacity", "1");
  hoverTargetY = Math.max(0, y);
  hoverTargetH = Math.max(0, h);
  if (!hoverAnimating) {
    hoverAnimating = true;
    hoverRaf = window.requestAnimationFrame(animateHoverHighlight);
  }
};

const scheduleHoverHighlight = () => {
  applyHoverHighlight();
};

const handleItemMouseEnter = (event: MouseEvent, index: number) => {
  const item = listItems.value[index];
  if (!item || item.type !== "streamer") {
    hoveredItem = null;
    scheduleHoverHighlight();
    return;
  }
  hoveredItem = event.currentTarget as HTMLElement;
  scheduleHoverHighlight();
};

const handleItemMouseLeave = (_index: number) => {
  hoveredItem = null;
  scheduleHoverHighlight();
};

const handleListMouseLeave = () => {
  hoveredItem = null;
  scheduleHoverHighlight();
};

const handleListScroll = () => {
  if (hoveredItem) scheduleHoverHighlight();
};

const handleToggleFolderExpand = (folderId: string) => {
  followStore.toggleFolderExpanded(folderId);
};

// 文件夹右键菜单
const handleFolderContextMenu = (folderId: string, event: MouseEvent) => {
  const folder = followStore.folders.find((f) => f.id === folderId);
  if (folder) {
    contextMenu.value = {
      show: true,
      position: { x: event.clientX, y: event.clientY },
      folderId,
      folderName: folder.name,
    };
  }
};

// 文件夹重命名
const handleFolderRename = (newName: string) => {
  if (!contextMenu.value.folderId) return;

  const trimmedName = newName.trim();
  if (!trimmedName) {
    console.warn("Folder name cannot be empty");
    return;
  }

  followStore.renameFolder(contextMenu.value.folderId, trimmedName);
  // 更新 contextMenu 中的文件夹名称，以便下次打开时显示新名称
  const folder = followStore.folders.find(
    (f) => f.id === contextMenu.value.folderId,
  );
  if (folder) {
    contextMenu.value.folderName = folder.name;
  }
  contextMenu.value.show = false;
};

// 文件夹删除
const handleFolderDelete = () => {
  followStore.deleteFolder(contextMenu.value.folderId);
  contextMenu.value.show = false;
};

// 文件夹拖动开始
const handleFolderDragStart = (
  _folderId: string,
  index: number,
  event: MouseEvent,
) => {
  // 文件夹拖动逻辑与主播拖动类似
  isDragging.value = true;
  draggedIndex.value = index;
  draggedItemType.value = "folder";
  startY.value = event.clientY;
  currentY.value = event.clientY;

  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp);

  event.preventDefault();
};

const draggedItemType = ref<"folder" | "streamer" | null>(null);

// Overlay: floating full follow list with platform filters
const showOverlay = ref(false);
const overlayDeleteMode = ref(false);
type FilterType = "ALL" | Platform;
const activeFilter = ref<FilterType>("ALL");
const openOverlay = () => {
  const headerRect = document
    .querySelector(".app-header")
    ?.getBoundingClientRect() as DOMRect | undefined;
  overlayAlignTop.value = headerRect ? Math.round(headerRect.bottom + 8) : 72;
  const rect = expandBtnRef.value?.getBoundingClientRect();
  overlayAlignLeft.value = rect ? Math.round(rect.right + 12) : 240;
  overlayDeleteMode.value = false;
  showOverlay.value = true;
};
const closeOverlay = () => {
  showOverlay.value = false;
  overlayDeleteMode.value = false;
};
const toggleOverlayDeleteMode = () => {
  overlayDeleteMode.value = !overlayDeleteMode.value;
};
const setFilter = (f: FilterType) => {
  activeFilter.value = f;
};
const platformsOrder: Platform[] = [
  Platform.DOUYU,
  Platform.DOUYIN,
  Platform.HUYA,
  Platform.BILIBILI,
];
const visiblePlatforms = computed(() => {
  const present = new Set<Platform>();
  for (const s of streamers.value) {
    if (s.platform !== undefined) present.add(s.platform);
  }
  return platformsOrder.filter((p) => present.has(p));
});
const filteredStreamers = computed(() => {
  if (activeFilter.value === "ALL") return streamers.value;
  return streamers.value.filter((s) => s.platform === activeFilter.value);
});

const selectFromOverlay = (s: FollowedStreamer) => {
  if (overlayDeleteMode.value) return;
  emit("selectAnchor", s);
  closeOverlay();
};

const handleOverlayRemove = (s: FollowedStreamer) => {
  emit("unfollow", { platform: s.platform, id: s.id });
};

// Method to determine class for the list item itself
const getStreamerItemClass = (streamer: FollowedStreamer) => {
  return {
    "status-live": streamer.liveStatus === "LIVE",
    "status-replay": streamer.liveStatus === "REPLAY",
    "status-offline":
      streamer.liveStatus === "OFFLINE" ||
      !streamer.liveStatus ||
      streamer.liveStatus === "UNKNOWN",
  };
};

// Method to determine class for the live indicator dot
const getLiveIndicatorClass = (streamer: FollowedStreamer) => {
  switch (streamer.liveStatus) {
    case "LIVE":
      return "is-live"; // Existing class for green
    case "REPLAY":
      return "is-replay"; // New class for yellow
    case "OFFLINE":
    case "UNKNOWN":
    default:
      return "is-offline"; // New or existing class for gray/default
  }
};

watch(
  () => props.followedAnchors,
  (newVal, oldVal) => {
    if (!oldVal || oldVal.length === 0) return;

    const oldIds = oldVal.map((streamer) => streamer.id);
    const newStreamers = newVal.filter(
      (streamer) => !oldIds.includes(streamer.id),
    );

    if (newStreamers.length > 0) {
      newStreamers.forEach((streamer) => {
        justAddedIds.value.push(streamer.id);
        setTimeout(() => {
          justAddedIds.value = justAddedIds.value.filter(
            (id) => id !== streamer.id,
          );
        }, 3000);
      });
    }
  },
  { deep: true },
);

const handleClick = (e: MouseEvent, streamer: FollowedStreamer) => {
  if (isDragging.value && draggedIndex.value !== -1) {
    e.preventDefault();
    return;
  }
  emit("selectAnchor", streamer);
};

const clearLongPressTimer = () => {
  if (dragPrepTimer.value !== null) {
    clearTimeout(dragPrepTimer.value);
    dragPrepTimer.value = null;
  }
};

const resetPendingDrag = () => {
  pendingDragIndex.value = -1;
  pendingDragType.value = null;
  dragStartPoint.value = null;
};

const clearDragPreparation = () => {
  clearLongPressTimer();
  resetPendingDrag();
};

function safeCancelDrag() {
  clearDragPreparation();
  if (!isDragging.value) {
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp as any);
    return;
  }
  followStore.rollbackTransaction();
  isDragging.value = false;
  draggedIndex.value = -1;
  draggedItemType.value = null;
  dragOverFolderId.value = null;
  draggedStreamerKey.value = null;
  draggedFromFolder.value = false;
  sourceFolderId.value = null;
  document.removeEventListener("mousemove", handleMouseMove);
  document.removeEventListener("mouseup", handleMouseUp as any);
}

const startStreamerDrag = (
  index: number,
  startPoint: { x: number; y: number },
) => {
  const item = listItems.value[index];
  if (!item || item.type !== "streamer") return;
  clearDragPreparation();
  const streamer = item.data;
  draggedStreamerKey.value = `${streamer.platform}:${streamer.id}`;
  draggedFromFolder.value = false;
  followStore.beginTransaction();
  isDragging.value = true;
  draggedIndex.value = index;
  draggedItemType.value = "streamer";
  startY.value = startPoint.y;
  startX.value = startPoint.x;
  currentY.value = startPoint.y;
  dragSessionId.value++;
};

const handleMouseDown = (e: MouseEvent, index: number) => {
  if (e.button !== 0) return;
  // 若上一次拖拽未正常结束，先强制取消并回滚
  if (isDragging.value) safeCancelDrag();

  const item = listItems.value[index];
  if (item.type === "folder") {
    // 文件夹拖动由 FolderItem 组件处理
    return;
  }

  e.preventDefault();
  clearDragPreparation();
  startY.value = e.clientY;
  startX.value = e.clientX;
  pendingDragIndex.value = index;
  pendingDragType.value = "streamer";
  dragStartPoint.value = { x: e.clientX, y: e.clientY };
  dragPrepTimer.value = window.setTimeout(() => {
    const point = dragStartPoint.value || { x: e.clientX, y: e.clientY };
    startStreamerDrag(index, point);
  }, LONG_PRESS_MS);

  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp as any);
};

const handleMouseMove = (e: MouseEvent) => {
  if (!isDragging.value || draggedIndex.value === -1) {
    if (pendingDragIndex.value !== -1 && pendingDragType.value === "streamer") {
      const movedDist = Math.hypot(
        e.clientX - startX.value,
        e.clientY - startY.value,
      );
      if (movedDist >= DRAG_MIN_PX) {
        startStreamerDrag(
          pendingDragIndex.value,
          dragStartPoint.value || { x: e.clientX, y: e.clientY },
        );
      }
    }
    if (!isDragging.value) return;
  }

  currentY.value = e.clientY;

  // 如果正在拖拽主播项，检查是否悬停在文件夹上
  if (draggedItemType.value === "streamer" && draggedStreamerKey.value) {
    const folderElements = Array.from(
      document.querySelectorAll<HTMLElement>(".folder-item"),
    );
    const matchedFolder = folderElements.find((el) => {
      const rect = el.getBoundingClientRect();
      return (
        e.clientX >= rect.left - FOLDER_HOVER_PADDING &&
        e.clientX <= rect.right + FOLDER_HOVER_PADDING &&
        e.clientY >= rect.top - FOLDER_HOVER_PADDING &&
        e.clientY <= rect.bottom + FOLDER_HOVER_PADDING
      );
    });
    const folderId = matchedFolder?.getAttribute("data-folder-id") || null;
    if (folderId) {
      const folder = followStore.folders.find((f) => f.id === folderId);
      if (folder) {
        const [rp, rid] = (draggedStreamerKey.value || "").split(":");
        const normKey = `${String(rp || "").toUpperCase()}:${rid}`;
        const exists = folder.streamerIds.some((id) => {
          const [p, i] = (id || "").split(":");
          return `${String(p || "").toUpperCase()}:${i}` === normKey;
        });
        if (!exists) {
          dragOverFolderId.value = folderId;
          return; // 悬停在文件夹上，不进行排序
        }
      }
    }
    dragOverFolderId.value = null;
  }

  const container = listRef.value?.querySelector(".streamers-list");
  if (!container) return;

  const items = Array.from(container.children) as HTMLElement[];
  const draggedItem = items[draggedIndex.value];
  if (!draggedItem) return;

  const moveY = currentY.value - startY.value;
  const itemHeight = draggedItem.offsetHeight;

  let targetIndex = draggedIndex.value;
  let accumulatedHeight = 0;
  if (moveY > 0) {
    for (let i = draggedIndex.value + 1; i < items.length; i++) {
      accumulatedHeight += items[i].offsetHeight;
      if (moveY < accumulatedHeight) break;
      targetIndex = i;
    }
  } else {
    for (let i = draggedIndex.value - 1; i >= 0; i--) {
      accumulatedHeight -= items[i].offsetHeight;
      if (moveY > accumulatedHeight) break;
      targetIndex = i;
    }
  }

  if (targetIndex !== draggedIndex.value) {
    // 若目标是文件夹且已展开：不做列表重排，直接进入“悬停文件夹”状态，避免把文件夹顶下去
    const targetItem = listItems.value[targetIndex];
    if (
      targetItem &&
      targetItem.type === "folder" &&
      targetItem.data.expanded
    ) {
      dragOverFolderId.value = targetItem.data.id;
      return;
    }

    // 重新排序列表项（包括文件夹和主播）
    const reorderedItems = [...listItems.value];
    const [removed] = reorderedItems.splice(draggedIndex.value, 1);
    reorderedItems.splice(targetIndex, 0, removed);

    // 更新 store（统一由 listOrder 管理，移除向后兼容的父级重排事件以避免丢失文件夹内主播）
    followStore.updateListOrder(reorderedItems);

    draggedIndex.value = targetIndex;
    startY.value = e.clientY - (targetIndex - draggedIndex.value) * itemHeight;
  }
};

const handleMouseUp = (ev: MouseEvent) => {
  clearDragPreparation();
  if (!isDragging.value) {
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp as any);
    return;
  }

  // 如果正在拖拽主播项且悬停在文件夹上，将主播移入文件夹
  if (
    draggedItemType.value === "streamer" &&
    draggedStreamerKey.value &&
    dragOverFolderId.value
  ) {
    followStore.moveStreamerToFolder(
      draggedStreamerKey.value,
      dragOverFolderId.value,
    );
    // 提交事务（若此前从文件夹开始拖拽或存在快照）
    followStore.commitTransaction();
  } else if (draggedItemType.value === "streamer" && draggedFromFolder.value) {
    // 未放到其它文件夹，需要根据移动距离与是否仍在源文件夹内来决定移出或取消
    const movedDist = Math.hypot(
      (ev?.clientX ?? startX.value) - startX.value,
      (ev?.clientY ?? startY.value) - startY.value,
    );
    const shouldRemoveByDistance = movedDist >= DRAG_MIN_PX;
    let isStillInsideSource = false;
    if (sourceFolderId.value) {
      const el = document.querySelector(
        `.folder-item[data-folder-id="${sourceFolderId.value}"]`,
      ) as HTMLElement | null;
      const rect = el?.getBoundingClientRect();
      if (rect && ev) {
        isStillInsideSource =
          ev.clientX >= rect.left &&
          ev.clientX <= rect.right &&
          ev.clientY >= rect.top &&
          ev.clientY <= rect.bottom;
      }
    }
    if (
      sourceFolderId.value &&
      draggedStreamerKey.value &&
      shouldRemoveByDistance &&
      !isStillInsideSource
    ) {
      // 判定为移出源文件夹
      followStore.removeStreamerFromFolder(
        draggedStreamerKey.value,
        sourceFolderId.value,
      );
      followStore.commitTransaction();
    } else {
      // 取消此次拖拽，回滚到拖拽前
      followStore.rollbackTransaction();
    }
  } else if (
    draggedItemType.value === "streamer" &&
    !dragOverFolderId.value &&
    !draggedFromFolder.value
  ) {
    // 主列表内拖拽：若位移不足阈值则取消重排，否则提交
    const movedDist = Math.hypot(
      (ev?.clientX ?? startX.value) - startX.value,
      (ev?.clientY ?? startY.value) - startY.value,
    );
    if (movedDist < DRAG_MIN_PX) {
      followStore.rollbackTransaction();
    } else {
      followStore.commitTransaction();
    }
  }

  isDragging.value = false;
  draggedIndex.value = -1;
  draggedItemType.value = null;
  dragOverFolderId.value = null;
  draggedStreamerKey.value = null;
  draggedFromFolder.value = false;
  sourceFolderId.value = null;

  document.removeEventListener("mousemove", handleMouseMove);
  document.removeEventListener("mouseup", handleMouseUp as any);
};

// 文件夹拖拽悬停处理
const handleFolderDragOver = (folderId: string) => {
  if (draggedItemType.value === "streamer" && draggedStreamerKey.value) {
    const folder = followStore.folders.find((f) => f.id === folderId);
    if (folder) {
      const [rp, rid] = (draggedStreamerKey.value || "").split(":");
      const normKey = `${String(rp || "").toUpperCase()}:${rid}`;
      const exists = folder.streamerIds.some((id) => {
        const [p, i] = (id || "").split(":");
        return `${String(p || "").toUpperCase()}:${i}` === normKey;
      });
      if (!exists) {
        dragOverFolderId.value = folderId;
      }
    }
  }
};

// 文件夹拖拽离开处理
const handleFolderDragLeave = () => {
  dragOverFolderId.value = null;
};

// 文件夹拖放处理
const handleFolderDrop = (folderId: string) => {
  if (draggedItemType.value === "streamer" && draggedStreamerKey.value) {
    followStore.moveStreamerToFolder(draggedStreamerKey.value, folderId);
    followStore.commitTransaction();
    // 重置拖拽状态
    isDragging.value = false;
    draggedIndex.value = -1;
    draggedItemType.value = null;
    dragOverFolderId.value = null;
    draggedStreamerKey.value = null;
    draggedFromFolder.value = false;
    sourceFolderId.value = null;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp as any);
  }
};

// 从文件夹中拖出主播
const handleFolderStreamerDragStart = (
  streamer: FollowedStreamer,
  event: MouseEvent,
) => {
  if (event.button !== 0) return;
  // 若上一次拖拽未正常结束，先强制取消并回滚
  if (isDragging.value) safeCancelDrag();
  clearDragPreparation();

  // 记录正在拖拽的主播键值
  draggedStreamerKey.value = `${streamer.platform}:${streamer.id}`;
  draggedFromFolder.value = true;

  // 找到该主播所在的文件夹
  const streamerKey = draggedStreamerKey.value;
  const folder = streamerKey
    ? followStore.folders.find((f) => {
        // 比较时按规范化平台大小写匹配
        return f.streamerIds.some((id) => {
          const [p, i] = (id || "").split(":");
          const [rp, ri] = (streamerKey || "").split(":");
          return (
            `${String(p || "").toUpperCase()}:${i}` ===
            `${String(rp || "").toUpperCase()}:${ri}`
          );
        });
      })
    : null;

  if (folder) {
    // 启动事务，推迟实际移出到 mouseup 决定
    followStore.beginTransaction();
    sourceFolderId.value = folder.id;
  }

  // 开始拖拽排序
  isDragging.value = true;
  draggedItemType.value = "streamer";
  startY.value = event.clientY;
  startX.value = event.clientX;
  currentY.value = event.clientY;
  dragSessionId.value++;

  // 找到该主播在主列表中的新位置
  const newIndex = listItems.value.findIndex((item) => {
    if (item.type === "streamer") {
      return (
        `${item.data.platform}:${item.data.id}` === draggedStreamerKey.value
      );
    }
    return false;
  });

  if (newIndex !== -1) {
    draggedIndex.value = newIndex;
  } else {
    draggedIndex.value = listItems.value.length;
  }

  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp as any);

  event.preventDefault();
  event.stopPropagation();
};

// 失焦保护：拖拽中若窗口失焦，回滚事务并重置状态，避免数据丢失
function handleWindowBlur() {
  clearDragPreparation();
  if (!isDragging.value) return;
  followStore.rollbackTransaction();
  isDragging.value = false;
  draggedIndex.value = -1;
  draggedItemType.value = null;
  dragOverFolderId.value = null;
  draggedStreamerKey.value = null;
  draggedFromFolder.value = false;
  sourceFolderId.value = null;
  document.removeEventListener("mousemove", handleMouseMove);
  document.removeEventListener("mouseup", handleMouseUp as any);
}
window.addEventListener("blur", handleWindowBlur);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    handleWindowBlur();
  }
});

const clearAnimationTimeout = () => {
  if (animationTimeout.value !== null) {
    clearTimeout(animationTimeout.value);
    animationTimeout.value = null;
  }
};

// 新增：刷新进度与完成提示
const progressCurrent = ref(0);
const progressTotal = ref(0);

// 简易并发控制器：限制同时运行的刷新任务数量
async function runWithConcurrency<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  limit: number,
) {
  let cursor = 0;
  const runners: Promise<void>[] = [];
  const runner = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await worker(items[i], i);
      // 让出事件循环，避免持续占用主线程
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

  // 初始化进度：以 store 中的关注总数为准（包含文件夹内）
  progressCurrent.value = 0;
  const totalFromStore = followStore.getFollowedStreamers?.length ?? 0;
  progressTotal.value =
    totalFromStore > 0 ? totalFromStore : props.followedAnchors.length;
  try {
    // 仅在包含 B 站主播时启动静态代理（用于头像等图片代理）
    const hasBiliOrHuya = props.followedAnchors.some(
      (s) => s.platform === Platform.BILIBILI || s.platform === Platform.HUYA,
    );
    if (hasBiliOrHuya) {
      await ensureProxyStarted();
    }

    const updates: { originalKey: string; updated: FollowedStreamer }[] = [];
    const items = [...props.followedAnchors];

    await runWithConcurrency(
      items,
      async (streamer) => {
        let updatedStreamerData: Partial<FollowedStreamer> = {};
        try {
          if (streamer.platform === Platform.DOUYU) {
            updatedStreamerData = await refreshDouyuFollowedStreamer(streamer);
          } else if (streamer.platform === Platform.DOUYIN) {
            updatedStreamerData = await refreshDouyinFollowedStreamer(streamer);
          } else if (streamer.platform === Platform.HUYA) {
            try {
              const res: any = await invoke("get_huya_unified_cmd", {
                roomId: streamer.id,
                quality: "原画",
              });
              const live: boolean = !!(res && res.is_live);
              const liveStatus: LiveStatus = live ? "LIVE" : "OFFLINE";
              updatedStreamerData = {
                liveStatus,
                isLive: live,
                nickname: res && res.nick ? res.nick : streamer.nickname,
                roomTitle: res && res.title ? res.title : streamer.roomTitle,
                avatarUrl: res && res.avatar ? res.avatar : streamer.avatarUrl,
              };
            } catch (err: any) {
              const msg = typeof err === "string" ? err : err?.message || "";
              if (msg.includes("主播未开播或获取虎牙房间详情失败")) {
                updatedStreamerData = {
                  liveStatus: "OFFLINE",
                  isLive: false,
                  nickname: streamer.nickname,
                  roomTitle: streamer.roomTitle,
                  avatarUrl: streamer.avatarUrl,
                };
              } else {
                throw err;
              }
            }
          } else if (streamer.platform === Platform.BILIBILI) {
            const payload = { args: { room_id_str: streamer.id } };
            const savedCookie =
              typeof localStorage !== "undefined"
                ? localStorage.getItem("bilibili_cookie") || null
                : null;
            const res: any = await invoke("fetch_bilibili_streamer_info", {
              payload,
              cookie: savedCookie,
            });
            const liveStatus: LiveStatus =
              res && res.status === 1 ? "LIVE" : "OFFLINE";
            updatedStreamerData = {
              liveStatus,
              isLive: liveStatus === "LIVE",
              nickname:
                res && res.anchor_name ? res.anchor_name : streamer.nickname,
              roomTitle: res && res.title ? res.title : streamer.roomTitle,
              avatarUrl: res && res.avatar ? res.avatar : streamer.avatarUrl,
            };
          } else {
            console.warn(
              `Unsupported platform for refresh: ${streamer.platform}`,
            );
            updates.push({
              originalKey: `${streamer.platform}:${streamer.id}`,
              updated: streamer,
            });
            progressCurrent.value++;
            return;
          }

          updates.push({
            originalKey: `${streamer.platform}:${streamer.id}`,
            updated: {
              ...streamer,
              ...updatedStreamerData,
            } as FollowedStreamer,
          });
        } catch (e) {
          console.error(
            `[FollowsList] Error during refresh for ${streamer.platform}/${streamer.id}, returning original:`,
            e,
          );
          updates.push({
            originalKey: `${streamer.platform}:${streamer.id}`,
            updated: streamer,
          });
        } finally {
          // 更新进度
          progressCurrent.value++;
        }
      },
      FOLLOW_REFRESH_CONCURRENCY,
    );

    const validUpdates = updates.filter(
      (entry): entry is RefreshUpdateEntry =>
        !!entry && !!entry.updated && typeof entry.updated.id !== "undefined",
    );
    const orderingResult = buildPostRefreshOrdering(validUpdates) || null;
    if (orderingResult) {
      followStore.updateListOrder(orderingResult.nextListOrder);
      const hasChanged =
        JSON.stringify(orderingResult.streamerSequence) !==
        JSON.stringify(props.followedAnchors);
      if (hasChanged) {
        emit("reorderList", orderingResult.streamerSequence);
      }
    }
  } finally {
    const elapsedTime = Date.now() - startTime;
    const finish = () => {
      isRefreshing.value = false;
      showCheckIcon.value = true;
      setTimeout(() => {
        showCheckIcon.value = false;
      }, 1000);
    };
    if (elapsedTime < MIN_ANIMATION_DURATION) {
      clearAnimationTimeout();
      animationTimeout.value = window.setTimeout(() => {
        finish();
        animationTimeout.value = null;
      }, MIN_ANIMATION_DURATION - elapsedTime);
    } else {
      finish();
    }
  }
};

onMounted(async () => {
  // 加载 store 数据
  if (!followStore.listOrder.length && props.followedAnchors.length > 0) {
    followStore.initializeListOrder();
  }

  // 在初次渲染前，若包含 B 站主播则先启动静态代理，避免头像首次以原始地址加载导致 403
  const hasBili = props.followedAnchors.some(
    (s) => s.platform === Platform.BILIBILI,
  );
  if (hasBili) {
    await ensureProxyStarted();
  }
  // 延迟到页面空闲或设定时间后再刷新关注列表，避免影响斗鱼分类/主播列表的首屏加载
  requestIdle(() => {
    refreshList();
  });
});

onUnmounted(() => {
  clearAnimationTimeout();
  if (hoverRaf !== null && typeof window !== "undefined") {
    window.cancelAnimationFrame(hoverRaf);
    hoverRaf = null;
  }
});
</script>

<style src="./index.css" scoped></style>
