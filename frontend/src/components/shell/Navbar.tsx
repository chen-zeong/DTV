import { Github, MonitorSmartphone, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { PLATFORM_TAB_ORDER, type LivePlatform } from "@/api";
import { PlatformTabs } from "@/components/shell/PlatformTabs";
import { SearchBox } from "@/components/shell/SearchBox";
import { WindowControls } from "@/components/shell/WindowControls";
import { LanSyncModal } from "@/features/sync/LanSyncModal";
import { cn } from "@/lib/cn";
import { isMacOS, openExternalURL, useDesktopOS } from "@/lib/window";
import { useTheme } from "@/state/ThemeProvider";
import styles from "./Navbar.module.css";

type ModalKind = "sync" | null;

/** 当前路由对应的平台；订阅页没有平台上下文（返回 null）。 */
function platformFromPath(pathname: string, search: string): LivePlatform | null {
  if (pathname.startsWith("/subscribe") || pathname.startsWith("/custom")) return null;
  // 播放页跟着房间的平台走（搜索框也按该平台工作）
  if (pathname.startsWith("/player")) {
    const platform = new URLSearchParams(search).get("platform");
    if (platform && (PLATFORM_TAB_ORDER as readonly string[]).includes(platform)) {
      return platform as LivePlatform;
    }
    return "douyu";
  }
  if (pathname.startsWith("/huya")) return "huya";
  if (pathname.startsWith("/douyin")) return "douyin";
  if (pathname.startsWith("/bilibili")) return "bilibili";
  return "douyu";
}

const THEME_TITLE = {
  dark: "切换到浅色",
  light: "切换到深色",
} as const;

/**
 * 顶栏（自绘标题栏）。
 *
 * 结构：左侧平台分段控件 / 右侧搜索 + 工具组 + 窗口按钮。
 * 播放页的主播信息只显示在播放器自己的顶栏，不再占用应用导航栏。
 */
export function Navbar() {
  const { pathname, search } = useLocation();
  const { theme, toggleTheme } = useTheme();
  const desktopOS = useDesktopOS();
  const isMac = desktopOS === "darwin" || isMacOS();
  const [modal, setModal] = useState<ModalKind>(null);

  const platform = platformFromPath(pathname, search);
  const ThemeIcon = theme === "dark" ? Sun : Moon;

  return (
    <>
      <nav className={cn(styles.navbar, styles.drag)}>
        <div className={styles.leading}>
          <PlatformTabs />
        </div>

        <div className={styles.actions}>
          {platform && <SearchBox platform={platform} />}

          <div className={styles.toolGroup}>
            <button
              type="button"
              className={cn(styles.iconBtn, styles.noDrag)}
              onClick={() => openExternalURL("https://github.com/chen-zeong/DTV")}
              aria-label="打开 GitHub 项目"
              title="GitHub 项目"
            >
              <Github size={18} strokeWidth={2} />
            </button>

            <button
              type="button"
              className={cn(styles.iconBtn, styles.noDrag)}
              onClick={() => setModal("sync")}
              aria-label="数据同步"
              title="数据同步"
            >
              <MonitorSmartphone size={18} strokeWidth={2} />
            </button>

            <button
              type="button"
              className={cn(styles.iconBtn, styles.noDrag)}
              onClick={toggleTheme}
              aria-label="切换主题"
              title={THEME_TITLE[theme]}
            >
              <ThemeIcon size={18} strokeWidth={2} />
            </button>
          </div>

          {!isMac && (
            <>
              <span className={styles.divider} aria-hidden="true" />
              <WindowControls />
            </>
          )}
        </div>
      </nav>

      {/* 弹窗放在 nav 之外：nav 自身有 z-index，作为子节点会被侧栏盖住。 */}
      {modal === "sync" && <LanSyncModal onClose={() => setModal(null)} />}
    </>
  );
}
