import { useCallback, useState } from "react";

/**
 * localStorage 读写 + 持久化 state。
 *
 * 旧项目里每个 Provider 都手写一遍 try/catch + JSON.parse + 默认值，
 * 且 localStorage 键名散落在组件内部。这里统一：键名集中在下面 KEY 常量。
 */

export const STORAGE_KEYS = {
  theme: "dtv_theme_v1",
  follows: "dtv_follows_v1",
  customCategories: "dtv_custom_categories_v1",
  playerQuality: (platform: string) => `${platform}_preferred_quality`,
  playerLine: (platform: string) => `${platform}_preferred_line`,
  playerVolume: "dtv_player_volume_v1",
  danmuPrefs: "dtv_danmu_preferences_v1",
  danmuKeywords: "danmu_block_keywords",
} as const;

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式/配额满：静默失败，不影响 UI */
  }
}

/** 与 localStorage 同步的 useState */
export function usePersistentState<T>(key: string, initial: T): [T, (next: T) => void] {
  const [state, setState] = useState<T>(() => loadJSON(key, initial));

  const set = useCallback(
    (next: T) => {
      setState(next);
      saveJSON(key, next);
    },
    [key],
  );

  return [state, set];
}
