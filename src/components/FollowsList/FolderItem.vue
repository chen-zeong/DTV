<template>
  <motion.div
    class="relative mb-2 select-none overflow-hidden rounded-[24px] border    transition-[box-shadow,background,border-color] duration-200"
    :data-folder-id="folder.id" :class="{
      'border-[var(--accent)] shadow-[0_0_0_2px_rgba(29,185,84,0.35),0_0_16px_rgba(29,185,84,0.25)]': isDragOver,
      'bg-[var(--surface-2)]': folder.expanded
    }" @mousedown="handleHeaderMouseDown" @mouseup="handleHeaderMouseUp" @contextmenu.prevent="handleContextMenu"
    @mouseenter="handleMouseEnter" @mouseleave="handleMouseLeave">
    <div
      class="group flex cursor-pointer items-center gap-3 rounded-[14px] bg-transparent px-4 py-2.5 transition-all duration-200"
      @click="handleToggleClick">
      <svg class="h-4 w-4 text-[#94a3b8] transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]"
        :class="folder.expanded ? 'scale-110' : ''" xmlns="http://www.w3.org/2000/svg" width="16" height="16"
        viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      </svg>
      <span class="flex-1 truncate text-[14px] font-bold tracking-[0.02em]  transition-colors duration-200">{{
        folder.name }}</span>
      <span class="rounded-[20px] border   px-2 text-[10px] font-extrabold  transition-colors duration-200  ">{{
        folder.streamerIds.length }}</span>
      <motion.span class="inline-flex h-3 w-3 items-center justify-center text-[#94a3b8] transition-colors duration-200"
        :animate="{ rotate: folder.expanded ? 180 : 0 }" :transition="{ duration: 0.2, ease: [0.25, 0.8, 0.4, 1] }">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </motion.span>
    </div>
    <AnimatePresence :initial="false">
      <motion.div v-if="folder.expanded && folderItems.length > 0"
        class="relative overflow-hidden px-3 pb-4 pt-2 [will-change:height]"
        :class="{ 'pointer-events-none': globalDragging }" ref="folderContentRef"
        @mouseleave="handleFolderContentMouseLeave" :initial="{ height: 0, opacity: 0 }"
        :animate="{ height: folderContentHeight, opacity: 1 }"
        :exit="{ height: 0, opacity: 0, transition: { type: 'tween', duration: 0.24, ease: [0.64, 0, 0.78, 0.39] } }"
        :transition="{ type: 'tween', duration: 0.24, ease: [0.22, 0.61, 0.36, 1] }">
        <motion.div
          class="absolute left-0 top-0 z-0 rounded-[10px] border border-[rgba(29,185,84,0.25)] bg-[rgba(29,185,84,0.12)] opacity-0 transition-[transform,width,height] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
          :initial="folderHoverHighlightInitial" :animate="folderHoverHighlightMotion"
          :transition="folderHoverHighlightTransition" aria-hidden="true"
          :style="{ borderRadius: '12px', minHeight: '38px' }" />
        <ul class="relative z-[1] flex flex-col gap-1">
          <li v-for="(streamer, index) in folderItems" :key="`${streamer.platform}:${streamer.id}`"
            class="rounded-[var(--radius-sm)] bg-transparent transition-all duration-200"
            :class="getStreamerItemClass(streamer)" :ref="(el) => setFolderItemRef(index, el)"
            @mouseenter="handleFolderItemMouseEnter(index)" @click.stop="handleClick(streamer)"
            @mousedown.stop="(e) => handleFolderStreamerMouseDown(streamer, e)"
            @mouseup.stop="handleFolderStreamerMouseUp"
            @mouseleave="() => { handleFolderItemMouseLeave(index); handleFolderStreamerMouseUp(); }">
            <StreamerItem :streamer="streamer" :getAvatarSrc="getAvatarSrc" :handleImgError="handleImgError"
              :getLiveIndicatorClass="getLiveIndicatorClass" :proxyBase="proxyBase"
              @clickItem="(s) => emit('selectAnchor', s)" />
          </li>
        </ul>
      </motion.div>
    </AnimatePresence>
  </motion.div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { AnimatePresence, motion } from 'motion-v';
