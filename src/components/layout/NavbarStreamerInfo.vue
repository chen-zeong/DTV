<template>
  <div
    class="group flex items-center gap-2.5 rounded-full border border-border-main bg-surface-high/50 py-1 pr-3 pl-1 shadow-sm backdrop-blur-md transition-all hover:bg-surface-high hover:shadow-md dark:bg-neutral-800/80"
  >
    <!-- Avatar with Live Status Ring -->
    <div class="relative h-8 w-8 flex-shrink-0">
      <img
        v-if="avatar"
        :src="avatar"
        :alt="anchorName"
        class="h-full w-full rounded-full object-cover ring-2 ring-surface-mid"
      />
      <div
        v-else
        class="flex h-full w-full items-center justify-center rounded-full bg-surface-mid text-xs font-bold text-text-muted"
      >
        {{ anchorName?.[0] || "?" }}
      </div>

      <!-- Live Indicator Dot -->
      <span v-if="isLive" class="absolute -right-0.5 -bottom-0.5 flex size-2.5">
        <span
          class="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"
        ></span>
        <span
          class="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500 ring-1 ring-surface-high"
        ></span>
      </span>
    </div>

    <!-- Text Info -->
    <div class="flex max-w-[140px] flex-col justify-center gap-0.5">
      <div
        class="truncate text-xs leading-none font-bold text-text-main"
        :title="title"
      >
        {{ title || "暂无标题" }}
      </div>
      <div
        class="flex items-center gap-1.5 text-[10px] leading-none text-text-muted"
      >
        <span class="truncate font-medium">{{ anchorName }}</span>
        <span class="h-2 w-[1px] bg-border-main"></span>
        <span
          class="font-black tracking-wider uppercase"
          :style="{ color: platformColor }"
        >
          {{ platformName }}
        </span>
      </div>
    </div>

    <!-- Follow Button (Revealed on Hover) -->
    <button
      @click.stop="toggleFollow"
      class="group-hover:bg-surface-higher ml-1 flex size-0 items-center justify-center overflow-hidden rounded-full bg-surface-mid text-text-muted transition-all duration-300 group-hover:size-7 hover:!bg-brand/10 hover:!text-brand"
      :class="{ '!bg-brand/10 !text-brand': isFollowed }"
      :title="isFollowed ? '取消关注' : '关注'"
    >
      <Heart
        :size="14"
        :fill="isFollowed ? 'currentColor' : 'none'"
        :class="{ 'animate-pulse': !isFollowed }"
      />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Platform } from "../../platforms/common/types";
import { useFollowStore } from "../../stores/followStore";
import { Heart } from "lucide-vue-next";

const props = defineProps<{
  roomId: string;
  platform: Platform;
  title: string;
  anchorName: string;
  avatar: string;
  isLive: boolean;
}>();

const followStore = useFollowStore();

const isFollowed = computed(() => {
  return followStore.isFollowed(props.platform, props.roomId);
});

const toggleFollow = () => {
  if (isFollowed.value) {
    followStore.unfollowStreamer(props.platform, props.roomId);
  } else {
    followStore.followStreamer({
      id: props.roomId,
      platform: props.platform,
      nickname: props.anchorName,
      avatarUrl: props.avatar,
      roomTitle: props.title,
      isLive: props.isLive,
      liveStatus: props.isLive ? "LIVE" : "OFFLINE",
    });
  }
};

const platformName = computed(() => {
  switch (props.platform) {
    case Platform.DOUYU:
      return "斗鱼";
    case Platform.DOUYIN:
      return "抖音";
    case Platform.HUYA:
      return "虎牙";
    case Platform.BILIBILI:
      return "B站";
    default:
      return props.platform;
  }
});

const platformColor = computed(() => {
  switch (props.platform) {
    case Platform.DOUYU:
      return "#ff7a1c";
    case Platform.DOUYIN:
      return "#fe2c55";
    case Platform.HUYA:
      return "#f5a623";
    case Platform.BILIBILI:
      return "#fb7299";
    default:
      return "currentColor";
  }
});
</script>
