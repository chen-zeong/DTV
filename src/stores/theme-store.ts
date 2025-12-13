"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ThemePreference = "light" | "dark" | "system";
export type ThemeResolved = "light" | "dark";

type ThemeState = {
  userPreference: ThemePreference;
  currentSystemTheme: ThemeResolved;
  resolvedTheme: ThemeResolved;
  _initialized: boolean;
};

type ThemeActions = {
  initTheme: () => void;
  setUserPreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
  getEffectiveTheme: () => ThemeResolved;
};

export type ThemeStore = ThemeState & ThemeActions;

const storage = createJSONStorage<ThemeState>(() => (typeof window !== "undefined" ? localStorage : undefined));
const resolveTheme = (preference: ThemePreference, system: ThemeResolved): ThemeResolved =>
  preference === "system" ? system : preference;

const applyTheme = async (theme: ThemeResolved) => {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
  }

  // Tauri 窗口主题同步（在浏览器环境忽略）
  if (typeof window !== "undefined" && (window as { __TAURI__?: unknown }).__TAURI__) {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const win = WebviewWindow.getCurrent();
      await win.setTheme(theme);
    } catch (error) {
      console.warn("[theme-store] setTheme failed", error);
    }
  }
};

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      userPreference: "system",
      currentSystemTheme: "light",
      resolvedTheme: "light",
      _initialized: false,

      initTheme() {
        if (get()._initialized || typeof window === "undefined") return;
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const systemTheme: ThemeResolved = mediaQuery.matches ? "dark" : "light";
        const resolved = resolveTheme(get().userPreference, systemTheme);
        set({ currentSystemTheme: systemTheme, resolvedTheme: resolved, _initialized: true });
        applyTheme(resolved);

        const listener = (e: MediaQueryListEvent) => {
          const nextSystemTheme = e.matches ? "dark" : "light";
          const resolvedNext = resolveTheme(get().userPreference, nextSystemTheme);
          set({ currentSystemTheme: nextSystemTheme, resolvedTheme: resolvedNext });
          applyTheme(resolvedNext);
        };
        mediaQuery.addEventListener("change", listener);
      },

      setUserPreference(preference) {
        const resolved = resolveTheme(preference, get().currentSystemTheme);
        set({ userPreference: preference, resolvedTheme: resolved });
        applyTheme(resolved);
      },

      toggleTheme() {
        const next = get().resolvedTheme === "dark" ? "light" : "dark";
        set({ userPreference: next, resolvedTheme: next });
        applyTheme(next);
      },

      getEffectiveTheme() {
        return get().resolvedTheme;
      },
    }),
    {
      name: "theme-store",
      storage,
      partialize: (state) => ({
        userPreference: state.userPreference,
        currentSystemTheme: state.currentSystemTheme,
        resolvedTheme: state.resolvedTheme,
      }),
      onRehydrateStorage: () => (state) => {
        const resolved = state?.resolvedTheme ?? resolveTheme(state?.userPreference ?? "system", state?.currentSystemTheme ?? "light");
        applyTheme(resolved);
      },
    }
  )
);
