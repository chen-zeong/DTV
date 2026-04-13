import { platform } from '@tauri-apps/plugin-os';

export type DanmuUserSettings = {
  color: string;
  strokeColor: string;
  fontSize: string;
  duration: number;
  area: number;
  mode: 'scroll' | 'top' | 'bottom';
  opacity: number;
};

export const DANMU_PREFERENCES_STORAGE_KEY = 'dtv_danmu_preferences_v1';
export const DANMU_AREA_OPTIONS = [0.25, 0.5, 0.75] as const;
export const DANMU_OPACITY_MIN = 0.2;
export const DANMU_OPACITY_MAX = 1;
export const PLAYER_VOLUME_STORAGE_KEY = 'dtv_player_volume_v1';
export const DEFAULT_DANMU_FONT_FAMILY = '"OPPO Sans", "Microsoft YaHei", "PingFang SC", "Helvetica Neue", Arial, sans-serif';
export const WINDOWS_DANMU_FONT_FAMILY = '"OPPO Sans", "Microsoft YaHei", "Segoe UI", sans-serif';

export const sanitizeDanmuArea = (value: number): number => {
  return DANMU_AREA_OPTIONS.reduce((prev, curr) => (Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev), DANMU_AREA_OPTIONS[0]);
};

export const sanitizeDanmuOpacity = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(DANMU_OPACITY_MAX, Math.max(DANMU_OPACITY_MIN, value));
};

export const loadStoredVolume = (): number | null => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(PLAYER_VOLUME_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.min(1, Math.max(0, parsed));
    }
    return null;
  } catch (error) {
    console.warn('[Player] Failed to load stored volume:', error);
    return null;
  }
};

export const persistStoredVolume = (volume: number) => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    const clamped = Math.min(1, Math.max(0, volume));
    window.localStorage.setItem(PLAYER_VOLUME_STORAGE_KEY, String(clamped));
  } catch (error) {
    console.warn('[Player] Failed to persist volume:', error);
  }
};

export const loadDanmuPreferences = (): { enabled: boolean; settings: DanmuUserSettings } | null => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(DANMU_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const settings = parsed.settings ?? {};
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
      settings: {
        color: typeof settings.color === 'string' ? settings.color : '#ffffff',
        strokeColor: typeof settings.strokeColor === 'string' ? settings.strokeColor : '#444444',
        fontSize: typeof settings.fontSize === 'string' ? settings.fontSize : '20px',
        duration: Number.isFinite(settings.duration) ? settings.duration : 10000,
        area: Number.isFinite(settings.area) ? sanitizeDanmuArea(settings.area) : 0.5,
        mode: settings.mode === 'top' || settings.mode === 'bottom' ? settings.mode : 'scroll',
        opacity: Number.isFinite(settings.opacity) ? sanitizeDanmuOpacity(settings.opacity) : 1,
      },
    };
  } catch (error) {
    console.warn('[DanmuPreferences] Failed to load preferences:', error);
    return null;
  }
};

export const persistDanmuPreferences = (payload: { enabled: boolean; settings: DanmuUserSettings }) => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(DANMU_PREFERENCES_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('[DanmuPreferences] Failed to persist preferences:', error);
  }
};

export const createLucideIconSvg = (name: string, inner: string) => {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="lucide lucide-${name}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
};

export const ICONS = {
  play: createLucideIconSvg('play', '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"></path>'),
  pause: createLucideIconSvg('pause', '<rect x="14" y="3" width="5" height="18" rx="1"></rect><rect x="5" y="3" width="5" height="18" rx="1"></rect>'),
  maximize2: createLucideIconSvg('maximize-2', '<path d="M15 3h6v6"></path><path d="m21 3-7 7"></path><path d="m3 21 7-7"></path><path d="M9 21H3v-6"></path>'),
  minimize2: createLucideIconSvg('minimize-2', '<path d="m14 10 7-7"></path><path d="M20 10h-6V4"></path><path d="m3 21 7-7"></path><path d="M4 14h6v6"></path>'),
  fullscreen: createLucideIconSvg('fullscreen', '<path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><rect width="10" height="8" x="7" y="8" rx="1"></rect>'),
  pictureInPicture2: createLucideIconSvg('picture-in-picture-2', '<path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"></path><rect width="10" height="7" x="12" y="13" rx="2"></rect>'),
  cog: createLucideIconSvg('cog', '<path d="M11 10.27 7 3.34"></path><path d="m11 13.73-4 6.93"></path><path d="M12 22v-2"></path><path d="M12 2v2"></path><path d="M14 12h8"></path><path d="m17 20.66-1-1.73"></path><path d="m17 3.34-1 1.73"></path><path d="M2 12h2"></path><path d="m20.66 17-1.73-1"></path><path d="m20.66 7-1.73 1"></path><path d="m3.34 17 1.73-1"></path><path d="m3.34 7 1.73 1"></path><circle cx="12" cy="12" r="2"></circle><circle cx="12" cy="12" r="8"></circle>'),
  rotateCcw: createLucideIconSvg('rotate-ccw', '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path>'),
  volume2: createLucideIconSvg('volume-2', '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"></path><path d="M16 9a5 5 0 0 1 0 6"></path><path d="M19.364 18.364a9 9 0 0 0 0-12.728"></path>')
};

export const applyDanmuFontFamilyForOS = async () => {
  if (typeof document === 'undefined') {
    return '';
  }
  let osName = '';
  try {
    osName = await platform();
  } catch (error) {
    console.warn('[Player] Failed to detect platform for danmu font selection:', error);
    osName = '';
  }

  const root = document.documentElement;
  if (!root) {
    return osName;
  }

  if (/windows|win32/i.test(osName)) {
    root.style.setProperty('--danmu-font-family', WINDOWS_DANMU_FONT_FAMILY);
  } else {
    root.style.setProperty('--danmu-font-family', DEFAULT_DANMU_FONT_FAMILY);
  }

  return osName;
};