import type { FollowedStreamer } from '../../platforms/common/types';
import { useFollowStore, type FollowFolder } from '../../stores/followStore';

const props = defineProps<{
  folder: FollowFolder;
  allStreamers: FollowedStreamer[];
  getAvatarSrc: (s: FollowedStreamer) => string;
  handleImgError: (ev: Event, s: FollowedStreamer) => void;
  getLiveIndicatorClass: (s: FollowedStreamer) => string;
  proxyBase?: string;
  isDragging?: boolean;
  isDragOver?: boolean;
  canAcceptDrop?: boolean;
  globalDragging?: boolean;
}>();

const emit = defineEmits<{
  (e: 'selectAnchor', streamer: FollowedStreamer): void;
  (e: 'toggleExpand', folderId: string): void;
  (e: 'dragStart', folderId: string, event: MouseEvent): void;
  (e: 'contextMenu', folderId: string, event: MouseEvent): void;
  (e: 'dragOver', folderId: string): void;
  (e: 'dragLeave'): void;
  (e: 'drop', folderId: string): void;
  (e: 'streamerDragStart', streamer: FollowedStreamer, event: MouseEvent): void;
}>();

const sortStreamersByStatus = (items: FollowedStreamer[]): FollowedStreamer[] => {
  const live: FollowedStreamer[] = [];
  const looping: FollowedStreamer[] = [];
  const rest: FollowedStreamer[] = [];
  items.forEach(streamer => {
    if (streamer.liveStatus === 'LIVE' || (!streamer.liveStatus && streamer.isLive)) {
      live.push(streamer);
    } else if (streamer.liveStatus === 'REPLAY') {
      looping.push(streamer);
    } else {
      rest.push(streamer);
    }
  });
  return [...live, ...looping, ...rest];
};

const folderItems = computed(() => {
  const seen = new Set<string>();
  const result: FollowedStreamer[] = [];
  for (const key of props.folder.streamerIds) {
    const [platform, id] = (key || '').split(':');
    const platformKey = (platform || '').toUpperCase();
    const dedupKey = `${platformKey}:${id}`;
    if (seen.has(dedupKey)) continue;
    const found = props.allStreamers.find((s: FollowedStreamer) => String(s.platform).toUpperCase() === platformKey && s.id === id);
    if (found) {
      seen.add(dedupKey);
      result.push(found);
    }
  }
  return sortStreamersByStatus(result);
});

const folderContentRef = ref<HTMLElement | null>(null);
const folderContentHeight = ref(0);
let folderContentObserver: ResizeObserver | null = null;
const folderItemRefs = new Map<number, HTMLElement>();
const hoveredFolderIndex = ref<number | null>(null);
const folderHoverHighlight = reactive({ x: 0, y: 0, width: 0, height: 0, visible: false });
const folderHoverHighlightInitial = { x: 0, y: 0, width: 0, height: 32, opacity: 0 };
const folderHoverHighlightTransition = { type: 'spring', stiffness: 280, damping: 28, mass: 0.7 } as const;
const folderHoverHighlightMotion = computed(() => ({
  x: folderHoverHighlight.x,
  y: folderHoverHighlight.y,
  width: folderHoverHighlight.width,
  height: folderHoverHighlight.height,
  opacity: folderHoverHighlight.visible ? 1 : 0,
}));

const resolveElement = (el: any): HTMLElement | null => {
  if (!el) return null;
  const element = el?.$el ?? el;
  return element instanceof HTMLElement ? element : null;
};

const recomputeFolderHoverHighlight = () => {
  const index = hoveredFolderIndex.value;
  if (index === null) {
    folderHoverHighlight.visible = false;
    return;
  }
  const contentEl = resolveElement(folderContentRef.value);
  const itemEl = folderItemRefs.get(index);
  if (!contentEl || !itemEl) {
    folderHoverHighlight.visible = false;
    return;
  }
  const contentRect = contentEl.getBoundingClientRect();
  const itemRect = itemEl.getBoundingClientRect();
  const scrollLeft = contentEl.scrollLeft;
  const scrollTop = contentEl.scrollTop;
  folderHoverHighlight.x = itemRect.left - contentRect.left + scrollLeft;
  folderHoverHighlight.y = itemRect.top - contentRect.top + scrollTop;
  folderHoverHighlight.width = itemRect.width;
  folderHoverHighlight.height = itemRect.height;
  folderHoverHighlight.visible = true;
};

