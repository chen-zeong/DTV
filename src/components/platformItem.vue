<template>
    <button type="button"
        class="flex relative rounded w-full h-16 bg-neutral-800 hover:bg-neutral-800/30 cursor-pointer">
        <div class="size-16 aspect-square rounded absolute bg-amber-500"></div>
        <slot class="flex-1 font-medium text-md z-100 pl-32" />
    </button>
</template>

<script setup lang="ts">
defineProps({
    active: { type: Boolean, default: false },
})
defineEmits(['click'])
</script>