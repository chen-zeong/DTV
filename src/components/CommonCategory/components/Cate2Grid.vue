<template>
  <div class="cate2-container">
    <div
      class="cate2-content"
      :class="{ 'is-expanded': isExpandedInternal, 'scrollable': isExpandedInternal && hasMoreRowsInternal }"
      ref="cate2ContentRef"
    >
      <div class="cate2-scroll-wrapper" :class="{ 'allow-scroll': isExpandedInternal && hasMoreRowsInternal }">
        <div class="cate2-grid" ref="cate2GridRef">
          <div
            v-for="cate2 in cate2List"
            :key="cate2.href"
            class="cate2-card"
            :class="{ 'active': selectedCate2Href === cate2.href }"
            @click="$emit('select', cate2)"
          >
            <div class="cate2-name" :title="cate2.title">{{ cate2.title }}</div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="shouldShowExpandButtonInternal" class="expand-button" @click="handleToggleInternalExpand">
      <span>{{ isExpandedInternal ? '收起' : '展开' }}</span>
      <svg
        class="expand-icon"
        :class="{ 'is-expanded': isExpandedInternal }"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
      >
        <path d="M6 9l6 6 6-6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed, nextTick } from 'vue'
import type { Category2 } from '../../../platforms/common/categoryTypes.ts'

const props = defineProps<{
  cate2List: Category2[]
  selectedCate2Href: string | null
  isExpanded: boolean
}>()

const emit = defineEmits<{
  (e: 'select', cate2: Category2): void
  (e: 'toggle-expand'): void
  (e: 'height-changed'): void
}>()

const CARD_ACTUAL_HEIGHT = 36;
const GRID_VERTICAL_GAP = 12;
const CONTENT_PADDING_BOTTOM = 6;
const GRID_INTERNAL_PADDING_BOTTOM = 12;

const TARGET_CONTENT_HEIGHT_FOR_ONE_ROW = CARD_ACTUAL_HEIGHT + GRID_INTERNAL_PADDING_BOTTOM + CONTENT_PADDING_BOTTOM;
const TARGET_CONTENT_HEIGHT_FOR_TWO_ROWS = (2 * CARD_ACTUAL_HEIGHT + GRID_VERTICAL_GAP) + GRID_INTERNAL_PADDING_BOTTOM + CONTENT_PADDING_BOTTOM - 14;
const EXPANDED_CONTENT_MAX_ROWS = 7;
const TARGET_CONTENT_HEIGHT_FOR_EXPANDED_MAX_ROWS = 
    (EXPANDED_CONTENT_MAX_ROWS * CARD_ACTUAL_HEIGHT + (EXPANDED_CONTENT_MAX_ROWS - 1) * GRID_VERTICAL_GAP) 
    + GRID_INTERNAL_PADDING_BOTTOM + CONTENT_PADDING_BOTTOM;

const cate2ContentRef = ref<HTMLElement | null>(null)
const cate2GridRef = ref<HTMLElement | null>(null)
const isExpandedInternal = ref(props.isExpanded)
const actualGridScrollHeight = ref(0)
const hasMoreRowsInternal = ref(false)

const refreshHeightNonAnimated = () => {
  if (cate2ContentRef.value) {
    cate2ContentRef.value.style.height = `${getCurrentTargetHeight(isExpandedInternal.value)}px`;
    nextTick(() => emit('height-changed'));
  }
};

const updateActualGridScrollHeightAndMoreRows = () => {
  nextTick(() => {
    if (cate2GridRef.value) {
      actualGridScrollHeight.value = cate2GridRef.value.scrollHeight;
    } else {
      actualGridScrollHeight.value = GRID_INTERNAL_PADDING_BOTTOM;
    }
    hasMoreRowsInternal.value = requiredHeightForAllGridItemsWithPadding.value > TARGET_CONTENT_HEIGHT_FOR_EXPANDED_MAX_ROWS;
    refreshHeightNonAnimated();
  });
};

watch(() => props.cate2List, () => {
  updateActualGridScrollHeightAndMoreRows();
  refreshHeightNonAnimated();
}, { deep: true });

watch(() => props.isExpanded, (newVal) => {
  if (isExpandedInternal.value !== newVal) {
    isExpandedInternal.value = newVal;
    refreshHeightNonAnimated();
  }
});

onMounted(() => {
  isExpandedInternal.value = props.isExpanded;
  updateActualGridScrollHeightAndMoreRows();
});