const updateFolderContentHeight = () => {
  const contentEl = resolveElement(folderContentRef.value);
  if (!contentEl) return;
  folderContentHeight.value = contentEl.scrollHeight;
};

watch(folderContentRef, (current) => {
  if (folderContentObserver) {
    folderContentObserver.disconnect();
    folderContentObserver = null;
  }
  const element = resolveElement(current);
  if (!element) return;
  folderContentObserver = new ResizeObserver(updateFolderContentHeight);
  folderContentObserver.observe(element);
  nextTick(updateFolderContentHeight);
});

const setFolderItemRef = (index: number, el: any) => {
  if (!el) {
    folderItemRefs.delete(index);
    return;
  }
  const element = el?.$el ?? el;
  if (element instanceof HTMLElement) {
    folderItemRefs.set(index, element);
    if (hoveredFolderIndex.value === index) {
      nextTick(recomputeFolderHoverHighlight);
    }
  }
};

const handleFolderItemMouseEnter = (index: number) => {
  hoveredFolderIndex.value = index;
  nextTick(recomputeFolderHoverHighlight);
};

const handleFolderItemMouseLeave = (index: number) => {
  if (hoveredFolderIndex.value === index) {
    hoveredFolderIndex.value = null;
    folderHoverHighlight.visible = false;
  }
};

const handleFolderContentMouseLeave = () => {
  hoveredFolderIndex.value = null;
  folderHoverHighlight.visible = false;
};

watch(folderItems, () => {
  folderItemRefs.clear();
  hoveredFolderIndex.value = null;
  folderHoverHighlight.visible = false;
  nextTick(() => {
    recomputeFolderHoverHighlight();
    updateFolderContentHeight();
  });
});

watch(() => props.folder.expanded, (expanded) => {
  if (!expanded) {
    hoveredFolderIndex.value = null;
    folderHoverHighlight.visible = false;
    folderContentHeight.value = 0;
    return;
  }
  nextTick(updateFolderContentHeight);
});

onBeforeUnmount(() => {
  folderItemRefs.clear();
  if (folderContentObserver) {
    folderContentObserver.disconnect();
    folderContentObserver = null;
  }
});

const toggleExpand = () => emit('toggleExpand', props.folder.id);

const LONG_PRESS_MS = 220;
const MOVE_THRESHOLD_PX = 6;
let headerPressTimer: number | null = null;
let headerLongPressTriggered = false;
let headerDragStarted = false;
let headerStartPoint: { x: number; y: number } | null = null;

const clearHeaderPress = () => {
  if (headerPressTimer !== null) {
    clearTimeout(headerPressTimer);
    headerPressTimer = null;
  }
};

const cleanupHeaderListeners = () => {
  document.removeEventListener('mousemove', handleHeaderMouseMove);
  document.removeEventListener('mouseup', handleHeaderMouseUp);
};

const handleHeaderMouseMove = (e: MouseEvent) => {
  if (!headerStartPoint || headerDragStarted) return;
  const movedDist = Math.hypot(e.clientX - headerStartPoint.x, e.clientY - headerStartPoint.y);
  if (movedDist >= MOVE_THRESHOLD_PX) {
    headerDragStarted = true;
    clearHeaderPress();
    emit('dragStart', props.folder.id, e);
    headerStartPoint = null;
    cleanupHeaderListeners();
  }
};

