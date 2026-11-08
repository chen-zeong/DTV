/**
 * 主题配色表。
 *
 * 6 套主题按“同色系日夜一行”排列：
 *   青柠·夜 / 青柠·日
 *   黑白灰·夜 / 黑白灰·日
 *   琥珀·夜 / 书页·日
 *
 * 每套都是完整配色（背景、表面、文字、强调色、状态色），不是只换强调色。
 * CSS 变量定义在 `styles/theme.css` 的 `[data-palette="..."]` 里。
 */

export const THEME_IDS = [
  "signal",
  "daylight",
  "mono",
  "paper",
  "ember",
  "parchment",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];
export type ThemeMode = "dark" | "light";

export interface ThemeOption {
  id: ThemeId;
  /** 中文名，顶栏配色面板里显示 */
  name: string;
  /** 一句话描述配色气质 */
  description: string;
  mode: ThemeMode;
  /** 预览色：背景 / 表面 / 强调色 */
  swatch: readonly [string, string, string];
}

export const THEMES: readonly ThemeOption[] = [
  {
    id: "signal",
    name: "青柠·夜",
    description: "石墨黑 + 信号青柠，默认夜间配色",
    mode: "dark",
    swatch: ["#0a0b0d", "#14161b", "#d8ff4f"],
  },
  {
    id: "daylight",
    name: "青柠·日",
    description: "4.x 原版浅色 + 信号青柠",
    mode: "light",
    swatch: ["#f1f2f4", "#ffffff", "#d8ff4f"],
  },
  {
    id: "mono",
    name: "黑白灰·夜",
    description: "纯灰黑 + 白色强调，极简无彩色",
    mode: "dark",
    swatch: ["#0a0a0a", "#14161b", "#e5e5e5"],
  },
  {
    id: "paper",
    name: "黑白灰·日",
    description: "纸白 + 墨黑强调，极简无彩色",
    mode: "light",
    swatch: ["#f4f4f5", "#ffffff", "#18181b"],
  },
  {
    id: "ember",
    name: "琥珀·夜",
    description: "暖炭黑 + 琥珀橙",
    mode: "dark",
    swatch: ["#100c08", "#14161b", "#ffab5c"],
  },
  {
    id: "parchment",
    name: "书页·日",
    description: "米纸底 + 赭石橙，书本纸张质感",
    mode: "light",
    swatch: ["#f3ead8", "#fffaf0", "#b45309"],
  },
];

export const DEFAULT_THEME: ThemeId = "signal";

const THEME_BY_ID = new Map<string, ThemeOption>(THEMES.map((theme) => [theme.id, theme]));

/**
 * 旧版本 / 上一轮九套主题的 id 映射。
 * 浅色旧主题落到青柠·日，深色旧主题落到青柠·夜，避免升级后突然变黑。
 */
const LEGACY_THEME_MAP: Record<string, ThemeId> = {
  light: "daylight",
  dark: "signal",
  frost: "daylight",
  sand: "daylight",
  sakura: "daylight",
  midnight: "signal",
  violet: "signal",
  forest: "signal",
  rose: "signal",
  ember: "ember",
  mono: "mono",
  paper: "paper",
};

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_BY_ID.has(value);
}

export function getTheme(id: ThemeId): ThemeOption {
  return THEME_BY_ID.get(id) ?? THEMES[0]!;
}

export function normalizeThemeId(
  raw: string | null | undefined,
  systemIsDark: boolean,
): ThemeId {
  const value = (raw ?? "").trim();
  if (isThemeId(value)) return value;
  const legacy = LEGACY_THEME_MAP[value];
  if (legacy) return legacy;
  if (value === "system") return systemIsDark ? "signal" : "daylight";
  return DEFAULT_THEME;
}
