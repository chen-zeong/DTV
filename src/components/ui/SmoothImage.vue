<template>
  <div class="relative flex items-center justify-center overflow-hidden">
    <div
      v-if="!isLoaded && !isError"
      class="absolute inset-0 z-10 h-full w-full animate-pulse bg-[rgba(255,255,255,0.08)]"
    ></div>
    <div v-if="isError" class="flex h-full w-full items-center justify-center">
      <slot name="error">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="opacity-50"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </slot>
    </div>
    <img
      v-show="isLoaded"
      :src="src"
      :alt="alt"
      :class="['block h-full w-full object-cover', imgClass]"
      @load="handleLoad"
      @error="handleError"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  src: string;
  alt?: string;
  imgClass?: string;
}>();

const isLoaded = ref(false);
const isError = ref(false);

const handleLoad = () => {
  isLoaded.value = true;
  isError.value = false;
};

const handleError = () => {
  isLoaded.value = false;
  isError.value = true;
};

// Reset state when src changes
watch(
  () => props.src,
  () => {
    isLoaded.value = false;
    isError.value = false;
  },
);
</script>
