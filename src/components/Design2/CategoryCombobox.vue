<template>
  <div class="relative w-64" ref="comboboxRef">
    <!-- Trigger -->
    <button @click="toggleOpen" type="button"
      class="flex w-full items-center justify-between  border   px-3 py-2 text-sm font-medium    focus:outline-none transition-colors">
      <span class="truncate">{{ selectedName || placeholder }}</span>
      <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd"
          d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
          clip-rule="evenodd" />
      </svg>
    </button>

    <!-- Dropdown (Teleported) -->
    <Teleport to="body">
      <div v-if="isOpen" ref="dropdownRef" :style="dropdownStyle"
        class="fixed z-[9999] mt-1 overflow-hidden  border    backdrop-blur-md">
        <!-- Search -->
        <div class="p-2 border-b">
          <input v-model="searchQuery" ref="searchInputRef" type="text"
            class="w-full   px-3 py-1.5 text-sm   focus:outline-none focus:ring-1" placeholder="搜索分类..." />
        </div>

        <!-- List -->
        <div class="max-h-80 overflow-y-auto p-1 scrollbar-thin">
          <div v-if="loading" class="px-2 py-4 text-center text-sm">
            加载中...
          </div>
          <div v-else-if="filteredItems.length === 0" class="px-2 py-2 text-sm  text-center">
            未找到相关分类
          </div>

          <template v-else>
            <!-- Flat list for search results -->
            <template v-if="searchQuery">
              <div v-for="item in filteredItems" :key="item.id" @click="selectItem(item)"
                class="cursor-pointer  px-2 py-1.5 text-sm  "
                :class="{ 'bg-[var(--accent)]  ': selectedId === item.id }">
                <div class="flex items-center justify-between">
                  <span>{{ item.title }}</span>
                  <span class="text-xs opacity-50">{{ item.groupName }}</span>
                </div>
              </div>
            </template>

            <!-- Grouped list for normal view -->
            <template v-else>
              <div v-for="group in displayedGroups" :key="group.id">
                <div class="sticky top-0 z-10/95 backdrop-blur-sm px-2 py-1 text-xs font-semibold  mt-1 first:mt-0">
                  {{ group.title }}
                </div>
                <div v-for="item in group.items" :key="item.id" @click="selectItem(item)"
                  class="cursor-pointer  px-2 py-1.5 text-sm    ml-1"
                  :class="{ 'bg-[var(--accent)]  ': selectedId === item.id }">
                  {{ item.title }}
                </div>
              </div>
            </template>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted } from 'vue'
import { onClickOutside } from '@vueuse/core'

export interface CategoryItem {
  id: string
  title: string
  groupName?: string
}

export interface CategoryGroup {
  id: string
  title: string
  items: CategoryItem[]
}

const props = defineProps<{
  groups: CategoryGroup[]
  selectedId: string | null
  loading?: boolean
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'select', item: CategoryItem): void
}>()

const isOpen = ref(false)
const searchQuery = ref('')
const comboboxRef = ref<HTMLElement | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)

// Dropdown positioning
const dropdownStyle = ref({})
const updatePosition = () => {
  if (comboboxRef.value) {
    const rect = comboboxRef.value.getBoundingClientRect()
    dropdownStyle.value = {
      top: `${rect.bottom}px`,
      left: `${rect.left}px`,
      minWidth: `${rect.width}px`,
      maxWidth: 'min(400px, 90vw)'
    }
  }
}

// Update position on scroll/resize
window.addEventListener('scroll', updatePosition, true)
window.addEventListener('resize', updatePosition)

onUnmounted(() => {
  window.removeEventListener('scroll', updatePosition, true)
  window.removeEventListener('resize', updatePosition)
})

onClickOutside(dropdownRef, (event) => {
  // Ignore clicks on the trigger button
  if (comboboxRef.value && comboboxRef.value.contains(event.target as Node)) {
    return
  }
  isOpen.value = false
})

const toggleOpen = () => {
  if (!isOpen.value) {
    updatePosition()
    isOpen.value = true
    nextTick(() => {
      searchInputRef.value?.focus()

      // Scroll selected item into view
      if (props.selectedId) {
        const selectedEl = dropdownRef.value?.querySelector('.bg-\\[var\\(--accent\\)\\]')
        if (selectedEl) {
          selectedEl.scrollIntoView({ block: 'nearest' })
        }
      }
    })
  } else {
    isOpen.value = false
    searchQuery.value = ''
  }
}

const selectedName = computed(() => {
  if (!props.selectedId) return ''
  for (const group of props.groups) {
    const item = group.items.find(i => i.id === props.selectedId)
    if (item) return item.title
  }
  return ''
})

const displayedGroups = computed(() => {
  return props.groups
})

const filteredItems = computed(() => {
  if (!searchQuery.value) return []

  const query = searchQuery.value.toLowerCase()
  const results: CategoryItem[] = []

  for (const group of props.groups) {
    for (const item of group.items) {
      if (item.title.toLowerCase().includes(query)) {
        results.push({
          ...item,
          groupName: group.title
        })
      }
    }
  }

  return results
})

const selectItem = (item: CategoryItem) => {
  emit('select', item)
  isOpen.value = false
  searchQuery.value = ''
}
</script>