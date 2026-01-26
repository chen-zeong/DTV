import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import { useFollowStore } from "./store/followStore";
import { useThemeStore } from "./store/theme";
import { check } from "@tauri-apps/plugin-updater";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

const followStore = useFollowStore();
try {
  followStore.loadFollowedStreamers();
} catch (error) {
  console.error("[main.ts] Error initializing follow store:", error);
}

const themeStore = useThemeStore();
try {
  themeStore.initTheme();
} catch (error) {
  console.error("[main.ts] Error initializing theme store:", error);
}

const maybeCheckForUpdates = async () => {
  if (import.meta.env.DEV) return;
  try {
    const update = await check();
    if (update?.available) {
      const notes = update.body ? `\n\n${update.body}` : "";
      const shouldUpdate = window.confirm(
        `发现新版本 ${update.version}，是否立即更新？${notes}`,
      );
      if (!shouldUpdate) return;
      await update.downloadAndInstall();
    }
  } catch (error) {
    console.error("[main.ts] Auto update check failed:", error);
  }
};

void maybeCheckForUpdates();

app.mount("#app");
