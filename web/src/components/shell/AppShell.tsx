"use client";

import React, { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import styles from "./AppShell.module.css";
import { Sidebar } from "@/components/shell/Sidebar";
import { Navbar } from "@/components/shell/Navbar";
import { useTheme } from "@/state/theme/ThemeProvider";
import { usePlayerUi } from "@/state/playerUi/PlayerUiProvider";
import { useCustomCategories } from "@/state/customCategories/CustomCategoriesProvider";

type UiPlatform = "douyu" | "douyin" | "huya" | "bilibili" | "custom";

function getActivePlatform(pathname: string): UiPlatform {
  if (pathname.startsWith("/custom")) return "custom";
  if (pathname.startsWith("/douyin")) return "douyin";
  if (pathname.startsWith("/huya")) return "huya";
  if (pathname.startsWith("/bilibili")) return "bilibili";
  return "douyu";
}

function isPlayerPath(pathname: string) {
  return pathname.startsWith("/player");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { effectiveTheme, toggleLightDark } = useTheme();
  const { isFullscreen: isPlayerFullscreen } = usePlayerUi();
  const custom = useCustomCategories();

  const activePlatform = useMemo(() => getActivePlatform(pathname ?? "/"), [pathname]);
  const [isSidebarCollapsed] = useState(false);

  const shouldHidePlayerChrome = isPlayerPath(pathname ?? "/") && isPlayerFullscreen;
  const playerRoute = isPlayerPath(pathname ?? "/");

  useEffect(() => {
    if (!custom.hydrated) return;

    // 自定义分区：无数据则不显示（避免进入空白页）
    if ((pathname ?? "").startsWith("/custom") && custom.entries.length === 0) {
      router.replace("/");
      return;
    }

    // 仅在本次启动首次落到首页时：如果订阅了分区，默认进入自定义分区页
    if (custom.entries.length > 0 && (pathname ?? "/") === "/") {
      try {
        const key = "dtv_initial_route_custom_v1";
        if (window.sessionStorage.getItem(key) === "1") return;
        window.sessionStorage.setItem(key, "1");
      } catch {
        // ignore
      }
      router.replace("/custom/");
    }
  }, [custom.entries.length, custom.hydrated, pathname, router]);

  return (
    <div className={styles.appShell}>
      {!shouldHidePlayerChrome ? (
        <Sidebar isCollapsed={isSidebarCollapsed} />
      ) : null}
      <div className={styles.appMain}>
        {!shouldHidePlayerChrome ? (
          <Navbar
            theme={effectiveTheme}
            activePlatform={activePlatform}
            onThemeToggle={toggleLightDark}
            onPlatformChange={(p) => {
              const map: Record<UiPlatform, string> = {
                douyu: "/",
                douyin: "/douyin/",
                huya: "/huya/",
                bilibili: "/bilibili/",
                custom: "/custom/"
              };
              router.push(map[p]);
            }}
          />
        ) : null}

        <main className={`${styles.appBody} ${playerRoute ? styles.appBodyPlayer : ""}`}>{children}</main>
      </div>
    </div>
  );
}
