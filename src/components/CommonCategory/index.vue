<template>
  <div class="category-list" :class="{ 'is-expanded': isExpanded }">
    <template v-if="cate1List.length > 0">
      <Cate1List
        :cate1-list="cate1List"
        :selected-cate1-href="selectedCate1Href"
        @select="selectCate1"
      >
        <template #actions>
          <slot name="actions" />
        </template>
      </Cate1List>
      <Cate2Grid
        v-if="currentCate2List.length > 0"
        :cate2-list="currentCate2List"
        :selected-cate2-href="selectedCate2Href"
        :is-expanded="isExpanded"
        @select="handleCate2SelectAndCollapse"
        @toggle-expand="toggleExpand"
        @height-changed="handleCate2GridHeightChanged"
      />
    </template>
    <div v-else class="loading-state">
      <div class="loading-text">正在加载分类数据...</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, nextTick, onActivated } from 'vue'
import Cate1List from './components/Cate1List.vue'
import Cate2Grid from './components/Cate2Grid.vue'
import type { Category1 as CommonCategory1, Category2 as CommonCategory2, CategorySelectedEvent } from '../../platforms/common/categoryTypes.ts'

const props = defineProps<{ categoriesData: CommonCategory1[] }>()

const emit = defineEmits<{
  (e: 'category-selected', category: CategorySelectedEvent): void
  (e: 'expanded-state-changed', isExpanded: boolean): void
  (e: 'category-section-height-settled'): void
}>()


const cate1List = ref<CommonCategory1[]>([])
const selectedCate1Href = ref<string | null>(null)
const selectedCate2Href = ref<string | null>(null)

const isExpanded = ref(false)

onMounted(() => {
  cate1List.value = Array.isArray(props.categoriesData) ? props.categoriesData : []
  if (cate1List.value.length > 0) {
    if (!selectedCate1Href.value) {
      selectCate1(cate1List.value[0])
    }
  }
  nextTick(() => {
    emit('category-section-height-settled')
  })
})

const currentCate2List = computed(() => {
  if (!selectedCate1Href.value) return []
  const selectedCate1 = cate1List.value.find((c1: CommonCategory1) => c1.href === selectedCate1Href.value)
  return selectedCate1 ? selectedCate1.subcategories : []
})

const selectCate1 = (cate1: CommonCategory1) => {
  if (selectedCate1Href.value === cate1.href) return;
  selectedCate1Href.value = cate1.href
  selectedCate2Href.value = null

  if (currentCate2List.value.length > 0) {
    handleCate2SelectAndCollapse(currentCate2List.value[0])
  }
  if (isExpanded.value) {
    toggleExpand()
  }
  nextTick(() => {
    emit('category-section-height-settled')
  })
}

const handleCate2Select = (cate2: CommonCategory2) => {
  selectedCate2Href.value = cate2.href
  const selectedCate1 = cate1List.value.find((c1: CommonCategory1) => c1.href === selectedCate1Href.value)
  if (selectedCate1) {
    emit('category-selected', {
      type: 'cate2',
      cate1Href: selectedCate1.href,
      cate2Href: cate2.href,
      cate1Name: selectedCate1.title,
      cate2Name: cate2.title,
    })
  }
}

onActivated(() => {
  const currentSelectedCate1 = cate1List.value.find((c1: CommonCategory1) => c1.href === selectedCate1Href.value);
  const currentSelectedCate2 = currentCate2List.value.find((c2: CommonCategory2) => c2.href === selectedCate2Href.value);

  if (currentSelectedCate1 && currentSelectedCate2) {
    emit('category-selected', {
      type: 'cate2',
      cate1Href: currentSelectedCate1.href,
      cate2Href: currentSelectedCate2.href,
      cate1Name: currentSelectedCate1.title,
      cate2Name: currentSelectedCate2.title,
    });
  } else if (currentSelectedCate1 && !selectedCate2Href.value) {
    if (currentCate2List.value.length > 0) {
        handleCate2SelectAndCollapse(currentCate2List.value[0]);
    }
  }
  nextTick(() => {
    emit('category-section-height-settled');
  });
})
const handleCate2SelectAndCollapse = (cate2: CommonCategory2) => {
  handleCate2Select(cate2)
  if (isExpanded.value) {
    toggleExpand()
  }
}

const toggleExpand = () => {
  isExpanded.value = !isExpanded.value
  emit('expanded-state-changed', isExpanded.value)
  nextTick(() => {
    emit('category-section-height-settled')
  })
}

const handleCate2GridHeightChanged = () => {
  emit('category-section-height-settled')
}
</script>

<style scoped>
.category-list {
  display: flex;
  flex-direction: column;
  background: transparent;
  color: var(--primary-text);
  max-height: 280px;
  min-height: 160px;
  overflow: hidden;
  transition: none;
  will-change: max-height;
  transform: translateZ(0);
  width: 100%;
  position: relative;
}

.category-list.is-expanded {
  max-height: 500px;
}

.loading-state {
  padding: 32px 16px;
  text-align: center;
  color: var(--secondary-text);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-color);
  border-top-color: var(--accent-color);
  border-radius: 50%;
  animation: none;
  margin-bottom: 12px;
}

.loading-text {
  font-size: 12px;
  font-weight: 500;
  color: var(--secondary-text);
}

</style>
