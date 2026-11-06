import { useCallback, useRef, useState } from "react";

/**
 * localStorage 读写 + 持久化 state。
 *
 * 键名与老 Tauri 版本保持一致，方便 JSON 迁移和旧数据继续使用。
 * 老版本升级到 4.0 时，下面的 migrateStorageKeys() 会把 4.0 早期键名
 * 自动搬到旧键名上。
 */

export const STORAGE_KEYS = {
  theme: "theme_preference",
  follows: "followedStreamers",
  /** 关注分组（文件夹） */
  followFolders: "followFolders",
  /** 顶层关注主播的排序 */
  followOrder: "followListOrder",
  /** 订阅的分区（老版键名，值为兼容后的订阅数组） */
  subscriptions: "dtv_custom_categories_v1",
  playerQuality: (platform: string) => `${platform.toUpperCase()}_preferred_quality`,
  playerLine: (platform: string) => `${platform.toUpperCase()}_preferred_line`,
  playerVolume: "dtv_player_volume_v1",
  /** 静音状态：与音量分开，音量 0 时恢复静音前的值 */
  playerMuted: "dtv_player_muted_v1",
  /** 列表滚动位置（sessionStorage，按路由 key） */
  scrollPosition: (key: string) => `dtv_scroll_${key}`,
  /** 弹幕偏好 */
  danmuPrefs: "dtv_danmu_preferences_v1",
  danmuKeywords: "danmu_block_keywords",
  /** 播放器右侧弹幕列表是否折叠（老版语义） */
  danmuPanelCollapsed: "dtv_player_danmu_collapsed",
  /** 右侧弹幕面板宽度（px，168–320）。
   * v2：默认值从 224 收窄到 196，旧键会让老用户一直停在 224，所以换新键。 */
  danmuPanelWidth: "dtv_danmu_panel_width_v2",
  /** B 站登录 Cookie（扫码登录后写入） */
  bilibiliCookie: "bilibili_cookie",
  /** 斗鱼登录 Cookie（扫码登录后写入） */
  douyuCookie: "douyu_cookie",
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

/** 老项目的主题、清晰度、线路、Cookie 都是裸字符串，不走 JSON。 */
export function loadRaw(key: string, fallback = ""): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveRaw(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------- sessionStorage：滚动位置 */

export function loadSessionNumber(key: string, fallback = 0): number {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw == null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function saveSessionNumber(key: string, value: number): void {
  try {
    window.sessionStorage.setItem(key, String(Math.max(0, Math.round(value))));
  } catch {
    /* ignore */
  }
}

/**
 * 把 4.0 早期使用的 dtv_* 键搬到老版键名。
 * 只在新键存在、旧键不存在时迁移，避免覆盖真正的老数据。
 */
export function migrateStorageKeys(): void {
  if (typeof window === "undefined") return;
  try {
    const storage = window.localStorage;
    const moveJSON = (oldKey: string, newKey: string) => {
      if (storage.getItem(oldKey) != null) return;
      const value = storage.getItem(newKey);
      if (value != null) storage.setItem(oldKey, value);
      storage.removeItem(newKey);
    };
    const moveRaw = (oldKey: string, newKey: string) => {
      if (storage.getItem(oldKey) != null) return;
      const value = storage.getItem(newKey);
      if (value == null) return;
      let next = value;
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === "string") next = parsed;
        else if (typeof parsed === "boolean") next = parsed ? "true" : "false";
      } catch {
        // already raw
      }
      storage.setItem(oldKey, next);
      storage.removeItem(newKey);
    };

    moveJSON(STORAGE_KEYS.follows, "dtv_follows_v1");
    moveJSON(STORAGE_KEYS.followFolders, "dtv_follow_folders_v1");
    moveJSON(STORAGE_KEYS.followOrder, "dtv_follow_order_v1");
    moveJSON(STORAGE_KEYS.subscriptions, "dtv_subscriptions_v1");
    moveRaw(STORAGE_KEYS.theme, "dtv_theme_v1");
    moveRaw(STORAGE_KEYS.bilibiliCookie, "dtv_bilibili_cookie_v1");

    for (const platform of ["douyu", "huya", "douyin", "bilibili"]) {
      moveRaw(STORAGE_KEYS.playerQuality(platform), `${platform}_preferred_quality`);
      moveRaw(STORAGE_KEYS.playerLine(platform), `${platform}_preferred_line`);
    }

    if (storage.getItem(STORAGE_KEYS.danmuPanelCollapsed) == null) {
      const legacyOpen = storage.getItem("dtv_danmu_panel_open_v1");
      if (legacyOpen != null) {
        try {
          storage.setItem(STORAGE_KEYS.danmuPanelCollapsed, JSON.stringify(!JSON.parse(legacyOpen)));
        } catch {
          // ignore
        }
        storage.removeItem("dtv_danmu_panel_open_v1");
      }
    }
  } catch {
    // localStorage 不可用时忽略迁移
  }
}

/** 与 localStorage 同步的 useState（写盘时机与 setState 一致，支持函数式更新） */
export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => loadJSON(key, initial));

  // 用 ref 镜像当前值：函数式更新需要读"最新值"，但又不能在 setState 的
  // updater 里写 localStorage（StrictMode 下 updater 会被调用两次）。
  const stateRef = useRef(state);
  stateRef.current = state;

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const value =
        typeof next === "function" ? (next as (prev: T) => T)(stateRef.current) : next;
      stateRef.current = value;
      setState(value);
      saveJSON(key, value);
    },
    [key],
  );

  return [state, set];
}
