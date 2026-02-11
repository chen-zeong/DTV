<template>
  <div class="douyin-home">
    <div class="douyin-content">
      <div class="left-panel">
        <CommonCategory 
          :categoriesData="categoriesData"
          @category-selected="onCategorySelected" 
        >
          <template #actions>
            <button
              type="button"
              class="category-subscribe-btn"
              :disabled="!canSubscribe"
              @click="toggleSubscribe"
            >
              {{ isSubscribed ? '取消订阅' : '订阅分区' }}
            </button>
          </template>
        </CommonCategory>
      </div>
      <div class="right-panel">
        <CommonStreamerList
          :selectedCategory="selectedCategory"
          :categoriesData="categoriesData"
          platformName="douyin"
          playerRouteName="douyinPlayer"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import CommonCategory from '../components/CommonCategory/index.vue'
import CommonStreamerList from '../components/CommonStreamerList/index.vue'
import { douyinCategoriesData } from '../platforms/douyin/douyinCategoriesData'
import type { CategorySelectedEvent } from '../platforms/common/categoryTypes'
import { useCustomCategoryStore } from '../store/customCategoryStore'

defineOptions({
  name: 'DouyinHomeView',
})

const categoriesData = douyinCategoriesData
const selectedCategory = ref<CategorySelectedEvent | null>(null)
const customStore = useCustomCategoryStore()
customStore.ensureLoaded()

const canSubscribe = computed(() => !!selectedCategory.value?.cate2Href)
const isSubscribed = computed(() => {
  const href = selectedCategory.value?.cate2Href
  return !!href && customStore.isSubscribed('douyin', href)
})

function onCategorySelected(evt: CategorySelectedEvent) {
  selectedCategory.value = evt
}

const toggleSubscribe = () => {
  if (!selectedCategory.value?.cate2Href) return
  const href = selectedCategory.value.cate2Href
  if (customStore.isSubscribed('douyin', href)) {
    customStore.removeByKey(`douyin:${href}`)
  } else {
    customStore.addCommonCate2(
      'douyin',
      href,
      selectedCategory.value.cate2Name,
      selectedCategory.value.cate1Name,
      selectedCategory.value.cate1Href,
    )
  }
}
</script>

<style scoped>
.douyin-home {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: transparent;
}

.douyin-content {
  display: flex;
  flex-direction: column; /* 改为纵向排列，上下布局 */
  height: 100%;
}

.left-panel {
  width: 100%;
  background: transparent;
  backdrop-filter: none;
  z-index: 10;
  overflow: hidden;
}


.right-panel {
  flex: 1;
  overflow: hidden;
  background: transparent;
}
</style>
