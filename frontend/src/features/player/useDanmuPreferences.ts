import { useCallback, useEffect, useState } from "react";
import {
  loadDanmuPreferences,
  normalizeDanmuSettings,
  saveDanmuPreferences,
  type DanmuPreferences,
  type DanmuUserSettings,
} from "./danmuSettings";

/**
 * 弹幕开关 + 设置的状态与持久化。
 *
 * 首次挂载从 localStorage 读取（兼容老项目的 `dtv_danmu_preferences_v1`），
 * 之后任何变化都写回同一个键。设置面板只改 partial，归一化在这里统一做。
 */
export function useDanmuPreferences() {
  const [preferences, setPreferences] = useState<DanmuPreferences>(() =>
    loadDanmuPreferences(),
  );

  useEffect(() => {
    saveDanmuPreferences(preferences);
  }, [preferences]);

  const setEnabled = useCallback((enabled: boolean) => {
    setPreferences((prev) => ({ ...prev, enabled }));
  }, []);

  const updateSettings = useCallback((patch: Partial<DanmuUserSettings>) => {
    setPreferences((prev) => ({
      ...prev,
      settings: normalizeDanmuSettings({ ...prev.settings, ...patch }),
    }));
  }, []);

  return {
    enabled: preferences.enabled,
    settings: preferences.settings,
    setEnabled,
    updateSettings,
  };
}
