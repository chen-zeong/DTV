<template>
  <div 
    class="fixed inset-0 z-10"
    :class="{
      'bg-black': isPlayerRoute || isMultiView,
      'pointer-events-none opacity-0 -z-10': !isPlayerRoute && !isMultiView
    }"
    :style="{ 
      top: isPlayerFullscreen ? '0' : 'var(--navbar-height)',
    }"
  >
    <!-- Unified Container -->
    <div 
      class="w-full h-full p-2 gap-2"
      :class="isMultiView ? ('grid ' + gridClasses) : 'block'"
    >
      <!-- Active Players -->
      <div 
        v-for="(s, index) in playerStore.activeStreamers" 
        :key="`${s.platform}:${s.roomId}`"
        class="bg-neutral-900 overflow-hidden relative transition-all duration-300"
        :class="getWrapperClass(s, index)"
        v-show="shouldShowWrapper(s, index)"
      >
        <VideoPlayer
          :room-id="s.roomId"
          :platform="s.platform"
          :is-followed="followStore.isFollowed(s.platform, s.roomId)"
          :title="s.title"
          :anchor-name="s.anchorName"
          :avatar="s.avatar"
          :is-live="s.isLive"
          :is-active="isCurrentPlayer(s) || isMultiView"
          @follow="handleFollow"
          @unfollow="handleUnfollow"
          @fullscreen-change="handleFullscreenChange"
        />
      </div>

      <!-- Empty Slots (Only in MultiView) -->
      <template v-if="isMultiView">
        <div 
          v-for="i in Math.max(0, playerStore.gridMode - playerStore.activeStreamers.length)" 
          :key="`empty-${i}`"
          class="flex flex-col items-center justify-center bg-surface-low/10 text-text-muted rounded-xl border-2 border-border-main border-dashed"
        >
          <div class="rounded-full bg-surface-mid p-4 mb-2">
            <component :is="LayoutGrid" :size="32" class="opacity-50" />
          </div>
          <span class="text-xs font-bold opacity-50">空闲窗口</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { usePlayerStore } from "../../../store/playerStore";
import { useFollowStore } from "../../../store/followStore";
import VideoPlayer from "./VideoPlayer.vue";
import type { FollowedStreamer } from "../../../types/models/streamer";
import { LayoutGrid } from "lucide-vue-next";

const playerStore = usePlayerStore();
const followStore = useFollowStore();
const route = useRoute();

const isPlayerFullscreen = computed(() => {
  return false; 
});

const isPlayerRoute = computed(() => route.name === "StreamRoom");
const isMultiView = computed(() => route.name === "MultiView");

const gridClasses = computed(() => {
  switch (playerStore.gridMode) {
    case 6: return 'grid-cols-3 grid-rows-2';
    case 9: return 'grid-cols-3 grid-rows-3';
    case 4: default: return 'grid-cols-2 grid-rows-2';
  }
});

const isCurrentPlayer = (s: any) => {
  if (!isPlayerRoute.value) return false;
  const routePlatform = route.params.platform?.toString().toLowerCase();
  const routeRoomId = route.params.roomId?.toString();
  return (
    routePlatform === s.platform.toLowerCase() &&
    routeRoomId === s.roomId
  );
};

const shouldShowWrapper = (s: any, index: number) => {
  if (isMultiView.value) return index < playerStore.gridMode;
  if (isPlayerRoute.value) return isCurrentPlayer(s);
  return false;
};

const getWrapperClass = (_s: any, _index: number) => {
  if (isMultiView.value) {
    return 'rounded-lg border-2 border-brand/50 bg-black shadow-lg';
  }
  if (isPlayerRoute.value) {
    return 'absolute inset-0';
  }
  return '';
};


const handleFollow = (streamer: FollowedStreamer) => {
  followStore.followStreamer(streamer);
};

const handleUnfollow = (roomId: string) => {
  const streamer = playerStore.activeStreamers.find(s => s.roomId === roomId);
  if (streamer) {
    followStore.unfollowStreamer(streamer.platform, streamer.roomId);
  }
};

const emit = defineEmits(["fullscreen-change"]);
const handleFullscreenChange = (v: boolean) => {
  emit("fullscreen-change", v);
};
</script>

<style scoped>
.global-player-manager {
  /* Ensure it doesn't block interactions when hidden */
}
</style>