const handleHeaderMouseDown = (e: MouseEvent) => {
  if (e.button !== 0 || props.globalDragging) return;
  e.preventDefault();
  headerLongPressTriggered = false;
  headerDragStarted = false;
  headerStartPoint = { x: e.clientX, y: e.clientY };
  clearHeaderPress();
  cleanupHeaderListeners();
  document.addEventListener('mousemove', handleHeaderMouseMove);
  document.addEventListener('mouseup', handleHeaderMouseUp);
  headerPressTimer = window.setTimeout(() => {
    headerLongPressTriggered = true;
    headerDragStarted = true;
    emit('dragStart', props.folder.id, e);
    headerStartPoint = null;
    cleanupHeaderListeners();
  }, LONG_PRESS_MS);
};

const handleHeaderMouseUp = () => {
  clearHeaderPress();
  headerStartPoint = null;
  cleanupHeaderListeners();
};

const handleToggleClick = () => {
  if (headerLongPressTriggered) {
    headerLongPressTriggered = false;
    return;
  }
  toggleExpand();
};

const handleContextMenu = (e: MouseEvent) => {
  emit('contextMenu', props.folder.id, e);
};

const handleClick = (streamer: FollowedStreamer) => {
  // 若已进入长按拖动，阻止点击进入观看
  if (longPressTriggered) {
    longPressTriggered = false;
    return;
  }
  emit('selectAnchor', streamer);
};

const handleMouseEnter = () => {
  if (props.canAcceptDrop) {
    emit('dragOver', props.folder.id);
  }
};

const handleMouseLeave = () => {
  clearHeaderPress();
  headerStartPoint = null;
  cleanupHeaderListeners();
  if (props.canAcceptDrop) {
    emit('dragLeave');
  }
};

// 长按触发拖动，避免单击立即进入拖动
const LONG_PRESS_MS_FOL = 220;
const MOVE_THRESHOLD_PX_FOL = 6;
let longPressTimer: number | null = null;
let longPressTriggered = false;
let longPressDragStarted = false;
let longPressStartPoint: { x: number; y: number } | null = null;
let longPressStreamer: FollowedStreamer | null = null;

const clearLongPress = () => {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
};

const cleanupFolderStreamerListeners = () => {
  document.removeEventListener('mousemove', handleFolderStreamerMouseMove);
  document.removeEventListener('mouseup', handleFolderStreamerMouseUp);
};

const handleFolderStreamerMouseMove = (event: MouseEvent) => {
  if (!longPressStartPoint || longPressDragStarted) return;
  const movedDist = Math.hypot(event.clientX - longPressStartPoint.x, event.clientY - longPressStartPoint.y);
  if (movedDist >= MOVE_THRESHOLD_PX_FOL) {
    longPressDragStarted = true;
    longPressTriggered = true;
    clearLongPress();
    if (longPressStreamer) {
      emit('streamerDragStart', longPressStreamer, event);
    }
    longPressStartPoint = null;
    cleanupFolderStreamerListeners();
  }
};

const handleFolderStreamerMouseDown = (streamer: FollowedStreamer, event: MouseEvent) => {
  if (props.globalDragging) return;
  event.preventDefault();
  longPressTriggered = false;
  longPressDragStarted = false;
  longPressStartPoint = { x: event.clientX, y: event.clientY };
  longPressStreamer = streamer;
  clearLongPress();
  cleanupFolderStreamerListeners();
  document.addEventListener('mousemove', handleFolderStreamerMouseMove);
  document.addEventListener('mouseup', handleFolderStreamerMouseUp);
  longPressTimer = window.setTimeout(() => {
    longPressTriggered = true;
    longPressDragStarted = true;
    emit('streamerDragStart', streamer, event);
    longPressStartPoint = null;
    cleanupFolderStreamerListeners();
  }, LONG_PRESS_MS_FOL);
};

const handleFolderStreamerMouseUp = () => {
  clearLongPress();
  longPressStartPoint = null;
  longPressStreamer = null;
  cleanupFolderStreamerListeners();
};

const getStreamerItemClass = (streamer: FollowedStreamer) => {
  return {
    'status-live': streamer.liveStatus === 'LIVE',
    'status-replay': streamer.liveStatus === 'REPLAY',
    'status-offline': streamer.liveStatus === 'OFFLINE' || !streamer.liveStatus || streamer.liveStatus === 'UNKNOWN',
  };
};

</script>
