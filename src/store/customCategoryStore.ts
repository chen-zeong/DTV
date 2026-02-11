import { defineStore } from 'pinia';

export type CustomPlatform = 'douyu' | 'douyin' | 'huya' | 'bilibili';

export interface CustomCategoryEntry {
  key: string;
  platform: CustomPlatform;
  cate2Name: string;
  cate1Name?: string;
  cate1Href?: string;
  cate2Href?: string;
  douyuId?: string;
}

const STORAGE_KEY = 'dtv_custom_categories_v1';

const normalizeText = (value?: string | null) => (value ?? '').trim();

const buildKey = (platform: CustomPlatform, id: string) => `${platform}:${id}`;
const toLower = (value?: string | null) => (value ?? '').trim().toLowerCase();
const shouldPrune = (entry: CustomCategoryEntry) => {
  const name = toLower(entry.cate2Name);
  if (entry.platform === 'douyu' && (name === '热门游戏' || name === '穿越火线')) return true;
  if (entry.platform === 'huya' && name === '英雄联盟') return true;
  if (entry.platform === 'bilibili' && name === '英雄联盟') return true;
  return false;
};

export const useCustomCategoryStore = defineStore('customCategories', {
  state: () => ({
    entries: [] as CustomCategoryEntry[],
    loaded: false,
  }),
  getters: {
    hasEntries: (state) => state.entries.length > 0,
    groupedByPlatform: (state) => {
      const map: Record<CustomPlatform, CustomCategoryEntry[]> = {
        douyu: [],
        douyin: [],
        huya: [],
        bilibili: [],
      };
      state.entries.forEach((entry) => {
        map[entry.platform].push(entry);
      });
      return map;
    },
  },
  actions: {
    ensureLoaded() {
      if (this.loaded) return;
      if (typeof window === 'undefined') {
        this.loaded = true;
        return;
      }
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            this.entries = parsed.filter((item) => item && typeof item.key === 'string');
          }
        }
        const pruned = this.entries.filter((entry) => !shouldPrune(entry));
        if (pruned.length !== this.entries.length) {
          this.entries = pruned;
          this.persist();
        }
      } catch (err) {
        console.warn('[CustomCategoryStore] Failed to load categories:', err);
      } finally {
        this.loaded = true;
      }
    },
    persist() {
      if (typeof window === 'undefined') return;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
      } catch (err) {
        console.warn('[CustomCategoryStore] Failed to save categories:', err);
      }
    },
    isSubscribed(platform: CustomPlatform, id: string) {
      const key = buildKey(platform, id);
      return this.entries.some((entry) => entry.key === key);
    },
    addDouyuCate2(shortName: string, cate2Name: string) {
      const id = normalizeText(shortName);
      const name = normalizeText(cate2Name) || id;
      if (!id) return;
      const key = buildKey('douyu', id);
      if (this.entries.some((e) => e.key === key)) return;
      this.entries = [
        ...this.entries,
        {
          key,
          platform: 'douyu',
          cate2Name: name,
          douyuId: id,
        },
      ];
      this.persist();
    },
    addCommonCate2(platform: CustomPlatform, cate2Href: string, cate2Name: string, cate1Name?: string, cate1Href?: string) {
      const href = normalizeText(cate2Href);
      const name = normalizeText(cate2Name) || href;
      if (!href) return;
      const key = buildKey(platform, href);
      if (this.entries.some((e) => e.key === key)) return;
      this.entries = [
        ...this.entries,
        {
          key,
          platform,
          cate2Name: name,
          cate1Name: normalizeText(cate1Name) || undefined,
          cate1Href: normalizeText(cate1Href) || undefined,
          cate2Href: href,
        },
      ];
      this.persist();
    },
    removeByKey(key: string) {
      this.entries = this.entries.filter((entry) => entry.key !== key);
      this.persist();
    },
  },
});
