<template>
  <div class="flex flex-1 min-h-0 justify-center px-3 pb-3 ">
    <!-- Center Panel Inline -->
    <div class="relative flex w-full max-w-[1200px] flex-1 min-h-0 flex-col gap-5 rounded-md h-full bg-linear-to-b from-indigo-500 from-10% via-sky-500 via-30% to-neutral-950 to-90% p-6 shadow-[var(--shadow-lg)]">
      <!-- Tabs Section -->
      <div class="flex sticky top-0 items-center justify-between gap-4 w-full z-10 px-4 pt-6 pb-2">
        <!-- Platform Tabs Inline -->
        <div class="flex items-center gap-2 rounded text-neutral-200 bg-neutral-800 p-1">
          <button
            v-for="platform in platforms"
            :key="platform.id"
            type="button"
            class="rounded-sm px-4 py-2 text-sm font-semibold transition-all duration-200 cursor-pointer"
            :class="platform.id === activePlatform
              ? 'bg-purple-500'
              : 'bg-neutral-800 hover:bg-neutral-700'"
            @click="handlePlatformChange(platform.id)"
          >
            {{ platform.name }}
          </button>
        </div>

        <CategoryCombobox :groups="categoryGroups" :selected-id="currentSelectedId" :loading="isCategoryLoading"
          placeholder="选择分类..." class="w-64" @select="handleCategorySelect" />
      </div>

      <!-- Grid Section -->
      <div class="min-h-0 flex-1 overflow-auto h-full">
        <div v-if="isDouyu" class="min-h-0 h-full pb-6 ">
          <div v-if="selectedCategoryInfo" class="min-h-0 h-full pb-6">
            <CommonStreamerList class="h-full" :douyu-category="selectedCategoryInfo" platformName="douyu"
              playerRouteName="douyuPlayer" :key="selectedCategoryInfo.type + '-' + selectedCategoryInfo.id" />
          </div>
          <div v-else-if="isCategoryLoading" class="flex min-h-80 items-center justify-center">
            正在加载分类...
          </div>
          <div v-else class="flex min-h-80 items-center justify-center text-neutral-400">
            请选择一个分类
          </div>
        </div>
        <div v-else class="min-h-0 h-full">
          <CommonStreamerList class="h-full" :selectedCategory="selectedCategory" :categoriesData="categoriesData"
            :default-page-size="platformConfig.defaultPageSize" :platformName="activePlatform"
            :playerRouteName="platformConfig.playerRouteName" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CategoryCombobox, { CategoryGroup, CategoryItem } from '../components/Design2/CategoryCombobox.vue'
import CommonStreamerList from '../components/CommonStreamerList/index.vue'
import { douyinCategoriesData } from '../platforms/douyin/douyinCategoriesData'
import { huyaCategoriesData } from '../platforms/huya/huyaCategoriesData'
import { biliCategoriesData } from '../platforms/bilibili/biliCategoriesData'
import { useCategories } from '../platforms/douyu/composables/useCategories'
import type { CategorySelectedEvent as CommonCategorySelectedEvent } from '../platforms/common/categoryTypes'
import { type UiPlatform } from '../platforms/common/types'

defineOptions({
  name: 'PlatformHomeView'
})

const platforms: { id: UiPlatform; name: string }[] = [
  { id: 'douyu', name: '斗鱼' },
  { id: 'huya', name: '虎牙' },
  { id: 'douyin', name: '抖音' },
  { id: 'bilibili', name: 'Bilibili' },
];

interface SelectedCategoryInfo {
  type: 'cate2' | 'cate3'
  id: string
  name?: string
}

const router = useRouter()
const route = useRoute()

const platformRouteMap: Record<UiPlatform, string> = {
  douyu: 'DouyuHome',
  douyin: 'DouyinHome',
  huya: 'HuyaHome',
  bilibili: 'BilibiliHome'
}

const platformConfigMap: Record<UiPlatform, { playerRouteName: string; defaultPageSize?: number }> = {
  douyu: { playerRouteName: 'douyuPlayer' },
  douyin: { playerRouteName: 'douyinPlayer' },
  huya: { playerRouteName: 'huyaPlayer', defaultPageSize: 120 },
  bilibili: { playerRouteName: 'bilibiliPlayer' }
}

const activePlatform = computed<UiPlatform>(() => (route.meta.platform as UiPlatform) ?? 'douyu')
const platformConfig = computed(() => platformConfigMap[activePlatform.value])
const isDouyu = computed(() => activePlatform.value === 'douyu')

const categoriesData = computed(() => {
  if (activePlatform.value === 'douyin') return douyinCategoriesData
  if (activePlatform.value === 'huya') return huyaCategoriesData
  if (activePlatform.value === 'bilibili') return biliCategoriesData
  return []
})

