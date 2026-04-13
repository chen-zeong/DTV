"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type CustomPlatform = "douyu" | "douyin" | "huya" | "bilibili";

export interface CustomCategoryEntry {
  key: string;
  platform: CustomPlatform;
  cate2Name: string;
  cate1Name?: string;
  cate1Href?: string;
  cate2Href?: string;
  douyuId?: string;
}

type CustomCategoriesContextValue = {
  entries: CustomCategoryEntry[];
  hydrated: boolean;
  isSubscribed: (platform: CustomPlatform, id: string) => boolean;
  addDouyuCate2: (shortName: string, cate2Name: string) => void;
  addCommonCate2: (platform: CustomPlatform, cate2Href: string, cate2Name: string, cate1Name?: string, cate1Href?: string) => void;
  removeByKey: (key: string) => void;
};

const STORAGE_KEY = "dtv_custom_categories_v1";

const CustomCategoriesContext = createContext<CustomCategoriesContextValue | null>(null);

const normalizeText = (value?: string | null) => (value ?? "").trim();
const buildKey = (platform: CustomPlatform, id: string) => `${platform}:${id}`;

function loadEntries(): CustomCategoryEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.key === "string") as CustomCategoryEntry[];
  } catch {
    return [];
  }
}

function persistEntries(entries: CustomCategoryEntry[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore
  }
}

export function CustomCategoriesProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<CustomCategoryEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setEntries(loadEntries());
    setHydrated(true);
  }, []);

  useEffect(() => {
    persistEntries(entries);
  }, [entries]);

  const value = useMemo<CustomCategoriesContextValue>(() => {
    return {
      entries,
      hydrated,
      isSubscribed: (platform, id) => {
        const key = buildKey(platform, id);
        return entries.some((e) => e.key === key);
      },
      addDouyuCate2: (shortName, cate2Name) => {
        const id = normalizeText(shortName);
        const name = normalizeText(cate2Name) || id;
        if (!id) return;
        const key = buildKey("douyu", id);
        setEntries((prev) => {
          if (prev.some((e) => e.key === key)) return prev;
          return [...prev, { key, platform: "douyu", cate2Name: name, douyuId: id }];
        });
      },
      addCommonCate2: (platform, cate2Href, cate2Name, cate1Name, cate1Href) => {
        const href = normalizeText(cate2Href);
        const name = normalizeText(cate2Name) || href;
        if (!href) return;
        const key = buildKey(platform, href);
        setEntries((prev) => {
          if (prev.some((e) => e.key === key)) return prev;
          return [
            ...prev,
            {
              key,
              platform,
              cate2Name: name,
              cate1Name: normalizeText(cate1Name) || undefined,
              cate1Href: normalizeText(cate1Href) || undefined,
              cate2Href: href
            }
          ];
        });
      },
      removeByKey: (key) => {
        setEntries((prev) => prev.filter((e) => e.key !== key));
      }
    };
  }, [entries, hydrated]);

  return <CustomCategoriesContext.Provider value={value}>{children}</CustomCategoriesContext.Provider>;
}

export function useCustomCategories() {
  const ctx = useContext(CustomCategoriesContext);
  if (!ctx) throw new Error("useCustomCategories must be used within CustomCategoriesProvider");
  return ctx;
}
