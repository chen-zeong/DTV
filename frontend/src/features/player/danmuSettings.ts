import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";

/**
 * 弹幕偏好设置。
 *
 * 存储结构与老项目保持一致（`dtv_danmu_preferences_v1`）：
 *   { enabled: boolean, settings: { color, strokeColor, fontSize, duration, area, mode, opacity } }
 * 这样从旧版迁移过来时，已经保存过的设置可以直接复用。
 */
export type DanmuMode = "scroll" | "top" | "bottom";

export interface DanmuUserSettings {
  /** 弹幕文字颜色，十六进制 */
  color: string;
  /** 描边颜色，十六进制 */
  strokeColor: string;
  /** 字号，存成 "20px" 以兼容老数据 */
  fontSize: string;
  /** 滚动穿过屏幕的时长（毫秒） */
  duration: number;
  /** 显示区域：0.25 / 0.5 / 0.75（屏幕上方比例） */
  area: number;
  mode: DanmuMode;
  /** 0.2 ~ 1 */
  opacity: number;
  /** 使用平台自带的弹幕颜色；平台不支持或消息无颜色时回退到 color */
  colorful: boolean;
}

export interface DanmuPreferences {
  enabled: boolean;
  settings: DanmuUserSettings;
}

export const DANMU_FONT_MIN = 14;
export const DANMU_FONT_MAX = 30;
export const DANMU_FONT_STEP = 2;

export const DANMU_DURATION_MIN = 5000;
export const DANMU_DURATION_MAX = 20000;
export const DANMU_DURATION_STEP = 500;

export const DANMU_AREA_OPTIONS = [0.25, 0.5, 0.75, 1] as const;

export const DANMU_OPACITY_MIN = 0.2;
export const DANMU_OPACITY_MAX = 1;
export const DANMU_OPACITY_STEP = 0.05;

export const DEFAULT_DANMU_SETTINGS: DanmuUserSettings = {
  color: "#ffffff",
  strokeColor: "#444444",
  fontSize: "20px",
  duration: 10000,
  area: 0.5,
  mode: "scroll",
  opacity: 1,
  colorful: true,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function sanitizeDanmuArea(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DANMU_SETTINGS.area;
  return DANMU_AREA_OPTIONS.reduce(
    (prev, curr) => (Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev),
    DANMU_AREA_OPTIONS[0],
  );
}

export function sanitizeDanmuOpacity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DANMU_SETTINGS.opacity;
  return clamp(value, DANMU_OPACITY_MIN, DANMU_OPACITY_MAX);
}

export function sanitizeDanmuFontSize(value: number): number {
  if (!Number.isFinite(value)) return parseInt(DEFAULT_DANMU_SETTINGS.fontSize, 10);
  return clamp(Math.round(value / DANMU_FONT_STEP) * DANMU_FONT_STEP, DANMU_FONT_MIN, DANMU_FONT_MAX);
}

export function normalizeDanmuSettings(
  raw: Partial<DanmuUserSettings> | null | undefined,
): DanmuUserSettings {
  const source = raw ?? {};
  const rawFont =
    typeof source.fontSize === "string"
      ? parseInt(source.fontSize, 10)
      : typeof source.fontSize === "number"
        ? source.fontSize
        : parseInt(DEFAULT_DANMU_SETTINGS.fontSize, 10);

  return {
    color: isHexColor(source.color) ? source.color : DEFAULT_DANMU_SETTINGS.color,
    strokeColor: isHexColor(source.strokeColor)
      ? source.strokeColor
      : DEFAULT_DANMU_SETTINGS.strokeColor,
    fontSize: `${sanitizeDanmuFontSize(rawFont)}px`,
    duration: clamp(
      Number.isFinite(source.duration) ? Number(source.duration) : DEFAULT_DANMU_SETTINGS.duration,
      DANMU_DURATION_MIN,
      DANMU_DURATION_MAX,
    ),
    area: sanitizeDanmuArea(
      Number.isFinite(source.area) ? Number(source.area) : DEFAULT_DANMU_SETTINGS.area,
    ),
    mode:
      source.mode === "top" || source.mode === "bottom" || source.mode === "scroll"
        ? source.mode
        : DEFAULT_DANMU_SETTINGS.mode,
    opacity: sanitizeDanmuOpacity(
      Number.isFinite(source.opacity) ? Number(source.opacity) : DEFAULT_DANMU_SETTINGS.opacity,
    ),
    colorful:
      typeof source.colorful === "boolean" ? source.colorful : DEFAULT_DANMU_SETTINGS.colorful,
  };
}

export function loadDanmuPreferences(): DanmuPreferences {
  const raw = loadJSON<Partial<DanmuPreferences> | null>(STORAGE_KEYS.danmuPrefs, null);
  if (!raw || typeof raw !== "object") {
    return { enabled: true, settings: { ...DEFAULT_DANMU_SETTINGS } };
  }
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    settings: normalizeDanmuSettings(raw.settings),
  };
}

export function saveDanmuPreferences(preferences: DanmuPreferences): void {
  saveJSON(STORAGE_KEYS.danmuPrefs, preferences);
}

export function formatDanmuDuration(value: number): string {
  if (value <= 4500) return "极快";
  if (value <= 7500) return "很快";
  if (value <= 10000) return "标准";
  if (value <= 14000) return "稍慢";
  return "慢速";
}

export function formatDanmuArea(value: number): string {
  const area = sanitizeDanmuArea(value);
  if (area <= 0.25) return "上 1/4";
  if (area <= 0.5) return "上 1/2";
  if (area <= 0.75) return "上 3/4";
  return "全屏";
}

/* ------------------------------------------------------------------ 弹幕屏蔽 */

/** 最多能存多少条屏蔽关键词 */
export const DANMU_BLOCK_MAX_KEYWORDS = 40;
/** 单条关键词的最大长度 */
export const DANMU_BLOCK_MAX_LENGTH = 40;

/**
 * 归一化屏蔽关键词列表（去空、去重、限长、限量）。
 *
 * 去重按小写比较：匹配时也走小写包含，所以 "ABC" 和 "abc" 是同一个词。
 */
export function normalizeDanmuBlockKeywords(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim().slice(0, DANMU_BLOCK_MAX_LENGTH);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= DANMU_BLOCK_MAX_KEYWORDS) break;
  }
  return out;
}

/** 读屏蔽关键词（老项目的键名 `danmu_block_keywords`，值就是字符串数组）。 */
export function loadDanmuBlockKeywords(): string[] {
  return normalizeDanmuBlockKeywords(loadJSON<unknown>(STORAGE_KEYS.danmuKeywords, []));
}

export function saveDanmuBlockKeywords(keywords: string[]): void {
  saveJSON(STORAGE_KEYS.danmuKeywords, normalizeDanmuBlockKeywords(keywords));
}

/**
 * 判断一条弹幕是否命中屏蔽词。
 *
 * `keywordsLower` 是已经小写化的关键词（调用方缓存，避免每条弹幕都做一遍转换）。
 */
export function isDanmuBlocked(content: string, keywordsLower: readonly string[]): boolean {
  if (keywordsLower.length === 0) return false;
  const text = String(content ?? "").toLowerCase();
  if (!text) return false;
  for (const keyword of keywordsLower) {
    if (keyword && text.includes(keyword)) return true;
  }
  return false;
}
