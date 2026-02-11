<template>
  <div class="win-controls" data-tauri-drag-region="none">
    <button
      type="button"
      class="win-control win-control--minimize"
      @mousedown="preventWindowDrag"
      @click="handleMinimize"
      aria-label="最小化窗口"
      data-tauri-drag-region="none"
    >
      <svg class="win-icon" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 6h8" />
      </svg>
    </button>
    <button
      type="button"
      class="win-control win-control--maximize"
      @mousedown="preventWindowDrag"
      @click="handleMaximize"
      :aria-label="isMaximized ? '还原窗口' : '最大化窗口'"
      data-tauri-drag-region="none"
    >
      <svg v-if="!isMaximized" class="win-icon" viewBox="0 0 12 12" aria-hidden="true">
        <rect x="2" y="2" width="8" height="8" rx="1" ry="1" />
      </svg>
      <svg v-else class="win-icon is-restore" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M4 2h6v6h-2" />
        <rect x="2" y="4" width="6" height="6" rx="1" ry="1" />
      </svg>
    </button>
    <button
      type="button"
      class="win-control win-control--close"
      @mousedown="preventWindowDrag"
      @click="handleClose"
      aria-label="关闭窗口"
      data-tauri-drag-region="none"
    >
      <svg class="win-icon" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3.25 3.25l5.5 5.5M8.75 3.25l-5.5 5.5" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { UnlistenFn } from '@tauri-apps/api/event';

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
    console.error('[WindowsWindowControls] Failed to query maximized state', error);
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
    console.error('[WindowsWindowControls] Failed to minimize window', error);
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
    console.error('[WindowsWindowControls] Failed to toggle maximize', error);
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
    console.error('[WindowsWindowControls] Failed to close window', error);
  }
};

onMounted(async () => {
  await syncMaximizedState();
  try {
    unlistenResize = await currentWindow.onResized(() => {
      syncMaximizedState();
    });
  } catch (error) {
    console.error('[WindowsWindowControls] Failed to listen for resize events', error);
  }
});

onBeforeUnmount(async () => {
  if (unlistenResize) {
    await unlistenResize();
    unlistenResize = null;
  }
});
</script>

<style scoped>
.win-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border-radius: 0;
  overflow: visible;
  height: 40px;
  width: auto;
  box-shadow: none;
  border: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  -webkit-app-region: no-drag;
}

.win-control {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: rgba(232, 240, 255, 0.92);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease, transform 0.12s ease;
  -webkit-app-region: no-drag;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.win-control:focus-visible {
  outline: 2px solid rgba(88, 142, 255, 0.8);
  outline-offset: -2px;
}

.win-control:hover {
  background-color: rgba(240, 244, 248, 0.9);
  transform: translateY(-0.5px);
}

.win-control:active {
  background-color: rgba(230, 235, 242, 0.9);
  transform: translateY(0);
}

.win-control--close {
  color: rgba(255, 255, 255, 0.92);
}

.win-control--close:hover {
  background-color: rgba(232, 17, 35, 0.88);
  color: #ffffff;
}

.win-control--close:active {
  background-color: rgba(197, 15, 31, 0.95);
  color: #ffffff;
}

.win-icon {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.15;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  shape-rendering: geometricPrecision;
}

.win-control--close .win-icon {
  width: 16px;
  height: 16px;
  stroke-linecap: square;
  stroke-width: 1.1;
}

.win-icon.is-restore path:first-of-type {
  fill: none;
}

:global(:root[data-theme="light"] .win-controls .win-control) {
  color: #1f2937;
  background: transparent;
  box-shadow: none;
}

:global(:root[data-theme="light"] .win-controls .win-control:hover) {
  background-color: rgba(236, 240, 244, 0.95);
}

:global(:root[data-theme="light"] .win-controls .win-control:active) {
  background-color: rgba(226, 232, 240, 0.9);
}

:global(:root[data-theme="light"] .win-controls .win-control--close) {
  color: #1f2937;
}

:global(:root[data-theme="light"] .win-controls .win-control--close:hover) {
  background-color: rgba(232, 17, 35, 0.9);
  color: #ffffff;
}

:global(:root[data-theme="light"] .win-controls .win-control--close:active) {
  background-color: rgba(197, 15, 31, 0.95);
  color: #ffffff;
}

</style>
