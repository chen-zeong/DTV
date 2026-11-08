import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { loadRaw, saveRaw, STORAGE_KEYS } from "@/lib/storage";
import {
  getTheme,
  normalizeThemeId,
  type ThemeId,
  type ThemeMode,
} from "@/lib/themes";

export type Theme = ThemeId;

interface ThemeContextValue {
  /** 当前配色 id（见 lib/themes.ts） */
  theme: Theme;
  /** 当前配色是深色还是浅色（用于 color-scheme 与少量按明暗分支的样式） */
  mode: ThemeMode;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemIsDark(): boolean {
  if (typeof window === "undefined") return true;
  return Boolean(window.matchMedia?.("(prefers-color-scheme: dark)")?.matches);
}

function readTheme(): Theme {
  const stored = loadRaw(STORAGE_KEYS.theme, "");
  return normalizeThemeId(stored, systemIsDark());
}

/**
 * 把配色写到根节点：
 *   - `data-theme` 只表示明暗（dark / light），沿用旧样式里
 *     `[data-theme="light"]` 这类选择器，避免六套主题下全部失效；
 *   - `data-palette` 才是具体配色 id，theme.css 按它覆盖颜色变量。
 */
function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const option = getTheme(theme);
  const root = document.documentElement;
  root.dataset.theme = option.mode;
  root.dataset.palette = theme;
  root.style.colorScheme = option.mode;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  // 用 layout effect：换配色发生在浏览器绘制之前，不会先闪一帧旧颜色。
  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // 首帧兜底：React 挂载前 :root 就是 signal；这里再写一次，
  // 保证刷新后即使存储里是浅色主题，也不会一直停在深色。
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    saveRaw(STORAGE_KEYS.theme, next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, mode: getTheme(theme).mode, setTheme }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme 必须在 ThemeProvider 内使用");
  return ctx;
}
