<template>
  <div class="flex h-full w-full items-center justify-center bg-app-bg text-text-muted">
    <!-- 
      MultiView Page
      The actual video grid is rendered by features/player/components/PlayerManager.vue 
      which overlays this view when route.name === 'MultiView'.
    -->
    <div class="flex flex-col items-center gap-4 opacity-50">
      <p class="text-sm">分屏监控模式运行中</p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({
  name: "MultiView",
});
</script>
