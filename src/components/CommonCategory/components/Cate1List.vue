<template>
  <div class="cate1-list-container">
    <ul class="cate1-list">
      <li
        v-for="cate1 in cate1List"
        :key="cate1.href"
        class="cate1-item"
        :class="{ selected: cate1.href === selectedCate1Href }"
        @click="$emit('select', cate1)"
      >
        <span class="cate1-name">{{ cate1.title }}</span>
      </li>
    </ul>
    <div class="cate1-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Category1 } from '../../../platforms/common/categoryTypes.ts'

defineProps<{
  cate1List: Category1[]
  selectedCate1Href: string | null
}>()
</script>

<style scoped>
.cate1-list-container {
  overflow-x: auto;
  flex-shrink: 0;
  padding: 2px 0 10px;
  transition: all 0.2s ease;
  border: none;
  box-shadow: none;
  position: relative;
}

.cate1-list {
  list-style: none;
  margin: 0;
  padding: 0 8px 6px;
  display: inline-flex;
  gap: 18px;
  flex-wrap: nowrap;
  background: transparent;
  border: none;
  box-shadow: none;
  position: relative;
}

.cate1-item {
  height: 32px;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  transition: color 0.2s ease, transform 0.2s ease;
  font-size: 12.5px;
  font-weight: 500;
  border-radius: 8px;
  white-space: nowrap;
  color: var(--secondary-text);
  background: transparent;
  border: 1px solid transparent;
  box-shadow: none;
  position: relative;
}

.cate1-item:hover {
  color: var(--primary-text);
  background: transparent;
}

.cate1-item.selected {
  background: transparent;
  color: var(--text-primary);
  font-weight: 700;
  transform: translateY(-1px);
  border-color: transparent;
  box-shadow: none;
}

.cate1-item.selected {
  /* selected state */
}

.cate1-item::after {
  content: '';
  position: absolute;
  left: 22%;
  right: 22%;
  bottom: -6px;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.65);
  clip-path: none;
  opacity: 0;
  transform: scaleX(0.6);
  transition: opacity 0.2s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.cate1-item.selected::after {
  opacity: 1;
  transform: scaleX(1);
}

:root[data-theme="light"] .cate1-item::after {
  background: rgba(0, 0, 0, 0.5);
}

:root[data-theme="dark"] .cate1-item {
  color: #cbd5d1;
}

:root[data-theme="light"] .cate1-item {
  color: #5f6563;
}

:root[data-theme="light"] .cate1-item.selected {
  color: #1f2937;
}

:root[data-theme="dark"] .cate1-item.selected {
  color: #f6fbf7;
}

.cate1-name {
  display: inline-block;
  letter-spacing: 0.2px;
}

.cate1-list-container::-webkit-scrollbar {
  height: 0;
}

.cate1-actions {
  position: absolute;
  top: 2px;
  right: 8px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  z-index: 2;
  pointer-events: none;
}

.cate1-actions :deep(*) {
  pointer-events: auto;
}

.cate1-actions :deep(.category-subscribe-btn) {
  height: 28px;
  border-radius: 999px;
  padding: 0 12px;
  font-size: 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(24, 28, 40, 0.6);
  color: rgba(236, 242, 255, 0.9);
  cursor: pointer;
  backdrop-filter: blur(8px) saturate(1.1);
  -webkit-backdrop-filter: blur(8px) saturate(1.1);
  transition: background 0.2s ease, transform 0.2s ease, color 0.2s ease;
}

.cate1-actions :deep(.category-subscribe-btn:hover) {
  background: rgba(42, 48, 64, 0.8);
  color: #ffffff;
  transform: translateY(-1px);
}

.cate1-actions :deep(.category-subscribe-btn:disabled) {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}

:root[data-theme="light"] .cate1-actions :deep(.category-subscribe-btn) {
  background: rgba(255, 255, 255, 0.95);
  color: #1f2937;
  border: 1px solid rgba(203, 213, 225, 0.9);
}

:root[data-theme="light"] .cate1-actions :deep(.category-subscribe-btn:hover) {
  background: rgba(248, 250, 252, 1);
}
</style>
