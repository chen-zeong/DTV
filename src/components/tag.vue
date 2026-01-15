<template>
  <button
    type="button"
    class="inline-flex cursor-pointer items-center justify-center rounded-full border px-4 py-2 text-xs leading-none font-bold whitespace-nowrap select-none active:scale-[0.98]"
    :class="
      active
        ? 'border-text-main bg-text-main text-app-bg shadow-md'
        : 'border-border-main bg-surface-high/50 text-text-muted hover:border-border-strong hover:bg-surface-high hover:text-text-main'
    "
    @click="$emit('click')"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
defineProps({
  active: { type: Boolean, default: false },
});
defineEmits(["click"]);
</script>
