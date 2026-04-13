"use client";

import React, { useEffect } from "react";

import { ThemeProvider } from "@/state/theme/ThemeProvider";
import { FollowProvider } from "@/state/follow/FollowProvider";
import { CustomCategoriesProvider } from "@/state/customCategories/CustomCategoriesProvider";
import { PlayerUiProvider } from "@/state/playerUi/PlayerUiProvider";

async function maybeCheckForUpdates() {
  if (process.env.NODE_ENV === "development") return;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update?.available) return;
    const notes = update.body ? `\n\n${update.body}` : "";
    const shouldUpdate = window.confirm(`发现新版本 ${update.version}，是否立即更新？${notes}`);
    if (!shouldUpdate) return;
    await update.downloadAndInstall();
  } catch {
    // 非 Tauri 环境或更新失败：忽略
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void maybeCheckForUpdates();
  }, []);

  return (
    <ThemeProvider>
      <FollowProvider>
        <PlayerUiProvider>
          <CustomCategoriesProvider>{children}</CustomCategoriesProvider>
        </PlayerUiProvider>
      </FollowProvider>
    </ThemeProvider>
  );
}
