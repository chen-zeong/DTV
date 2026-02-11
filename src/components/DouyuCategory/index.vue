<template>
  <div class="category-list" :class="{ 'is-expanded': isExpanded }" ref="categoryListRootRef">
    <!-- 加载状态显示 -->
    <div v-if="isLoading && !hasError" class="loading-state">
      <div class="loading-spinner"></div>
      <div class="loading-text">正在加载分类数据...</div>
    </div>
    
    <!-- 正常显示分类内容 -->
    <template v-if="!isLoading && cate1List.length > 0">
      <Cate1List
        :cate1-list="cate1ListForCommon"
        :selected-cate1-href="selectedCate1Href"
        @select="handleCate1SelectFromCommon"
      >
        <template #actions>
          <slot name="actions" />
        </template>
      </Cate1List>
      <Cate2Grid
        v-if="sortedCate2List.length > 0"
        :cate2-list="cate2ListForCommon"
        :selected-cate2-href="selectedCate2Href"
        :is-expanded="isExpanded"
        @select="handleCate2SelectFromCommon"
        @toggle-expand="toggleExpand"
      />
      <Cate3List
        v-if="currentCate3List.length > 0"
        :cate3-list="currentCate3List"
        :selected-cate3-id="selectedCate3Id"
        :is-loading="isLoadingCate3"
        @select="handleCate3Click"
      />
    </template>
    
    <!-- 错误状态显示 -->
    <div v-if="hasError" class="error-state">
      <div class="error-message">加载分类失败，请重试</div>
      <button @click="reloadCategories" class="reload-btn">重新加载</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, watch, nextTick, ref, onBeforeUnmount, computed } from 'vue'
import Cate1List from '../CommonCategory/components/Cate1List.vue'
import Cate2Grid from '../CommonCategory/components/Cate2Grid.vue'
import Cate3List from '../CommonCategory/components/Cate3List.vue'
import { useCategories } from './composables/useCategories'
import { useSelection } from './composables/useSelection'
import { useExpand } from './composables/useExpand'
import type { CategorySelectedEvent, Category2 } from './types'
import type { Category1 as CommonCategory1, Category2 as CommonCategory2 } from '../../platforms/common/categoryTypes.ts'

const emit = defineEmits<{
  (e: 'category-selected', category: CategorySelectedEvent): void
  (e: 'expanded-state-changed', isExpanded: boolean): void
  (e: 'category-section-height-settled'): void
}>()

const categoryListRootRef = ref<HTMLElement | null>(null)

const hasError = ref(false)
const isLoading = ref(true)

// Correct order of composable calls
const {
  selectedCate1Id,
  selectedCate2Id,
  selectedCate3Id,
  selectCate1,
  handleCate2Click: originalHandleCate2Click,
  handleCate3Click,
  resetSelection
} = useSelection(emit)

const {
  cate1List,
  cate2List,
  isLoadingCate3,
  fetchCategories,
  fetchThreeCate,
  sortedCate2List,
  currentCate3List
} = useCategories(selectedCate1Id, selectedCate2Id)

const {
  isExpanded,
  toggleExpand,
} = useExpand(sortedCate2List)

const cate1ListForCommon = computed(() => {
  return cate1List.value.map((cate1) => ({
    title: cate1.cate1Name,
    href: String(cate1.cate1Id),
    subcategories: cate2List.value
      .filter((cate2) => cate2.cate1Id === cate1.cate1Id)
      .map((cate2) => ({
        title: cate2.cate2Name,
        href: String(cate2.cate2Id),
      })),
  }))
})

const cate2ListForCommon = computed(() => {
  return sortedCate2List.value.map((cate2) => ({
    title: cate2.cate2Name,
    href: String(cate2.cate2Id),
  }))
})

const selectedCate1Href = computed(() => {
  return selectedCate1Id.value !== null ? String(selectedCate1Id.value) : null
})

const selectedCate2Href = computed(() => {
  return selectedCate2Id.value !== null ? String(selectedCate2Id.value) : null
})

const handleCate1SelectFromCommon = (cate1: CommonCategory1) => {
  const cate1Id = Number(cate1.href)
  if (!Number.isNaN(cate1Id)) {
    selectCate1(cate1Id)
  }
}

const handleCate2SelectFromCommon = (cate2: CommonCategory2) => {
  const cate2Id = Number(cate2.href)
  if (Number.isNaN(cate2Id)) return
  const match = sortedCate2List.value.find((item) => item.cate2Id === cate2Id)
  if (match) {
    handleCate2SelectAndCollapse(match)
  }
}

// New wrapper function for C2 click to handle auto-collapse
const handleCate2SelectAndCollapse = (cate2: Category2) => {
  originalHandleCate2Click(cate2)
  if (isExpanded.value) {
    toggleExpand()
  }
};

// 监听isExpanded变化
watch(isExpanded, (newVal) => {
  emit('expanded-state-changed', newVal)
  nextTick(() => {
    emit('category-section-height-settled')
  })
})

