"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ThemePreference = "light" | "dark" | "system";
export type ThemeResolved = "light" | "dark";

type ThemeState = {
  userPreference: ThemePreference;
  currentSystemTheme: ThemeResolved;
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
      _initialized: false,

      initTheme() {
        if (get()._initialized || typeof window === "undefined") return;
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const systemTheme: ThemeResolved = mediaQuery.matches ? "dark" : "light";
        set({ currentSystemTheme: systemTheme, _initialized: true });
        applyTheme(get().getEffectiveTheme());

        const listener = (e: MediaQueryListEvent) => {
          set({ currentSystemTheme: e.matches ? "dark" : "light" });
          applyTheme(get().getEffectiveTheme());
        };
        mediaQuery.addEventListener("change", listener);
      },

      setUserPreference(preference) {
        set({ userPreference: preference });
        applyTheme(get().getEffectiveTheme());
      },

      toggleTheme() {
        const next = get().getEffectiveTheme() === "dark" ? "light" : "dark";
        set({ userPreference: next });
        applyTheme(next);
      },

      getEffectiveTheme() {
        const { userPreference, currentSystemTheme } = get();
        return userPreference === "system" ? currentSystemTheme : userPreference;
      },
    }),
    {
      name: "theme-store",
      storage,
      partialize: (state) => ({
        userPreference: state.userPreference,
        currentSystemTheme: state.currentSystemTheme,
      }),
    }
  )
);
