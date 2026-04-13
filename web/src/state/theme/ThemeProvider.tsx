"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type ThemePreference = "light" | "dark" | "system";
type EffectiveTheme = "light" | "dark";

type ThemeContextValue = {
  userPreference: ThemePreference;
  effectiveTheme: EffectiveTheme;
  setUserPreference: (pref: ThemePreference) => void;
  toggleLightDark: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORE_KEY = "theme_preference";

async function setTauriWindowTheme(theme: EffectiveTheme) {
  try {
    const mod = await import("@tauri-apps/api/webviewWindow");
    const win = mod.WebviewWindow.getCurrent();
    await win.setTheme(theme);
  } catch {
    // 非 Tauri 环境无需处理
  }
}

function getSystemTheme(): EffectiveTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [userPreference, setUserPreferenceState] = useState<ThemePreference>("system");
  const [systemTheme, setSystemTheme] = useState<EffectiveTheme>("light");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      setUserPreferenceState(stored);
    }
    setSystemTheme(getSystemTheme());

    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;

    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? "dark" : "light");
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  const effectiveTheme: EffectiveTheme = userPreference === "system" ? systemTheme : userPreference;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", effectiveTheme);
    void setTauriWindowTheme(effectiveTheme);
  }, [effectiveTheme]);

  const value = useMemo<ThemeContextValue>(() => {
    return {
      userPreference,
      effectiveTheme,
      setUserPreference: (pref) => {
        setUserPreferenceState(pref);
        try {
          window.localStorage.setItem(STORE_KEY, pref);
        } catch {
          // ignore
        }
      },
      toggleLightDark: () => {
        const next = effectiveTheme === "light" ? "dark" : "light";
        setUserPreferenceState(next);
        try {
          window.localStorage.setItem(STORE_KEY, next);
        } catch {
          // ignore
        }
      }
    };
  }, [effectiveTheme, userPreference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