// 设置动画事件监听器 - 在组件挂载时添加
onMounted(() => {
  // 监听分类区域展开和折叠的状态变化事件
  const handleExpanding = () => console.log('分类区域正在展开')
  const handleCollapsing = () => console.log('分类区域正在折叠')
  
  const handleExpanded = () => {
    nextTick(() => {
      const event = new CustomEvent('category-height-change')
      window.dispatchEvent(event)
    })
  }
  
  const handleCollapsed = () => {
    nextTick(() => {
      const event = new CustomEvent('category-height-change')
      window.dispatchEvent(event)
    })
  }
  
  // 添加事件监听
  window.addEventListener('category-expanding', handleExpanding)
  window.addEventListener('category-collapsing', handleCollapsing)
  window.addEventListener('category-expanded', handleExpanded)
  window.addEventListener('category-collapsed', handleCollapsed)
  
  // 在组件卸载时清理事件监听器
  onBeforeUnmount(() => {
    window.removeEventListener('category-expanding', handleExpanding)
    window.removeEventListener('category-collapsing', handleCollapsing)
    window.removeEventListener('category-expanded', handleExpanded)
    window.removeEventListener('category-collapsed', handleCollapsed)
  })

  loadCategories()

  // 如果一段时间后仍未选择分类，强制选择第一个
  setTimeout(() => {
    if (cate1List.value.length > 0 && selectedCate1Id.value === null) {
      selectCate1(cate1List.value[0].cate1Id)
    }
    
    if (sortedCate2List.value.length > 0 && selectedCate2Id.value === null) {
      handleCate2SelectAndCollapse(sortedCate2List.value[0])
    }
  }, 1000)
  
  // 如果长时间未加载完成，认为出错
  setTimeout(() => {
    if (isLoading.value) {
      isLoading.value = false
      hasError.value = true
      console.error('加载分类超时')
    }
  }, 5000)
})

// 监听分类数据变化
watch(cate1List, (newList) => {
  if (newList.length > 0 && isLoading.value) {
  }
}, { deep: true })

// 初始加载分类数据
const loadCategories = async () => {
  isLoading.value = true
  hasError.value = false
  resetSelection()
  
  try {
    await fetchCategories()
    
    // 检查是否成功加载了分类数据
    if (cate1List.value.length === 0) {
      console.error('CategoryList: 未加载到分类数据')
      hasError.value = true
      return
    }
    
    // 加载成功，停止加载状态
    isLoading.value = false
    
    // 如果有一级分类但没有选择，选择第一个
    if (cate1List.value.length > 0 && selectedCate1Id.value === null) {
      await nextTick()
      selectCate1(cate1List.value[0].cate1Id)
    }

    // After initial load, emit height settled for HomeView to get initial position
    nextTick(() => {
      if(categoryListRootRef.value) emit('category-section-height-settled')
    })
  } catch (error) {
    console.error('CategoryList: 获取分类数据时出错:', error)
    hasError.value = true
    isLoading.value = false
  }
}

// 重新加载分类
const reloadCategories = () => {
  loadCategories()
}

// 当sortedCate2List更新且有内容，但没有选中二级分类时，自动选择第一个
watch(sortedCate2List, (newList) => {
  // 自动选择第一个二级分类（如果有且尚未选择）
  if (newList.length > 0 && selectedCate2Id.value === null) {
    nextTick(() => {
      handleCate2SelectAndCollapse(newList[0])
    })
  }
})

// 当选中二级分类时，获取对应的三级分类
watch(selectedCate2Id, (newVal) => {
  if (newVal) {
    fetchThreeCate(newVal)
  }
})

// 导出一些方法供父组件使用
defineExpose({
  cate1List,
  sortedCate2List,
  currentCate3List,
  selectedCate1Id,
  selectedCate2Id,
  selectedCate3Id,
  selectCate1,
  handleCate2SelectAndCollapse,
  handleCate3Click,
  toggleExpand,
  isExpanded,
  reloadCategories
})
</script>

<style scoped>
.category-list {
  display: flex;
  flex-direction: column;
  background: transparent;
  color: var(--primary-text);
  max-height: 280px;
  min-height: 200px;
  overflow: hidden;
  transition: none;
  will-change: max-height;
  transform: translateZ(0);
  width: 100%;
}

.category-list.is-expanded {
  max-height: 500px;
}

.loading-state {
  padding: 40px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.loading-spinner {
  width: 30px;
  height: 30px;
  border: 3px solid var(--border-color);
  border-top-color: var(--accent-color);
  border-radius: 50%;
  animation: none;
  margin-bottom: 15px;
}

.loading-text {
  font-size: 14px;
  color: var(--secondary-text);
}

.error-state {
  padding: 40px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--secondary-text);
}

.error-message {
  margin-bottom: 15px;
}

.reload-btn {
  padding: 8px 20px;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  background: var(--accent-color);
  color: var(--accent-text);
  font-weight: 600;
  transition: all 0.2s ease;
}

.reload-btn:hover {
  opacity: 0.9;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(251, 114, 153, 0.2);
}

.cate2-content {
  transition: none;
}
</style>
