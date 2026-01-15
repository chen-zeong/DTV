<template>
  <button
    type="button"
    class="group relative flex h-14 w-full cursor-pointer overflow-hidden rounded-lg border border-border-main bg-surface-mid shadow-sm hover:bg-surface-high"
  >
    <div
      class="aspect-square size-14 rounded-l-lg bg-brand group-hover:scale-110"
    ></div>
    <div
      class="flex flex-1 items-center pl-4 text-sm font-bold text-text-main group-hover:text-brand"
    >
      <slot />
    </div>
  </button>
</template>

<script setup lang="ts">
defineProps({
  active: { type: Boolean, default: false },
});
defineEmits(["click"]);
</script>
