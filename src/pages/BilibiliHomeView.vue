<template>
  <div class="bili-home-view-layout">
    <CommonCategory 
      :categories-data="biliCategoriesData as any"
      @category-selected="onCategorySelected"
      class="bili-category-section"
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
    <CommonStreamerList 
      :selected-category="currentSelectedCategory"
      :categories-data="biliCategoriesData as any"
      platformName="bilibili"
      playerRouteName="bilibiliPlayer"
      class="bili-streamer-list-section"
    />
  </div>
</template>

<script setup lang="ts">
defineOptions({
  name: 'BilibiliHomeView'
})

import { computed, ref } from 'vue'
import CommonCategory from '../components/CommonCategory/index.vue'
import CommonStreamerList from '../components/CommonStreamerList/index.vue'
import { biliCategoriesData } from '../platforms/bilibili/biliCategoriesData'
import type { CategorySelectedEvent } from '../platforms/common/categoryTypes.ts'
import { useCustomCategoryStore } from '../store/customCategoryStore'

const currentSelectedCategory = ref<CategorySelectedEvent | null>(null)
const customStore = useCustomCategoryStore()
customStore.ensureLoaded()

const canSubscribe = computed(() => !!currentSelectedCategory.value?.cate2Href)
const isSubscribed = computed(() => {
  const href = currentSelectedCategory.value?.cate2Href
  return !!href && customStore.isSubscribed('bilibili', href)
})
const onCategorySelected = (categoryEvent: CategorySelectedEvent) => {
  currentSelectedCategory.value = categoryEvent
}

const toggleSubscribe = () => {
  if (!currentSelectedCategory.value?.cate2Href) return
  const href = currentSelectedCategory.value.cate2Href
  if (customStore.isSubscribed('bilibili', href)) {
    customStore.removeByKey(`bilibili:${href}`)
  } else {
    customStore.addCommonCate2(
      'bilibili',
      href,
      currentSelectedCategory.value.cate2Name,
      currentSelectedCategory.value.cate1Name,
      currentSelectedCategory.value.cate1Href,
    )
  }
}
</script>

<style scoped>
.bili-home-view-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: transparent;
  overflow: hidden;
}


.bili-category-section {
  flex-shrink: 0;
  background: transparent;
  backdrop-filter: none;
  z-index: 10;
}

.bili-streamer-list-section {
  flex: 1;
  overflow: hidden;
  background: transparent;
}
</style>
