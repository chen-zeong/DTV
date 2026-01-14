<template>
  <div class="grid grid-cols-9 h-full w-full overflow-hidden bg-neutral-950 text-neutral-200">
    
    <!-- Left Column: Navigation / Library -->
    <div class="col-span-2 h-full overflow-y-auto min-h-0 border-r border-white/5 bg-neutral-900/30 p-4 flex flex-col gap-6 scrollbar-none">
      <div class="flex justify-between items-center px-2">
        <h2 class="text-lg font-bold">收藏列表</h2>
        <div class="flex gap-2">
          <MagnetIcon class="size-5 text-neutral-400 hover:text-white cursor-pointer" />
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <div v-for="value in followedStreamers" :key="value.id" 
             class="group flex gap-3 items-center p-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
             @click="handleSelectHistory(value)">
          <SmoothImage class="size-12 rounded-full border border-white/10 flex-shrink-0" :src="value.avatarUrl || ''" :alt="value.nickname" />
          <div class="flex flex-col min-w-0">
            <p class="text-sm font-semibold text-white truncate">{{ value.nickname }}</p>
            <p class="text-xs text-neutral-400 truncate">{{ value.roomTitle || '正在直播' }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Center Column: Main Feed -->
    <div 
      ref="centerColumnRef"
      class="col-span-5 h-full overflow-y-auto min-h-0 relative scrollbar-none"
      @scroll="handleCenterScroll"
    >
      <!-- Spotify-like Sticky Header -->
      <div 
        class="sticky top-0 z-20 transition-all duration-300 ease-in-out"
        :class="[
          isHeaderCollapsed 
            ? 'bg-neutral-900/95 backdrop-blur-md py-3 shadow-lg' 
            : 'bg-transparent pt-12 pb-6'
        ]"
      >
        <div class="px-8 flex flex-col gap-6">
          <div class="flex items-end gap-4 transition-all duration-300"
               :class="{ 'opacity-0 -translate-y-4 pointer-events-none h-0 mb-0': isHeaderCollapsed, 'opacity-100': !isHeaderCollapsed }">
            <h1 class="text-6xl font-black tracking-tighter">
              {{ currentCategoryName || '英雄联盟' }}
            </h1>
          </div>

          <div class="flex items-center justify-between gap-4">
            <!-- Category Shortcuts -->
            <div class="flex gap-3 overflow-x-auto scrollbar-none">
              <button
                v-for="cate in categoryShortcuts"
                :key="cate"
                class="px-4 py-1.5 rounded-full text-sm font-bold whitespace-nowrap transition-colors"
                :class="isShortcutActive(cate) ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'"
              >
                {{ cate }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Main Content Grid -->
      <div class="px-8 pb-12">
        <div v-if="isDouyu" class="min-h-0">
          <div v-if="selectedCategoryInfo" class="min-h-0">
            <CommonStreamerList 
              :douyu-category="selectedCategoryInfo" 
              platformName="douyu"
              playerRouteName="UniversalPlayer" 
              :key="selectedCategoryInfo.type + '-' + selectedCategoryInfo.id" 
              :is-scrolling="isScrolling"
            />
          </div>
          <div v-else-if="isCategoryLoading" class="flex h-96 items-center justify-center">
            <LoadingDots />
          </div>
        </div>
        <div v-else class="min-h-0">
          <CommonStreamerList 
            :selectedCategory="selectedCategory" 
            :categoriesData="categoriesData"
            :default-page-size="platformConfig.defaultPageSize" 
            :platformName="activePlatform"
            :playerRouteName="platformConfig.playerRouteName" 
            :is-scrolling="isScrolling"
          />
        </div>
      </div>
    </div>

    <!-- Right Column: Info / Actions -->
    <div class="col-span-2 h-full overflow-y-auto min-h-0 border-l border-white/5 bg-neutral-900/30 p-6 flex flex-col gap-8 scrollbar-none">
      <div class="flex flex-col gap-4">
        <p class="text-xs font-black uppercase tracking-widest text-neutral-500">选择平台</p>
        <div class="grid grid-cols-2 gap-2">
          <button 
            v-for="plt in platforms" 
            :key="plt.id"
            class="px-4 py-3 rounded-lg text-sm font-bold border border-white/5 transition-all"
            :class="plt.id === activePlatform ? 'bg-purple-600 border-purple-400 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'"
            @click="handlePlatformChange(plt.id)"
          >
            {{ plt.name }}
          </button>
        </div>
      </div>

      <div class="flex flex-col gap-4">
        <p class="text-xs font-black uppercase tracking-widest text-neutral-500">快速分类</p>
        
        <!-- Sidebar Main Categories -->
        <div class="flex flex-wrap gap-2 mb-2">
          <button 
            v-for="cate1 in sidebarCate1List" 
            :key="cate1.id"
            class="px-3 py-1.5 text-xs font-bold rounded-md transition-all border"
            :class="sidebarSelectedCate1Id === cate1.id 
              ? 'bg-white text-black border-white' 
              : 'bg-neutral-800 text-neutral-400 border-transparent hover:border-neutral-600'"
            @click="sidebarSelectedCate1Id = cate1.id"
          >
            {{ cate1.title }}
          </button>
        </div>

        <!-- Sidebar Sub Categories -->
        <div v-if="sidebarCate2List.length > 0" class="flex flex-wrap gap-2 pt-4 border-t border-white/5">
          <button 
            v-for="cate2 in sidebarCate2List" 
            :key="cate2.id"
            class="px-3 py-1.5 text-[11px] font-medium rounded-md transition-all border"
            :class="currentSelectedId === cate2.id 
              ? 'bg-purple-600/20 text-purple-400 border-purple-500/50' 
              : 'bg-neutral-900/50 text-neutral-500 border-neutral-800 hover:border-neutral-700 hover:text-neutral-300'"
            @click="handleCategorySelect(cate2)"
          >
            {{ cate2.title }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MagnetIcon } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { useFollowStore } from '../stores/followStore'
import CommonStreamerList from '../components/CommonStreamerList/index.vue'
import SmoothImage from '../components/Common/SmoothImage.vue'
import LoadingDots from '../components/Common/LoadingDots.vue'
import { douyinCategoriesData } from '../platforms/douyin/douyinCategoriesData'
import { huyaCategoriesData } from '../platforms/huya/huyaCategoriesData'
import { biliCategoriesData } from '../platforms/bilibili/biliCategoriesData'
import { useCategories } from '../platforms/douyu/composables/useCategories'
import type { CategorySelectedEvent as CommonCategorySelectedEvent } from '../platforms/common/categoryTypes'
import { type UiPlatform, type FollowedStreamer } from '../platforms/common/types'

defineOptions({
  name: 'PlatformHomeView'
})

const router = useRouter()
const route = useRoute()
const followStore = useFollowStore()
const { followedStreamers } = storeToRefs(followStore)

// Layout State
const centerColumnRef = ref<HTMLElement | null>(null)
const isHeaderCollapsed = ref(false)
const isScrolling = ref(false)
let scrollTimer: number | null = null

const sidebarSelectedCate1Id = ref<string | null>(null)

const handleCenterScroll = (e: Event) => {
  const target = e.target as HTMLElement
  isHeaderCollapsed.value = target.scrollTop > 80
  
  isScrolling.value = true
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = window.setTimeout(() => {
    isScrolling.value = false
  }, 150)
}

const handleSelectHistory = (streamer: FollowedStreamer) => {
  router.push({ 
    name: 'UniversalPlayer', 
    params: { 
      platform: streamer.platform.toLowerCase(), 
      roomId: streamer.id 
    } 
  })
}

// Data Mapping
const platforms: { id: UiPlatform; name: string }[] = [
  { id: 'douyu', name: '斗鱼' },
  { id: 'huya', name: '虎牙' },
  { id: 'douyin', name: '抖音' },
  { id: 'bilibili', name: 'Bilibili' },
]

const categoryShortcuts = computed(() => {
  if (activePlatform.value === 'huya') return ['英雄联盟', '王者荣耀', '和平精英', '主机游戏']
  return ['全部', '网游', '手游', '单机']
})

const isShortcutActive = (name: string) => {
  return currentCategoryName.value === name
}

// Sidebar Navigation Logic
const sidebarCate1List = computed(() => {
  return categoryGroups.value.map(g => ({ id: g.id, title: g.title }))
})

const sidebarCate2List = computed(() => {
  if (!sidebarSelectedCate1Id.value) return []
  const group = categoryGroups.value.find(g => g.id === sidebarSelectedCate1Id.value)
  return group ? group.items : []
})

interface SelectedCategoryInfo {
  type: 'cate2' | 'cate3'
  id: string
  name?: string
}

interface CategoryItem {
  id: string
  title: string
}

interface CategoryGroup {
  id: string
  title: string
  items: CategoryItem[]
}

const platformConfigMap: Record<UiPlatform, { playerRouteName: string; defaultPageSize?: number }> = {
  douyu: { playerRouteName: 'UniversalPlayer' },
  douyin: { playerRouteName: 'UniversalPlayer' },
  huya: { playerRouteName: 'UniversalPlayer', defaultPageSize: 120 },
  bilibili: { playerRouteName: 'UniversalPlayer' }
}

const activePlatform = computed<UiPlatform>(() => (route.params.platform as UiPlatform) || 'douyu')
const platformConfig = computed(() => platformConfigMap[activePlatform.value])
const isDouyu = computed(() => activePlatform.value === 'douyu')

const categoriesData = computed(() => {
  if (activePlatform.value === 'douyin') return douyinCategoriesData
  if (activePlatform.value === 'huya') return huyaCategoriesData
  if (activePlatform.value === 'bilibili') return biliCategoriesData
  return []
})

const currentCategoryName = computed(() => {
  if (isDouyu.value) return selectedCategoryInfo.value?.name
  return selectedCategory.value?.cate2Name
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
  if (platform === activePlatform.value) return
  router.push({ name: 'PlatformHome', params: { platform } })
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
  sidebarSelectedCate1Id.value = null

  if (newPlatform === 'douyu') {
    initDouyuData()
  } else {
    initCommonData()
  }
}, { immediate: true })

watch(categoryGroups, (newGroups) => {
  if (newGroups.length > 0) {
    if (!sidebarSelectedCate1Id.value) {
      sidebarSelectedCate1Id.value = newGroups[0].id
    }
    
    // Auto-select first category if nothing is selected
    if (!currentSelectedId.value) {
      const firstGroup = newGroups[0]
      if (firstGroup.items.length > 0) {
        handleCategorySelect(firstGroup.items[0])
      }
    }
  }
}, { immediate: true })

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