// Douyu Data Logic
const douyuSelectedC1 = ref<number | null>(null)
const douyuSelectedC2 = ref<number | null>(null)
const { cate1List: douyuCate1List, cate2List: douyuCate2List, fetchCategories: fetchDouyuCategories } = useCategories(douyuSelectedC1, douyuSelectedC2)
const isDouyuLoading = ref(false)

// Shared Selection State
const selectedCategory = ref<CommonCategorySelectedEvent | null>(null)
const selectedCategoryInfo = ref<SelectedCategoryInfo | null>(null)

const isCategoryLoading = computed(() => isDouyu.value ? isDouyuLoading.value : false)

const currentSelectedId = computed(() => {
  if (isDouyu.value) {
    return selectedCategoryInfo.value?.id ?? null
  } else {
    return selectedCategory.value?.cate2Href ?? null
  }
})

// Transform data for Combobox
const categoryGroups = computed<CategoryGroup[]>(() => {
  if (isDouyu.value) {
    return douyuCate1List.value.map(c1 => ({
      id: String(c1.cate1Id),
      title: c1.cate1Name,
      items: douyuCate2List.value
        .filter(c2 => c2.cate1Id === c1.cate1Id)
        .map(c2 => ({
          id: c2.shortName, // Use shortName for Douyu ID
          title: c2.cate2Name,
          // Store extra info if needed by finding it later
        }))
    }))
  } else {
    // Common Platforms
    return categoriesData.value.map(c1 => ({
      id: c1.href,
      title: c1.title,
      items: c1.subcategories.map(c2 => ({
        id: c2.href,
        title: c2.title
      }))
    }))
  }
})

const handlePlatformChange = (platform: UiPlatform) => {
  const target = platformRouteMap[platform]
  if (!target) return
  if (platform === activePlatform.value) return
  router.push({ name: target })
}

const handleCategorySelect = (item: CategoryItem) => {
  if (isDouyu.value) {
    selectedCategoryInfo.value = {
      type: 'cate2',
      id: item.id,
      name: item.title
    }
  } else {
    // Find parent group for Common
    const group = categoryGroups.value.find(g => g.items.some(i => i.id === item.id))
    if (group) {
      selectedCategory.value = {
        type: 'cate2',
        cate1Href: group.id,
        cate2Href: item.id,
        cate1Name: group.title,
        cate2Name: item.title
      }
    }
  }
}

// Initial Data Fetch & Default Selection
const initDouyuData = async () => {
  if (douyuCate1List.value.length > 0) return // Already loaded

  isDouyuLoading.value = true
  try {
    await fetchDouyuCategories()

    // Default selection for Douyu
    if (douyuCate2List.value.length > 0 && !selectedCategoryInfo.value) {
      // Logic to find first valid C2 (e.g. from first C1)
      const firstC1 = douyuCate1List.value[0]
      if (firstC1) {
        const firstC2 = douyuCate2List.value.find(c2 => c2.cate1Id === firstC1.cate1Id)
        if (firstC2) {
          selectedCategoryInfo.value = {
            type: 'cate2',
            id: firstC2.shortName,
            name: firstC2.cate2Name
          }
        }
      }
    }
  } catch (e) {
    console.error('Failed to load Douyu categories', e)
  } finally {
    isDouyuLoading.value = false
  }
}

const initCommonData = () => {
  // Default selection for Common
  if (categoriesData.value.length > 0 && !selectedCategory.value) {
    const firstC1 = categoriesData.value[0]
    if (firstC1 && firstC1.subcategories.length > 0) {
      const firstC2 = firstC1.subcategories[0]
      selectedCategory.value = {
        type: 'cate2',
        cate1Href: firstC1.href,
        cate2Href: firstC2.href,
        cate1Name: firstC1.title,
        cate2Name: firstC2.title
      }
    }
  }
}

watch(activePlatform, (newPlatform) => {
  selectedCategory.value = null
  selectedCategoryInfo.value = null

  if (newPlatform === 'douyu') {
    initDouyuData()
  } else {
    // Watch for categoriesData change (if dynamic, though currently static for most)
    // Actually categoriesData is computed based on activePlatform, so it updates immediately.
    // We just need to set default selection.
    initCommonData()
  }
}, { immediate: true })

// Also watch categoriesData for Common platforms in case it loads asynchronously (though currently static imports)
watch(categoriesData, () => {
  if (!isDouyu.value) {
    initCommonData()
  }
})

onMounted(() => {
  if (isDouyu.value) {
    initDouyuData()
  } else {
    initCommonData()
  }
})
</script>
