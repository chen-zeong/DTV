<template>
  <div class="home-page">
    <!-- 分类区域 -->
    <div class="category-section" ref="categorySectionRef">
      <CategoryList 
        @category-selected="handleCategorySelected"
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
      </CategoryList>
    </div>
    <!-- 主播列表区域 -->
    <div 
      class="live-list-section" 
      v-if="selectedCategoryInfo"
    >
      <CommonStreamerList
        :douyu-category="selectedCategoryInfo"
        platformName="douyu"
        playerRouteName="douyuPlayer"
        :key="selectedCategoryInfo.type + '-' + selectedCategoryInfo.id"
      />
    </div>
    <!-- 加载状态显示 (for default category) -->
    <div class="loading-section" v-else-if="isLoadingDefaultCategory">
      <div class="loading-message">正在加载默认分类...</div>
    </div>
    <div class="loading-section" v-else>
      <div class="loading-message">请先选择一个分类。</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'

// Added for KeepAlive include by name
defineOptions({
  name: 'DouyuHomeView'
})

import CategoryList from '../components/DouyuCategory/index.vue';
import CommonStreamerList from '../components/CommonStreamerList/index.vue'; 
import { invoke } from '@tauri-apps/api/core'
import type { CategorySelectedEvent } from '../components/DouyuCategory/types';
import { useCustomCategoryStore } from '../store/customCategoryStore'

// Types for the data structure returned by the Rust command `fetch_categories`
interface FrontendCate3Item {
    id: string;
    name: string;
}
interface FrontendCate2Item {
    id: string;
    name: string;
    short_name: string;
    icon: string;
    cate3List: FrontendCate3Item[];
}
interface FrontendCate1Item {
    id: string;
    name: string;
    cate2List: FrontendCate2Item[];
}

// Updated to match the new Rust response structure
interface FrontendCategoryResponse {
    cate1List: FrontendCate1Item[];
}

// Define a type for the selected category information to be passed to LiveList
interface SelectedCategoryInfo {
  type: 'cate2' | 'cate3';
  id: string; // shortName for cate2, cate3Id for cate3
  name?: string; // cate2Name or cate3Name
}

const selectedCategoryInfo = ref<SelectedCategoryInfo | null>(null);
const categorySectionRef = ref<HTMLElement | null>(null)
const isLoadingDefaultCategory = ref(true);
const customStore = useCustomCategoryStore()
customStore.ensureLoaded()

const canSubscribe = computed(() => selectedCategoryInfo.value?.type === 'cate2' && !!selectedCategoryInfo.value?.id)
const isSubscribed = computed(() => {
  const id = selectedCategoryInfo.value?.id
  return !!id && customStore.isSubscribed('douyu', id)
})

const handleCategorySelected = (event: CategorySelectedEvent) => {
  if (event.type === 'cate2' && event.shortName) {
    selectedCategoryInfo.value = {
      type: 'cate2',
      id: event.shortName,
      name: event.cate2Name || event.shortName
    };
  } else if (event.type === 'cate3' && event.cate3Id) {
    selectedCategoryInfo.value = {
      type: 'cate3',
      id: event.cate3Id,
      name: event.cate3Name || undefined
    };
  } else {
    console.warn('Received category selection event with missing/invalid data:', event);
    selectedCategoryInfo.value = null;
  }
  // To ensure LiveList re-renders, we already use :key.
}

const toggleSubscribe = () => {
  if (!selectedCategoryInfo.value || selectedCategoryInfo.value.type !== 'cate2') return
  const id = selectedCategoryInfo.value.id
  if (!id) return
  if (customStore.isSubscribed('douyu', id)) {
    customStore.removeByKey(`douyu:${id}`)
  } else {
    customStore.addDouyuCate2(id, selectedCategoryInfo.value.name || id)
  }
}

const fetchDefaultCategory = async () => {
  isLoadingDefaultCategory.value = true;
  try {
    const response = await invoke('fetch_categories') as FrontendCategoryResponse;
    if (response && response.cate1List && response.cate1List.length > 0) {
      const firstCate1 = response.cate1List[0];
      if (firstCate1 && firstCate1.cate2List && firstCate1.cate2List.length > 0) {
        const defaultCate2 = firstCate1.cate2List[0];
        if (defaultCate2 && defaultCate2.short_name) {
          selectedCategoryInfo.value = {
            type: 'cate2',
            id: defaultCate2.short_name,
            name: defaultCate2.name 
          };
        } else {
          console.error('HomeView: Default second-level category or its short_name is missing.');
          selectedCategoryInfo.value = null;
        }
      } else {
        console.error('HomeView: Default first-level category does not have any second-level categories.');
        selectedCategoryInfo.value = null;
      }
    } else {
      console.error('HomeView: 未能获取到有效的默认分类数据或默认分类结构不正确. Response:', response);
      selectedCategoryInfo.value = null;
    }
  } catch (error) {
    console.error('HomeView: 获取默认分类失败:', error);
    selectedCategoryInfo.value = null;
  } finally {
    isLoadingDefaultCategory.value = false;
  }
}

onMounted(() => {
  fetchDefaultCategory()
})
</script>

<style scoped>
.home-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: transparent;
  min-width: 0;
}

.category-section {
  flex-shrink: 0; 
  z-index: 10; 
  position: sticky; 
  top: 0;
  width: 100%;
  background: transparent;
  backdrop-filter: none;
}


.live-list-section {
  flex-grow: 1; 
  overflow: hidden; 
  width: 100%;
  background: transparent;
  display: flex; 
  flex-direction: column; 
}

.loading-section {
  flex: 1; 
  display: flex;
  justify-content: center;
  align-items: center;
  background: transparent;
}

.loading-message {
  color: var(--secondary-text);
  font-size: 16px;
}
</style>
