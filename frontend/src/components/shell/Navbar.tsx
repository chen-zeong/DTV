import { Check, Github, MonitorSmartphone, Palette } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { PLATFORM_TAB_ORDER, type LivePlatform } from "@/api";
import { PlatformTabs } from "@/components/shell/PlatformTabs";
import { SearchBox } from "@/components/shell/SearchBox";
import { WindowControls } from "@/components/shell/WindowControls";
import { LanSyncModal } from "@/features/sync/LanSyncModal";
import { cn } from "@/lib/cn";
import { getTheme, THEMES, type ThemeId } from "@/lib/themes";
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

/**
 * 顶栏（自绘标题栏）。
 *
 * 结构：左侧平台分段控件 / 右侧搜索 + 工具组 + 窗口按钮。
 * 播放页的主播信息只显示在播放器自己的顶栏，不再占用应用导航栏。
 *
 * 4.1 起工具组里的主题按钮从「深/浅切换」换成「配色面板」：
 * 六套完整配色，按同色系日夜成对（青柠、黑白灰、琥珀/书页），
 * 每行两个，当前默认是「青柠·夜」。
 */
export function Navbar() {
  const { pathname, search } = useLocation();
  const { theme, setTheme } = useTheme();
  const desktopOS = useDesktopOS();
  const isMac = desktopOS === "darwin" || isMacOS();
  const [modal, setModal] = useState<ModalKind>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteWrapRef = useRef<HTMLDivElement>(null);

  const platform = platformFromPath(pathname, search);
  const currentTheme = getTheme(theme);

  /* 配色面板：点击外部 / Esc 关闭 */
  useEffect(() => {
    if (!paletteOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!paletteWrapRef.current?.contains(event.target as Node)) setPaletteOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPaletteOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    // 捕获阶段先拿 Esc：顶栏不能等到播放器/弹层处理完才响应
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [paletteOpen]);

  const chooseTheme = (next: ThemeId) => {
    setTheme(next);
    setPaletteOpen(false);
  };

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

            <div className={styles.paletteWrap} ref={paletteWrapRef}>
              <button
                type="button"
                className={cn(
                  styles.iconBtn,
                  styles.paletteBtn,
                  paletteOpen && styles.iconBtnActive,
                  styles.noDrag,
                )}
                onClick={() => setPaletteOpen((open) => !open)}
                aria-label="主题配色"
                aria-expanded={paletteOpen}
                aria-haspopup="dialog"
                title={`主题配色：${currentTheme.name}`}
              >
                <Palette size={18} strokeWidth={2} />
                <span
                  className={styles.paletteDot}
                  style={{ background: currentTheme.swatch[2] }}
                  aria-hidden="true"
                />
              </button>

              {paletteOpen && (
                <div
                  className={cn(styles.palettePanel, styles.noDrag)}
                  role="dialog"
                  aria-label="选择主题配色"
                >
                  <div className={styles.paletteHeader}>
                    <span className={styles.paletteTitle}>主题配色</span>
                    <span className={styles.paletteCount}>
                      {THEMES.length} 套 · 当前 {currentTheme.name}
                    </span>
                  </div>
                  <div className={styles.paletteGrid}>
                    {THEMES.map((option) => {
                      const active = option.id === theme;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={cn(styles.paletteItem, active && styles.paletteItemActive)}
                          onClick={() => chooseTheme(option.id)}
                          aria-pressed={active}
                          aria-label={`${option.name}：${option.description}`}
                          title={option.description}
                        >
                          <span className={styles.paletteSwatch} aria-hidden="true">
                            <span style={{ background: option.swatch[0] }} />
                            <span style={{ background: option.swatch[1] }} />
                            <span style={{ background: option.swatch[2] }} />
                          </span>
                          <span className={styles.paletteMeta}>
                            <span className={styles.paletteName}>{option.name}</span>
                            <span className={styles.paletteMode}>
                              {option.mode === "dark" ? "深色" : "浅色"}
                            </span>
                          </span>
                          {active && (
                            <Check
                              size={13}
                              strokeWidth={2.8}
                              className={styles.paletteCheck}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
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
