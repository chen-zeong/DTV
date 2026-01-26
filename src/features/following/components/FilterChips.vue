<template>
  <div class="flex items-center gap-2.5 px-1.5">
    <button
      class="rounded-[12px] border px-3.5 py-1.5 text-[12px] font-bold tracking-[0.02em] hover:-translate-y-0.5"
      :class="
        activeFilter === 'ALL'
          ? '-translate-y-0.5 bg-[var(--bg-secondary)]'
          : ''
      "
      @click="$emit('update:activeFilter', 'ALL')"
    >
      全部
    </button>
    <button
      v-for="p in visiblePlatforms"
      :key="p"
      class="rounded-[12px] border px-3.5 py-1.5 text-[12px] font-bold tracking-[0.02em] hover:-translate-y-0.5"
      :class="
        activeFilter === p ? '-translate-y-0.5 bg-[var(--bg-secondary)]' : ''
      "
      @click="$emit('update:activeFilter', p)"
    >
      {{ platformLabel(p) }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { Platform } from "../../../types/app/platform";

defineProps<{
  visiblePlatforms: Platform[];
  activeFilter: "ALL" | Platform;
}>();

const platformLabel = (p: Platform): string => {
  switch (p) {
    case Platform.DOUYU:
      return "斗鱼";
    case Platform.DOUYIN:
      return "抖音";
    case Platform.HUYA:
      return "虎牙";
    case Platform.BILIBILI:
      return "B站";
    default:
      return "未知";
  }
};
</script>
