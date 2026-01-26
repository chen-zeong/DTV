import { ref, computed, Ref } from "vue";
import type { Category1, Category2, Category3 } from "../../../../types/models/category";
import { fetchDouyuCategories, fetchDouyuThreeCate } from "../../../../api/live";

export function useCategories(
  selectedCate1Id: Ref<number | null>,
  selectedCate2Id: Ref<number | null>,
) {
  const cate1List = ref<Category1[]>([]);
  const cate2List = ref<Category2[]>([]);
  const cate3Map = ref<Record<number, Category3[]>>({});
  const isLoadingCate3 = ref(false);

  interface RustFrontendCate3Item {
    id: string;
    name: string;
  }
  interface RustFrontendCate2Item {
    id: string;
    name: string;
    short_name: string;
    icon: string;
    cate3List: RustFrontendCate3Item[];
    cate1Id?: number; /* Will need to add this if C2s are flat */
  }
  interface RustFrontendCate1Item {
    id: string;
    name: string;
    cate2List: RustFrontendCate2Item[];
  }

  interface RustFrontendCategoryResponse {
    cate1List: RustFrontendCate1Item[];
  }

  const fetchCategories = async () => {
    console.log("开始获取分类数据");
    try {
      // Use API wrapper
      const response = (await fetchDouyuCategories()) as RustFrontendCategoryResponse;
      console.log("获取到的已解析分类数据:", response);

      // On success, response directly contains cate1List.
      // Errors are caught by the catch block.
      if (response && response.cate1List) {
        const fetchedCate1Items = response.cate1List;

        // Transform RustFrontendCate1Item to local Category1 and populate cate2List
        const allCate1: Category1[] = [];
        const allCate2: Category2[] = [];

        for (const c1 of fetchedCate1Items) {
          allCate1.push({
            cate1Id: parseInt(c1.id, 10), // Convert string ID to number
            cate1Name: c1.name,
          });

          for (const c2 of c1.cate2List) {
            allCate2.push({
              cate1Id: parseInt(c1.id, 10), // Link back to parent C1
              cate2Id: parseInt(c2.id, 10), // Convert string ID to number
              cate2Name: c2.name,
              shortName: c2.short_name,
              icon: c2.icon,
              count: 0,
            });
          }
        }

        cate1List.value = allCate1;
        cate2List.value = allCate2;
      }
    } catch (error) {
      console.error("获取分类数据失败:", error);
      throw error; // Re-throw for upstream handling
    }
  };

  interface CommonPlatformCategory {
    id: string;
    name: string;
    platform: string;
    icon_url: string | null;
    parent_id: string | null;
  }

  const fetchThreeCate = async (cate2Id: number) => {
    isLoadingCate3.value = true;
    try {
      const threeCategoriesResult = (await fetchDouyuThreeCate(cate2Id)) as CommonPlatformCategory[];

      const categoriesForMap: Category3[] = threeCategoriesResult.map(
        (item) => ({
          id: item.id, // Assuming Category3 has an 'id' field (string)
          name: item.name,
        }),
      );

      cate3Map.value = {
        ...cate3Map.value,
        [cate2Id]: categoriesForMap,
      };
    } catch (error) {
      cate3Map.value = { ...cate3Map.value, [cate2Id]: [] }; // Set to empty array on error
    } finally {
      isLoadingCate3.value = false;
    }
  };

  const sortedCate2List = computed(() => {
    if (selectedCate1Id.value === null) {
      return [];
    }

    const filtered = cate2List.value
      .filter((cate2: Category2) => (cate2 as any).cate1Id === selectedCate1Id.value)
      .sort((a: Category2, b: Category2) => ((b as any).count || 0) - ((a as any).count || 0));
    return filtered;
  });

  const currentCate3List = computed(() => {
    if (!selectedCate2Id.value) return [];
    return cate3Map.value[selectedCate2Id.value] || [];
  });

  return {
    cate1List,
    cate2List,
    cate3Map,
    isLoadingCate3,
    fetchCategories,
    fetchThreeCate,
    sortedCate2List,
    currentCate3List,
  };
}
