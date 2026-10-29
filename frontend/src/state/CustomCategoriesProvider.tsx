import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { STORAGE_KEYS, usePersistentState } from "@/lib/storage";

/**
 * 用户自定义分区。
 *
 * 旧项目这块（CustomCategoriesProvider）混了"分组 + 主播列表 + 排序 + 拖拽"，
 * 且数据结构与平台分区不兼容。骨架阶段先只保留"分组名 + 图标选择"，
 * 主播由用户后续添加（接后端后从 code/名称解析）。
 */

export interface CustomCategory {
  id: string;
  name: string;
  /** 用 emoji 做图标，避免额外图片资源 */
  icon: string;
  createdAt: number;
}

interface CustomCategoriesContextValue {
  entries: CustomCategory[];
  addCategory: (name: string, icon?: string) => void;
  removeCategory: (id: string) => void;
}

const CustomCategoriesContext = createContext<CustomCategoriesContextValue | null>(null);

const ICONS = ["🎮", "🎧", "🎬", "🏀", "🎤", "🧩", "📚", "🌙"];

export function CustomCategoriesProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = usePersistentState<CustomCategory[]>(
    STORAGE_KEYS.customCategories,
    [],
  );

  const addCategory = useCallback(
    (name: string, icon?: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setEntries([
        ...entries,
        {
          id: `custom-${Date.now()}`,
          name: trimmed,
          icon: icon ?? ICONS[entries.length % ICONS.length]!,
          createdAt: Date.now(),
        },
      ]);
    },
    [entries, setEntries],
  );

  const removeCategory = useCallback(
    (id: string) => setEntries(entries.filter((e) => e.id !== id)),
    [entries, setEntries],
  );

  const value = useMemo<CustomCategoriesContextValue>(
    () => ({ entries, addCategory, removeCategory }),
    [entries, addCategory, removeCategory],
  );

  return (
    <CustomCategoriesContext.Provider value={value}>{children}</CustomCategoriesContext.Provider>
  );
}

export function useCustomCategories(): CustomCategoriesContextValue {
  const ctx = useContext(CustomCategoriesContext);
  if (!ctx) throw new Error("useCustomCategories 必须在 CustomCategoriesProvider 内使用");
  return ctx;
}
