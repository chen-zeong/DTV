<template>
  <div
    class="group relative flex items-center gap-2 rounded-full border border-border-main py-1 pl-1 pr-2 shadow-sm transition-all cursor-pointer select-none"
    :class="isActive 
      ? 'bg-brand/10 border-brand/30 ring-1 ring-brand/20' 
      : 'bg-surface-high/40 hover:bg-surface-high border-transparent'"
    draggable="true"
    @dragstart="$emit('dragstart', $event)"
    @dragover.prevent
    @click="$emit('select')"
  >
    <!-- Avatar -->
    <div class="relative h-6 w-6 flex-shrink-0">
      <img
        v-if="avatar"
        :src="avatar"
        :alt="anchorName"
        class="h-full w-full rounded-full object-cover"
      />
      <div
        v-else
        class="flex h-full w-full items-center justify-center rounded-full bg-surface-mid text-[10px] font-bold text-text-muted"
      >
        {{ anchorName?.[0] || "?" }}
      </div>
      <!-- Live Indicator -->
      <span v-if="isLive" class="absolute -right-0.5 -bottom-0.5 flex size-2">
        <span class="relative inline-flex h-2 w-2 rounded-full bg-green-500 ring-1 ring-surface-high"></span>
      </span>
    </div>

    <!-- Info -->
    <div class="flex max-w-[100px] flex-col justify-center overflow-hidden">
      <div
        class="truncate text-[11px] font-bold text-text-main"
        :class="{ 'text-brand': isActive }"
      >
        {{ anchorName }}
      </div>
    </div>

    <!-- Actions -->
    <div class="flex items-center opacity-0 group-hover:opacity-100 transition-all">
      <!-- Mute Button -->
      <button
        @click.stop="$emit('toggle-mute')"
        class="flex size-5 items-center justify-center rounded-full text-text-muted hover:bg-surface-mid hover:text-text-main"
        :title="isMuted ? '取消静音' : '静音'"
      >
        <VolumeX v-if="isMuted" :size="12" stroke-width="2.5" class="text-red-500" />
        <Volume2 v-else :size="12" stroke-width="2.5" />
      </button>

      <!-- Close Button -->
      <button
        @click.stop="$emit('close')"
        class="flex size-5 items-center justify-center rounded-full text-text-muted hover:bg-red-500/10 hover:text-red-500"
        title="关闭直播间"
      >
        <X :size="12" stroke-width="3" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { X, Volume2, VolumeX } from "lucide-vue-next";
import type { Platform } from "../../types/app/platform";

defineProps<{
  roomId: string;
  platform: Platform;
  anchorName: string;
  avatar: string;
  isLive: boolean;
  isActive: boolean;
  isMuted: boolean;
}>();

defineEmits<{
  (e: "select"): void;
  (e: "close"): void;
  (e: "toggle-mute"): void;
  (e: "dragstart", event: DragEvent): void;
}>();
</script>
