import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { UiPlatform } from "../types/app/platform";
import type { CategorySelectedEvent, Category1, Category2 } from "../types/models/category";
import { useCategories as useDouyuCategories } from "../services/platforms/douyu/composables/useCategories";
import { douyinCategoriesData } from "../services/platforms/douyin/douyinCategoriesData";
import { huyaCategoriesData } from "../services/platforms/huya/huyaCategoriesData";
import { biliCategoriesData } from "../services/platforms/bilibili/biliCategoriesData";

interface SelectedCategoryInfo {
  type: "cate2" | "cate3";
  id: string;
  name?: string;
}

export const useCategoryStore = defineStore("category", () => {
  const activePlatform = ref<UiPlatform>("douyu");
  const selectedCategory = ref<CategorySelectedEvent | null>(null);
  const selectedCategoryInfo = ref<SelectedCategoryInfo | null>(null);
  
  // Douyu specific
  const douyuSelectedC1 = ref<number | null>(null);
  const douyuSelectedC2 = ref<number | null>(null);
  const {
    cate1List: douyuCate1List,
    cate2List: douyuCate2List,
    fetchCategories: fetchDouyuCategories,
    currentCate3List,
    fetchThreeCate
  } = useDouyuCategories(douyuSelectedC1, douyuSelectedC2);
  
  const isDouyuLoading = ref(false);

  const categoriesData = computed(() => {
    if (activePlatform.value === "douyin") return douyinCategoriesData as Category1[];
    if (activePlatform.value === "huya") return huyaCategoriesData as Category1[];
    if (activePlatform.value === "bilibili") return biliCategoriesData as Category1[];
    return [] as Category1[];
  });

  const isDouyu = computed(() => activePlatform.value === "douyu");

  const categoryGroups = computed(() => {
    if (isDouyu.value) {
      return douyuCate1List.value.map((c1: Category1) => ({
        id: String(c1.cate1Id || c1.id || ""),
        title: c1.cate1Name || (c1 as any).name || "未知分类",
        items: douyuCate2List.value
          .filter((c2: Category2) => (c2 as any).cate1Id === (c1.cate1Id || c1.id))
          .map((c2: Category2) => ({
            id: (c2 as any).shortName || (c2 as any).short_name || String(c2.id || ""),
            title: (c2 as any).cate2Name || c2.title || "未知分类",
          })),
      }));
    } else {
      return categoriesData.value.map((c1: Category1) => ({
        id: c1.href || "",
        title: c1.title || "未知分类",
        items: ((c1.subcategories || []) as Category2[]).map((c2: Category2) => ({
          id: c2.href || "",
          title: c2.title || "未知分类",
        })),
      }));
    }
  });

  const initDouyuData = async () => {
    if (douyuCate1List.value.length > 0) return;
    isDouyuLoading.value = true;
    try {
      await fetchDouyuCategories();
      if (douyuCate2List.value.length > 0 && !selectedCategoryInfo.value) {
        const firstC1 = douyuCate1List.value[0];
        if (firstC1) {
          const firstC2 = douyuCate2List.value.find(
            (c2: Category2) => (c2 as any).cate1Id === (firstC1.cate1Id || firstC1.id),
          );
          if (firstC2) {
            selectedCategoryInfo.value = {
              type: "cate2",
              id: (firstC2 as any).shortName || (firstC2 as any).short_name || String(firstC2.id),
              name: (firstC2 as any).cate2Name || firstC2.title,
            };
          }
        }
      }
    } catch (e) {
      console.error("Failed to load Douyu categories", e);
    } finally {
      isDouyuLoading.value = false;
    }
  };

  const initCommonData = () => {
    if (categoriesData.value.length > 0 && !selectedCategory.value) {
      const firstC1 = categoriesData.value[0];
      if (firstC1 && firstC1.subcategories && firstC1.subcategories.length > 0) {
        const firstC2 = firstC1.subcategories[0];
        selectedCategory.value = {
          type: "cate2",
          cate1Href: firstC1.href || "",
          cate2Href: firstC2.href || "",
          cate1Name: firstC1.title || "",
          cate2Name: firstC2.title || "",
        };
      }
    }
  };

  const handleCategorySelect = (item: { id: string; title: string }) => {
    if (isDouyu.value) {
      const match = douyuCate2List.value.find((c: Category2) => ((c as any).shortName || (c as any).short_name) === item.id);
      if (match) {
        douyuSelectedC2.value = (match as any).cate2Id || match.id;
        fetchThreeCate((match as any).cate2Id || match.id);
      }
      selectedCategoryInfo.value = { type: "cate2", id: item.id, name: item.title };
    } else {
      const group = categoryGroups.value.find((g) => g.items.some((i) => i.id === item.id));
      if (group) {
        selectedCategory.value = {
          type: "cate2",
          cate1Href: group.id,
          cate2Href: item.id,
          cate1Name: group.title,
          cate2Name: item.title,
        };
      }
    }
  };

  const setPlatform = (platform: UiPlatform) => {
    if (activePlatform.value === platform) return;
    activePlatform.value = platform;
    selectedCategory.value = null;
    selectedCategoryInfo.value = null;
    if (platform === "douyu") initDouyuData();
    else initCommonData();
  };

  return {
    activePlatform,
    selectedCategory,
    selectedCategoryInfo,
    douyuSelectedC1,
    douyuSelectedC2,
    douyuCate1List,
    douyuCate2List,
    currentCate3List,
    isDouyuLoading,
    categoriesData,
    isDouyu,
    categoryGroups,
    initDouyuData,
    initCommonData,
    handleCategorySelect,
    setPlatform,
    fetchThreeCate
  };
});