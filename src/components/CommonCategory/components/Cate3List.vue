<template>
  <div v-if="!isLoading && (cate3List.length > 0 || hasAllOption)" class="cate3-list">
    <div
      class="cate3-item"
      :class="{ active: selectedCate3Id === null || selectedCate3Id === 'all' }"
      @click="selectAll"
    >
      全部
    </div>
    <div
      v-for="cate3 in cate3List"
      :key="cate3.id"
      class="cate3-item"
      :class="{ active: selectedCate3Id === cate3.id }"
      @click="$emit('select', cate3)"
    >
      {{ cate3.name }}
    </div>
  </div>
  <div v-if="isLoading" class="loading-cate3">正在加载三级分类...</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type Category3 = {
  id: string
  name: string
}

const props = defineProps<{
  cate3List: Category3[]
  selectedCate3Id: string | null
  isLoading: boolean
}>()

const emit = defineEmits<{
  (e: 'select', cate3: Category3): void
}>()

const hasAllOption = computed(() => {
  return props.cate3List && props.cate3List.length > 0
})

const selectAll = () => {
  const allCategory: Category3 = {
    id: 'all',
    name: '全部'
  }
  emit('select', allCategory)
}
</script>

<style scoped>
.cate3-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 6px 8px 0 8px;
  padding-bottom: 8px;
}

.cate3-item {
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  font-size: 11.5px;
  font-weight: 700;
  background: var(--bg-tertiary);
  border: none;
  color: var(--text-secondary);
  box-shadow: var(--shadow-low);
}

.cate3-item:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  transform: translateY(-1px);
}

.cate3-item.active {
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-weight: 600;
  box-shadow: var(--shadow-md);
}

.loading-cate3 {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 10px;
  color: var(--cate3-loading-text-dark, rgba(255, 255, 255, 0.5));
  font-size: 13px;
}

:root[data-theme="light"] .loading-cate3 {
  color: var(--main-text-secondary-light, #495057);
}

:root[data-theme="light"] .cate3-item {
  color: #6c7270;
}

:root[data-theme="light"] .cate3-item.active {
  color: #1f2937;
  box-shadow:
    0 6px 14px rgba(15, 23, 42, 0.08),
    0 2px 6px rgba(15, 23, 42, 0.06);
}

:root[data-theme="dark"] .cate3-item:not(.active) {
  background: rgba(50, 56, 60, 0.82);
  border: none;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    inset 0 -1px 0 rgba(0, 0, 0, 0.22);
}

:root[data-theme="dark"] .cate3-item:hover:not(.active) {
  background: rgba(56, 63, 67, 0.86);
  border: none;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    inset 0 -1px 0 rgba(0, 0, 0, 0.24);
}
</style>
