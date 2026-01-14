<template>
    <button type="button" class="
      inline-flex items-center justify-center whitespace-nowrap select-none
      rounded-full px-4 py-2 text-sm leading-none
       transition border-white/15 bg-neutral-700/70 cursor-pointer hover:bg-neutral-700
      active:scale-[0.98]
    " :class="active
        ? 'bg-white/15 border-white/30 text-white'
        : ''" @click="$emit('click')">
        <slot />
    </button>
</template>

<script setup lang="ts">
defineProps({
    active: { type: Boolean, default: false },
})
defineEmits(['click'])
</script>