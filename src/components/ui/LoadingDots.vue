<template>
  <div
    class="inline-flex items-center gap-2.5"
    role="status"
    aria-live="polite"
    aria-label="加载中"
  >
    <span class="h-2.5 w-2.5 animate-bounce rounded-full bg-brand"></span>
    <span
      class="h-2.5 w-2.5 animate-bounce rounded-full bg-brand"
      style="animation-delay: 0.15s"
    ></span>
    <span
      class="h-2.5 w-2.5 animate-bounce rounded-full bg-brand"
      style="animation-delay: 0.3s"
    ></span>
  </div>
</template>

<script setup lang="ts"></script>
