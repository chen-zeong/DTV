<template>
  <div class="custom-home">
    <div class="custom-empty-tip" v-if="!entries.length">暂无收藏分区，去分类页订阅后会出现在这里。</div>

    <div class="custom-list" v-if="entries.length">
      <button
        v-for="entry in entries"
        :key="entry.key"
        type="button"
        class="custom-chip"
        :class="['platform-' + entry.platform, { active: selectedKey === entry.key }]"
        @click="selectEntry(entry)"
      >
        <span class="chip-platform">{{ platformLabel(entry.platform) }}</span>
        <span class="chip-name">{{ entry.cate2Name }}</span>
      </button>
    </div>

    <div class="custom-streamer-list" v-if="selectedEntry">
      <CommonStreamerList
        :selected-category="selectedCategory"
        :categories-data="selectedCategoriesData"
        :douyu-category="selectedDouyuCategory"
        :platform-name="selectedPlatform"
        :player-route-name="selectedRouteName"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import CommonStreamerList from '../components/CommonStreamerList/index.vue';
import { useCustomCategoryStore } from '../store/customCategoryStore';
import type { CustomCategoryEntry } from '../store/customCategoryStore';
import { douyinCategoriesData } from '../platforms/douyin/douyinCategoriesData';
import { huyaCategoriesData } from '../platforms/huya/huyaCategoriesData';
import { biliCategoriesData } from '../platforms/bilibili/biliCategoriesData';
import type { CategorySelectedEvent } from '../platforms/common/categoryTypes';

defineOptions({
  name: 'CustomHomeView',
});

const store = useCustomCategoryStore();
store.ensureLoaded();

const entries = computed(() => store.entries);
const selectedKey = ref<string | null>(null);

const selectEntry = (entry: CustomCategoryEntry) => {
  selectedKey.value = entry.key;
};


const selectedEntry = computed(() => store.entries.find((e) => e.key === selectedKey.value) ?? null);

onMounted(() => {
  if (!selectedKey.value && store.entries.length) {
    selectedKey.value = store.entries[0].key;
  }
});

watch(entries, (list) => {
  if (!list.length) {
    selectedKey.value = null;
    return;
  }
  const exists = list.some((e) => e.key === selectedKey.value);
  if (!exists) {
    selectedKey.value = list[0].key;
  }
});

const platformLabel = (p: string) => {
  if (p === 'douyu') return '斗鱼';
  if (p === 'douyin') return '抖音';
  if (p === 'huya') return '虎牙';
  if (p === 'bilibili') return 'Bilibili';
  return p;
};

const selectedPlatform = computed(() => selectedEntry.value?.platform ?? 'douyu');
const selectedRouteName = computed(() => {
  const p = selectedPlatform.value;
  if (p === 'douyin') return 'douyinPlayer';
  if (p === 'huya') return 'huyaPlayer';
  if (p === 'bilibili') return 'bilibiliPlayer';
  return 'douyuPlayer';
});

const selectedCategoriesData = computed(() => {
  const p = selectedPlatform.value;
  if (p === 'douyin') return douyinCategoriesData as any;
  if (p === 'huya') return huyaCategoriesData as any;
  if (p === 'bilibili') return biliCategoriesData as any;
  return undefined;
});

const selectedCategory = computed<CategorySelectedEvent | null>(() => {
  if (!selectedEntry.value || selectedEntry.value.platform === 'douyu') return null;
  return {
    type: 'cate2',
    cate1Href: selectedEntry.value.cate1Href || '',
    cate2Href: selectedEntry.value.cate2Href || '',
    cate1Name: selectedEntry.value.cate1Name || '',
    cate2Name: selectedEntry.value.cate2Name,
  };
});

const selectedDouyuCategory = computed(() => {
  if (!selectedEntry.value || selectedEntry.value.platform !== 'douyu') return null;
  return {
    type: 'cate2' as const,
    id: selectedEntry.value.douyuId || '',
    name: selectedEntry.value.cate2Name,
  };
});
</script>

<style scoped>
.custom-home {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: transparent;
}

.custom-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--primary-text);
  margin-bottom: 6px;
}

.custom-empty-tip {
  font-size: 12px;
  color: var(--secondary-text);
}

.custom-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 6px 12px 14px;
}

.custom-chip {
  border: none;
  background: var(--glass-bg);
  color: var(--primary-text, rgba(236, 242, 255, 0.9));
  border-radius: 16px;
  padding: 10px 16px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  transition: background 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  box-shadow: var(--glass-shadow, 0 10px 22px rgba(6, 10, 20, 0.28));
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.08));
}

.custom-chip.active {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(148, 163, 184, 0.55);
  box-shadow: 0 12px 24px rgba(12, 18, 30, 0.32), inset 0 0 0 1px rgba(148, 163, 184, 0.18);
  color: #ffffff;
}

.custom-chip:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 24px rgba(10, 15, 28, 0.32);
}

.chip-platform {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
}

.chip-name {
  font-size: 13px;
  font-weight: 600;
}


.custom-chip.platform-douyu .chip-platform {
  color: #ffb17a;
}

.custom-chip.platform-huya .chip-platform {
  color: #ffd37a;
}

.custom-chip.platform-douyin .chip-platform {
  color: #a78bfa;
}

.custom-chip.platform-bilibili .chip-platform {
  color: #ff9bd1;
}

:root[data-theme="light"] .custom-chip {
  background: var(--bg-tertiary);
  color: #6c7270;
  border: none;
  box-shadow: none;
}

:root[data-theme="light"] .custom-chip.active {
  background: var(--bg-secondary);
  color: #1f2937;
  border: none;
  box-shadow:
    0 6px 14px rgba(15, 23, 42, 0.08),
    0 2px 6px rgba(15, 23, 42, 0.06);
}

:root[data-theme="light"] .chip-platform {
  background: rgba(148, 163, 184, 0.18);
  color: #334155;
}

:root[data-theme="light"] .custom-chip.platform-douyu .chip-platform {
  color: #d97706;
}

:root[data-theme="light"] .custom-chip.platform-huya .chip-platform {
  color: #b45309;
}

:root[data-theme="light"] .custom-chip.platform-douyin .chip-platform {
  color: #4c1d95;
}

:root[data-theme="light"] .custom-chip.platform-bilibili .chip-platform {
  color: #c026d3;
}


.custom-streamer-list {
  flex: 1;
  overflow: hidden;
  background: transparent;
}
</style>