const requiredHeightForAllGridItemsWithPadding = computed(() => {
  return actualGridScrollHeight.value + CONTENT_PADDING_BOTTOM;
});

const shouldShowExpandButtonInternal = computed(() => {
  return requiredHeightForAllGridItemsWithPadding.value > TARGET_CONTENT_HEIGHT_FOR_TWO_ROWS;
});

const getCurrentTargetHeight = (expandedState: boolean) => {
  const naturalContentHeight = requiredHeightForAllGridItemsWithPadding.value;
  if (expandedState) {
    if (hasMoreRowsInternal.value) {
      return TARGET_CONTENT_HEIGHT_FOR_EXPANDED_MAX_ROWS;
    }
    return props.cate2List.length > 0 ? naturalContentHeight : GRID_INTERNAL_PADDING_BOTTOM + CONTENT_PADDING_BOTTOM; 
  } else {
    if (naturalContentHeight <= TARGET_CONTENT_HEIGHT_FOR_ONE_ROW) {
      return naturalContentHeight;
    }
    return TARGET_CONTENT_HEIGHT_FOR_TWO_ROWS;
  }
};

const handleToggleInternalExpand = () => {
  emit('toggle-expand'); 
};
</script>

<style scoped>
.cate2-container {
  padding: 8px 8px 6px;
  display: flex;
  flex-direction: column;
  flex: 1;
  position: relative;
  overflow: visible;
  background: transparent;
}

.cate2-content {
  position: relative;
  height: 0;
  padding-bottom: 6px;
  overflow: hidden;
  transition: none;
}

.cate2-content::after {
  content: none;
}

.cate2-scroll-wrapper {
  max-height: 100%;
  overflow: hidden;
}

.cate2-scroll-wrapper.allow-scroll {
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.cate2-scroll-wrapper.allow-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.cate2-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 10px;
  justify-content: flex-start;
  padding-bottom: 12px;
}

.cate2-card {
  min-height: 36px;
  padding: 4px 6px;
  width: 100%;
  border-radius: 16px;
  cursor: pointer;
  transition: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-tertiary);
  border: none;
  color: var(--text-secondary);
  box-shadow: none;
}

.cate2-card:hover {
  color: var(--text-primary);
  box-shadow: none;
}

.cate2-card.active {
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-weight: 600;
  box-shadow: none;
}

.cate2-name {
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
}

.cate2-card.active {
  /* theme-aware selected state uses glass background */
}

:root[data-theme="dark"] .cate2-card {
  color: #cbd5d1;
}

:root[data-theme="dark"] .cate2-card:not(.active) {
  background: rgba(50, 56, 60, 0.82);
  border: none;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    inset 0 -1px 0 rgba(0, 0, 0, 0.22);
}

:root[data-theme="dark"] .cate2-card:hover:not(.active) {
  background: rgba(56, 63, 67, 0.86);
  border: none;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    inset 0 -1px 0 rgba(0, 0, 0, 0.24);
}

:root[data-theme="light"] .cate2-card {
  color: #6c7270;
}

:root[data-theme="light"] .cate2-card.active {
  color: #1f2937;
  box-shadow:
    0 6px 14px rgba(15, 23, 42, 0.08),
    0 2px 6px rgba(15, 23, 42, 0.06);
}

:root[data-theme="dark"] .cate2-card.active {
  background: rgba(145, 154, 160, 0.28);
  border-style: solid;
  border-width: 0.75px 0.35px;
  border-color: rgba(237, 244, 248, 0.34);
  color: #f6fbf7;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    0 1px 4px rgba(0, 0, 0, 0.1);
}

.expand-button {
  position: relative;
  align-self: center;
  margin-top: -6px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--secondary-text);
  cursor: pointer;
  border-radius: 999px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  transition: all 0.2s ease;
  z-index: 5;
  box-shadow: var(--shadow-low);
}

.expand-button:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

:root[data-theme="dark"] .expand-button {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-secondary);
}

:root[data-theme="dark"] .expand-button:hover {
  background: rgba(255, 255, 255, 0.16);
  color: var(--text-primary);
}

.expand-icon {
  margin-left: 2px;
  width: 12px;
  height: 12px;
}

.expand-icon.is-expanded {
  transform: rotate(180deg);
}

.cate2-card img {
  width: 24px;
  height: 24px;
  object-fit: cover;
  border-radius: 4px;
}
</style>
