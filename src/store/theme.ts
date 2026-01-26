import { defineStore } from "pinia";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"; // Changed import to WebviewWindow

interface ThemeState {
  userPreference: "dark";
  primaryColor: string;
}

const COLOR_KEY = "primary_color";

export const useThemeStore = defineStore("theme", {
  state: (): ThemeState => ({
    userPreference: "dark", 
    primaryColor: "#a855f7", // Default purple
  }),
  actions: {
    async initTheme() {
      const storedColor = localStorage.getItem(COLOR_KEY);
      if (storedColor) {
        this.primaryColor = storedColor;
      }

      this._applyTheme();
    },

    setPrimaryColor(color: string) {
      this.primaryColor = color;
      localStorage.setItem(COLOR_KEY, color);
      this._applyTheme();
    },

    // ... (rest of random color logic)

    async _applyTheme() {
      const themeToApply = "dark";
      document.documentElement.setAttribute("data-theme", themeToApply);
      document.documentElement.style.setProperty("--accent", this.primaryColor);

      try {
        const win = WebviewWindow.getCurrent(); 
        await win.setTheme(themeToApply);
      } catch (error) {
        console.error("[ThemeStore] Error setting Tauri window theme:", error);
      }
    },

    getEffectiveTheme(): "dark" {
      return "dark";
    },
  },
});
