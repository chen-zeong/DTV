"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type CategoryType = "cate2" | "cate3";

type CategoryState = {
  currentCategoryType: CategoryType | null;
  currentCategoryId: string | null;
  currentCategoryName: string | null;
};

type CategoryActions = {
  setCurrentCategory: (type: CategoryType, id: string, name: string) => void;
  clearCategory: () => void;
  hydrateFromLegacy: () => void;
};

export type CategoryStore = CategoryState & CategoryActions;

const storage = createJSONStorage<CategoryState>(() => (typeof window !== "undefined" ? localStorage : undefined));

export const useCategoryStore = create<CategoryStore>()(
  persist(
    (set, get) => ({
      currentCategoryType: null,
      currentCategoryId: null,
      currentCategoryName: null,

      setCurrentCategory(type, id, name) {
        set({ currentCategoryType: type, currentCategoryId: id, currentCategoryName: name });
      },

      clearCategory() {
        set({ currentCategoryType: null, currentCategoryId: null, currentCategoryName: null });
      },

      hydrateFromLegacy() {
        if (typeof window === "undefined") return;
        const { currentCategoryId, currentCategoryType } = get();
        if (currentCategoryId && currentCategoryType) return;
        try {
          const storedCategory = window.localStorage.getItem("currentCategory");
          if (storedCategory) {
            const cat = JSON.parse(storedCategory);
            if (cat && cat.type && cat.id) {
              set({ currentCategoryType: cat.type, currentCategoryId: cat.id, currentCategoryName: cat.name || "" });
            }
          }
        } catch (error) {
          console.warn("[category-store] parse currentCategory failed", error);
        }
      },
    }),
    {
      name: "category-store",
      storage,
    }
  )
);
