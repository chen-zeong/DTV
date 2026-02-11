<template>
  <div class="huya-home-view-layout">
    <CommonCategory 
      :categories-data="huyaCategoriesData as any"
      @category-selected="onCategorySelected"
      class="huya-category-section"
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
      :categories-data="huyaCategoriesData as any"
      :default-page-size="120"
      playerRouteName="huyaPlayer"
      class="huya-streamer-list-section"
    />
  </div>
</template>

<script setup lang="ts">
defineOptions({
  name: 'HuyaHomeView'
})

import { computed, ref } from 'vue'
import CommonCategory from '../components/CommonCategory/index.vue'
import { huyaCategoriesData } from '../platforms/huya/huyaCategoriesData'
import CommonStreamerList from '../components/CommonStreamerList/index.vue'
import type { CategorySelectedEvent } from '../platforms/common/categoryTypes.ts'
import { useCustomCategoryStore } from '../store/customCategoryStore'

const currentSelectedCategory = ref<CategorySelectedEvent | null>(null)
const customStore = useCustomCategoryStore()
customStore.ensureLoaded()

const canSubscribe = computed(() => !!currentSelectedCategory.value?.cate2Href)
const isSubscribed = computed(() => {
  const href = currentSelectedCategory.value?.cate2Href
  return !!href && customStore.isSubscribed('huya', href)
})
const onCategorySelected = (categoryEvent: CategorySelectedEvent) => {
  currentSelectedCategory.value = categoryEvent
}

const toggleSubscribe = () => {
  if (!currentSelectedCategory.value?.cate2Href) return
  const href = currentSelectedCategory.value.cate2Href
  if (customStore.isSubscribed('huya', href)) {
    customStore.removeByKey(`huya:${href}`)
  } else {
    customStore.addCommonCate2(
      'huya',
      href,
      currentSelectedCategory.value.cate2Name,
      currentSelectedCategory.value.cate1Name,
      currentSelectedCategory.value.cate1Href,
    )
  }
}
</script>

<style scoped>
.huya-home-view-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: transparent;
  overflow: hidden;
}


.huya-category-section {
  flex-shrink: 0;
  background: transparent;
  backdrop-filter: var(--glass-blur);
  z-index: 10;
}

.huya-streamer-list-section {
  flex: 1;
  overflow: hidden;
  background: transparent;
}
</style>
