<template>
  <div class="group relative flex w-full select-none items-center justify-start overflow-hidden bg-transparent">
    <div class="flex flex-1 min-w-0 items-center gap-2.5 px-2 py-1" @click="onClick">
      <div ref="avatarRef" class="relative flex-shrink-0 transition-all duration-300"
        :class="big ? 'h-10 w-10' : 'h-8 w-8'">
        <img v-if="shouldLoadAvatar" :src="avatarSrc" :alt="streamer.nickname" loading="lazy" decoding="async"
          fetchpriority="low" @error="handleImgError($event, streamer)"
          class="h-full w-full rounded-full border   object-cover transition-all duration-300">
        <div v-else-if="canLoadAvatar" class="h-full w-full rounded-full border " aria-hidden="true"></div>
        <div v-else class="flex h-full w-full items-center justify-center rounded-full  text-[14px] font-bold">
          {{ streamer.nickname[0] }}</div>
      </div>

      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex items-center">
          <span class="truncate text-[12.5px] font-bold  transition-colors duration-200" :title="streamer.nickname">{{
            streamer.nickname }}</span>
          <!-- 移除左侧平台名，改为右侧胶囊与状态点集成 -->
        </div>
        <div class="truncate text-[11.5px] font-medium  opacity-90 transition-all duration-200  group-hover:opacity-100"
          :title="streamer.roomTitle">
          {{ streamer.roomTitle || '暂无直播标题' }}
        </div>
      </div>
    </div>

    <div class="ml-auto flex flex-shrink-0 items-center pr-3.5">
      <div v-if="showPlatform"
        class="flex items-center gap-1.5 rounded-full border   px-2.5 py-0.5 text-[10px] font-extrabold">
        <span class="h-2 w-2 rounded-full  transition-all duration-300" :class="{
          'bg-[#10b981]': getLiveIndicatorClass(streamer) === 'is-live',
          'bg-[#f59e0b] shadow-[0_0_8px_#f59e0b]': getLiveIndicatorClass(streamer) === 'is-replay',
          'bg-[var(--border-color)]': getLiveIndicatorClass(streamer) === 'is-offline'
        }"></span>
        <span>{{ platformLabel(streamer.platform) }}</span>
      </div>
      <div v-else class="h-2 w-2 rounded-full  transition-all duration-300" :class="{
        'bg-[#10b981]': getLiveIndicatorClass(streamer) === 'is-live',
        'bg-[#f59e0b] shadow-[0_0_8px_#f59e0b]': getLiveIndicatorClass(streamer) === 'is-replay',
        'bg-[var(--border-color)]': getLiveIndicatorClass(streamer) === 'is-offline'
      }"></div>
    </div>
  </div>
</template>


<script setup lang="ts">
import { Platform } from '../../platforms/common/types';
import type { FollowedStreamer } from '../../platforms/common/types';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

const props = defineProps<{
  streamer: FollowedStreamer,
  getAvatarSrc: (s: FollowedStreamer) => string,
  handleImgError: (ev: Event, s: FollowedStreamer) => void,
  getLiveIndicatorClass: (s: FollowedStreamer) => string,
  proxyBase?: string,
  big?: boolean,
  showPlatform?: boolean
}>();

const emit = defineEmits<{ (e: 'clickItem', s: FollowedStreamer): void }>();

const onClick = () => emit('clickItem', props.streamer);

const canLoadAvatar = computed(() => {
  return !!props.streamer.avatarUrl && (props.streamer.platform !== Platform.BILIBILI || !!props.proxyBase);
});

const isAvatarVisible = ref(false);
const avatarRef = ref<HTMLElement | null>(null);
let avatarObserver: IntersectionObserver | null = null;

const setupAvatarObserver = () => {
  if (!canLoadAvatar.value) {
    isAvatarVisible.value = false;
    return;
  }
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
    isAvatarVisible.value = true;
    return;
  }
  if (avatarObserver) {
    avatarObserver.disconnect();
    avatarObserver = null;
  }
  avatarObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (entry?.isIntersecting) {
        isAvatarVisible.value = true;
        avatarObserver?.disconnect();
        avatarObserver = null;
      }
    },
    { rootMargin: '200px' }
  );
  if (avatarRef.value) {
    avatarObserver.observe(avatarRef.value);
  } else {
    isAvatarVisible.value = true;
  }
};

onMounted(setupAvatarObserver);
watch(canLoadAvatar, setupAvatarObserver);
onUnmounted(() => avatarObserver?.disconnect());

const platformLabel = (p: Platform): string => {
  switch (p) {
    case Platform.DOUYU: return '斗鱼';
    case Platform.DOUYIN: return '抖音';
    case Platform.HUYA: return '虎牙';
    case Platform.BILIBILI: return 'B站';
    default: return '未知';
  }
};

const showPlatform = computed(() => !!props.showPlatform);

const shouldLoadAvatar = computed(() => canLoadAvatar.value && isAvatarVisible.value);
const avatarSrc = computed(() => (shouldLoadAvatar.value ? props.getAvatarSrc(props.streamer) : ''));
</script>
