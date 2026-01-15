<template>
  <div
    class="flex h-8 w-[138px] items-stretch overflow-hidden bg-transparent shadow-none [-webkit-app-region:no-drag]"
    data-tauri-drag-region="none"
  >
    <button
      type="button"
      class="flex h-8 w-[46px] items-center justify-center bg-transparent [-webkit-app-region:no-drag] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[rgba(88,142,255,0.8)]"
      @mousedown="preventWindowDrag"
      @click="handleMinimize"
      aria-label="最小化窗口"
      data-tauri-drag-region="none"
    >
      <svg
        class="h-[14px] w-[14px] fill-none stroke-current stroke-[1.15] [shape-rendering:geometricPrecision] [stroke-linecap:round] [stroke-linejoin:round] [vector-effect:non-scaling-stroke]"
        viewBox="0 0 12 12"
        aria-hidden="true"
      >
        <path d="M2 6h8" />
      </svg>
    </button>
    <button
      type="button"
      class="flex h-8 w-[46px] items-center justify-center bg-transparent [-webkit-app-region:no-drag] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[rgba(88,142,255,0.8)]"
      @mousedown="preventWindowDrag"
      @click="handleMaximize"
      :aria-label="isMaximized ? '还原窗口' : '最大化窗口'"
      data-tauri-drag-region="none"
    >
      <svg
        v-if="!isMaximized"
        class="h-[14px] w-[14px] fill-none stroke-current stroke-[1.15] [shape-rendering:geometricPrecision] [stroke-linecap:round] [stroke-linejoin:round] [vector-effect:non-scaling-stroke]"
        viewBox="0 0 12 12"
        aria-hidden="true"
      >
        <rect x="2" y="2" width="8" height="8" rx="1" ry="1" />
      </svg>
      <svg
        v-else
        class="h-[14px] w-[14px] fill-none stroke-current stroke-[1.15] [shape-rendering:geometricPrecision] [stroke-linecap:round] [stroke-linejoin:round] [vector-effect:non-scaling-stroke]"
        viewBox="0 0 12 12"
        aria-hidden="true"
      >
        <path d="M4 2h6v6h-2" />
        <rect x="2" y="4" width="6" height="6" rx="1" ry="1" />
      </svg>
    </button>
    <button
      type="button"
      class="flex h-8 w-[46px] items-center justify-center bg-transparent [-webkit-app-region:no-drag] hover:bg-[#e81123] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[rgba(88,142,255,0.8)] active:bg-[#c50f1f] active:text-white"
      @mousedown="preventWindowDrag"
      @click="handleClose"
      aria-label="关闭窗口"
      data-tauri-drag-region="none"
    >
      <svg
        class="h-[15px] w-[15px] fill-none stroke-current stroke-[1.1] [shape-rendering:geometricPrecision] [stroke-linecap:square] [stroke-linejoin:round] [vector-effect:non-scaling-stroke]"
        viewBox="0 0 12 12"
        aria-hidden="true"
      >
        <path d="M3.25 3.25l5.5 5.5M8.75 3.25l-5.5 5.5" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";

const currentWindow = getCurrentWindow();
const isMaximized = ref(false);
let unlistenResize: UnlistenFn | null = null;

const preventWindowDrag = (event: MouseEvent | PointerEvent) => {
  event.stopPropagation();
};

const syncMaximizedState = async () => {
  try {
    isMaximized.value = await currentWindow.isMaximized();
  } catch (error) {
    console.error(
      "[WindowsWindowControls] Failed to query maximized state",
      error,
    );
  }
};

const handleMinimize = async (event?: MouseEvent) => {
  if (event) {
    preventWindowDrag(event);
    event.preventDefault();
  }
  try {
    await currentWindow.minimize();
  } catch (error) {
    console.error("[WindowsWindowControls] Failed to minimize window", error);
  }
};

const handleMaximize = async (event?: MouseEvent) => {
  if (event) {
    preventWindowDrag(event);
    event.preventDefault();
  }
  try {
    if (isMaximized.value) {
      await currentWindow.unmaximize();
    } else {
      await currentWindow.maximize();
    }
    await syncMaximizedState();
  } catch (error) {
    console.error("[WindowsWindowControls] Failed to toggle maximize", error);
  }
};

const handleClose = async (event?: MouseEvent) => {
  if (event) {
    preventWindowDrag(event);
    event.preventDefault();
  }
  try {
    await currentWindow.close();
  } catch (error) {
    console.error("[WindowsWindowControls] Failed to close window", error);
  }
};

onMounted(async () => {
  await syncMaximizedState();
  try {
    unlistenResize = await currentWindow.onResized(() => {
      syncMaximizedState();
    });
  } catch (error) {
    console.error(
      "[WindowsWindowControls] Failed to listen for resize events",
      error,
    );
  }
});

onBeforeUnmount(async () => {
  if (unlistenResize) {
    await unlistenResize();
    unlistenResize = null;
  }
});
</script>
