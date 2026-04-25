"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { ChevronDown, ExternalLink, FolderSync, LayoutGrid, Moon, Search, Sun, ThumbsUp, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { invoke } from "@tauri-apps/api/core";

import styles from "./Navbar.module.css";
import { LanSyncModal } from "./LanSyncModal";
import { searchAnchors, type SearchAnchorResult, type SearchPlatform } from "@/services/search";
import { usePlayerUi } from "@/state/playerUi/PlayerUiProvider";
import { useFollow, type Platform as FollowPlatform } from "@/state/follow/FollowProvider";
import { Platform } from "@/platforms/common/types";
import { useImageProxy } from "@/hooks/useImageProxy";
import { useCustomCategories } from "@/state/customCategories/CustomCategoriesProvider";
import { usePlayerOverlay } from "@/state/playerOverlay/PlayerOverlayProvider";

type UiPlatform = "douyu" | "douyin" | "huya" | "bilibili" | "custom";

type VersionInfo = {
  version: string;
  title?: string;
  notes?: string[];
  url?: string;
  published_at?: string;
};

const basePlatforms: Array<{ id: Exclude<UiPlatform, "custom">; name: string }> = [
  { id: "douyu", name: "斗鱼" },
  { id: "huya", name: "虎牙" },
  { id: "douyin", name: "抖音" },
  { id: "bilibili", name: "B站" }
];

const customPlatform = { id: "custom" as const, name: "自定义" };

function WinCaptionMinimizeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 12h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function WinCaptionMaximizeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function WinCaptionRestoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 7.5h8a2 2 0 0 1 2 2v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="5.5" y="9.5" width="11" height="11" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function WinCaptionCloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 7l10 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17 7L7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function Navbar({
  theme,
  activePlatform,
  onThemeToggle,
  onPlatformChange
}: {
  theme: "light" | "dark";
  activePlatform: UiPlatform;
  onThemeToggle: () => void;
  onPlatformChange: (p: UiPlatform) => void;
}) {
  const pathname = usePathname();
  const [isWindows, setIsWindows] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  const [donateOpen, setDonateOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [lanSyncOpen, setLanSyncOpen] = useState(false);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [localVersion, setLocalVersion] = useState<string>("");

  const playerUi = usePlayerUi();
  const playerOverlay = usePlayerOverlay();
  const follow = useFollow();
  const { ensureProxyStarted, proxify } = useImageProxy();
  const custom = useCustomCategories();

  const showCustomTab = custom.hydrated && custom.entries.length > 0;
  const visiblePlatforms = useMemo(() => {
    // 对齐老项目：有自定义分区时，自定义入口放在最前面
    if (showCustomTab) return [customPlatform, ...basePlatforms];
    return basePlatforms;
  }, [showCustomTab]);

  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [highlight, setHighlight] = useState<{ width: number; x: number; opacity: number }>({ width: 0, x: 0, opacity: 0 });

  const highlightMotionWithOpacity = useMemo(
    () => ({
      width: highlight.width,
      x: highlight.x,
      opacity: highlight.opacity,
      scale: highlight.opacity ? 1 : 0.96
    }),
    [highlight]
  );

  const isPlayerRoute = (pathname ?? "").startsWith("/player");
  const isPlayerOpen = isPlayerRoute || playerOverlay.isOpen;

  const navigateToPlayer = useCallback(
    (platform: string, roomId: string) => {
      playerOverlay.openPlayer({ platform, roomId });
    },
    [playerOverlay]
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchAnchorResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isLoadingSearch, setIsLoadingSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [playerSearchOpen, setPlayerSearchOpen] = useState(true);

  useEffect(() => {
    if (isPlayerOpen) {
      setPlayerSearchOpen(false);
      setSearchQuery("");
      setSearchResults([]);
      setSearchError(null);
      setIsSearchFocused(false);
    } else {
      setPlayerSearchOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlayerOpen]);

  const openPlayerSearch = useCallback(() => {
    setPlayerSearchOpen(true);
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 版本检查不是关键功能：失败不重试、不报错、不提示
      try {
        const res = await invoke<any>("check_version_cmd");
        if (cancelled) return;
        const local = typeof res?.local_version === "string" ? res.local_version : "";
        setLocalVersion(local);
        const remote = res?.remote;
        if (remote && typeof remote.version === "string" && remote.version.trim()) {
          const info: VersionInfo = {
            version: remote.version,
            title: typeof remote.title === "string" ? remote.title : undefined,
            notes: Array.isArray(remote.notes) ? remote.notes.filter((x: any) => typeof x === "string") : undefined,
            url: typeof remote.url === "string" ? remote.url : undefined,
            published_at: typeof remote.published_at === "string" ? remote.published_at : undefined
          };
          setVersionInfo(info);
        }
        setHasUpdate(!!res?.has_update);
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const searchPlatform: SearchPlatform | null = useMemo(() => {
    if (activePlatform === "bilibili") return "bilibili";
    if (activePlatform === "huya") return "huya";
    if (activePlatform === "douyu") return "douyu";
    return null; // custom / douyin：暂不支持统一搜索
  }, [activePlatform]);

  const placeholderText = useMemo(() => {
    if (activePlatform === "huya") return "搜索虎牙主播/房间...";
    if (activePlatform === "bilibili") return "搜索B站直播间...";
    if (activePlatform === "douyin") return "搜索直播间号";
    if (activePlatform === "custom") return "搜索：切到具体平台后可用";
    return "搜索斗鱼主播/房间...";
  }, [activePlatform]);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    setSearchError(null);
    if (!trimmed || !searchPlatform) {
      setSearchResults([]);
      setIsLoadingSearch(false);
      return;
    }

    setIsLoadingSearch(true);
    const id = window.setTimeout(() => {
      searchAnchors(searchPlatform, trimmed)
        .then((res) => setSearchResults(res ?? []))
        .catch((e: any) => {
          setSearchResults([]);
          setSearchError(typeof e === "string" ? e : e?.message || "搜索失败");
        })
        .finally(() => setIsLoadingSearch(false));
    }, 220);

    return () => window.clearTimeout(id);
  }, [searchPlatform, searchQuery]);

  useEffect(() => {
    if (searchPlatform === "bilibili" || searchPlatform === "huya") {
      void ensureProxyStarted();
    }
  }, [ensureProxyStarted, searchPlatform]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const osMod: any = await import("@tauri-apps/plugin-os");
        const p = typeof osMod?.platform === "function" ? await osMod.platform() : "";
        if (cancelled) return;
        setIsWindows(String(p).toLowerCase() === "windows");
      } catch {
        // non-tauri env: ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isWindows) return;
    let cancelled = false;
    let unlisten: null | (() => void) = null;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        try {
          const max = await win.isMaximized();
          if (!cancelled) setIsMaximized(!!max);
        } catch {
          // ignore
        }
        try {
          unlisten = await win.onResized(async () => {
            try {
              const max = await win.isMaximized();
              setIsMaximized(!!max);
            } catch {
              // ignore
            }
          });
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
      try {
        unlisten?.();
      } catch {
        // ignore
      }
    };
  }, [isWindows]);

  const minimizeWindow = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch {
      // ignore
    }
  }, []);

  const toggleMaximizeWindow = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const max = await win.isMaximized();
      if (max) await win.unmaximize();
      else await win.maximize();
      setIsMaximized(!max);
    } catch {
      // ignore
    }
  }, []);

  const closeWindow = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {
      // ignore
    }
  }, []);

  const updateHighlight = useCallback(() => {
    const el = tabRefs.current[activePlatform];
    const container = containerRef.current;
    if (!el || !container) {
      setHighlight((prev) => ({ ...prev, opacity: 0 }));
      return;
    }
    const c = container.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setHighlight({ width: r.width, x: r.left - c.left, opacity: 1 });
  }, [activePlatform]);

  const openExternal = useCallback(async (url: string) => {
    if (!url) return;
    try {
      const opener: any = await import("@tauri-apps/plugin-opener");
      if (typeof opener?.open === "function") {
        await opener.open(url);
        return;
      }
    } catch {
      // ignore
    }
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // ignore
    }
  }, []);

  useLayoutEffect(() => {
    updateHighlight();
  }, [updateHighlight, visiblePlatforms.length]);

  useEffect(() => {
    const onResize = () => updateHighlight();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updateHighlight]);

  const island = playerUi.island;
  const islandDisplayName = island.anchorName || island.roomId || "";
  const islandDisplayTitle = island.title || "";

  const islandIsFollowed = useMemo(() => {
    if (!island.visible || !island.platform || !island.roomId) return false;
    const fp: FollowPlatform =
      island.platform === Platform.DOUYU
        ? "DOUYU"
        : island.platform === Platform.DOUYIN
          ? "DOUYIN"
          : island.platform === Platform.HUYA
            ? "HUYA"
            : "BILIBILI";
    return follow.isFollowed(fp, island.roomId);
  }, [follow, island.platform, island.roomId, island.visible]);

  const showResults = isSearchFocused && !!searchQuery.trim();

  return (
    <nav className={`${styles.navbar} ${theme === "dark" ? styles.navbarDark : ""}`} data-tauri-drag-region>
      <div className={styles.platformTabsWrap} data-tauri-drag-region>
        <div className={styles.platformTabs} ref={containerRef} data-tauri-drag-region>
          <m.div
            className={styles.platformHighlight}
            initial={false}
            animate={highlightMotionWithOpacity}
            transition={{ type: "spring", stiffness: 420, damping: 36, mass: 0.85 }}
          />
          {visiblePlatforms.map((p) => (
            <button
              // eslint-disable-next-line react/no-unknown-property
              data-tauri-drag-region="false"
              key={p.id}
              type="button"
              className={`${styles.platformTab} ${activePlatform === p.id ? styles.platformTabActive : ""}`}
              ref={(node) => {
                tabRefs.current[p.id] = node;
              }}
              onClick={() => onPlatformChange(p.id)}
            >
              {p.id === "custom" ? <LayoutGrid size={16} /> : p.name}
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {isPlayerRoute && island.visible && island.roomId && (playerUi.danmuPanel.collapsed || !playerUi.danmuPanel.available) ? (
          <m.div
            className={styles.playerIsland}
            data-tauri-drag-region="false"
            initial={{ opacity: 0, y: -10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 520, damping: 40, mass: 0.7 } }}
            exit={{ opacity: 0, y: -8, scale: 0.99, transition: { duration: 0.12 } }}
          >
            <div className={styles.playerIslandLeft}>
              {island.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.playerIslandAvatar} src={island.avatarUrl} alt={islandDisplayName} />
              ) : (
                <div className={`${styles.playerIslandAvatar} ${styles.playerIslandAvatarFallback}`}>
                  {(islandDisplayName || "?").slice(0, 1)}
                </div>
              )}
              <div className={styles.playerIslandMeta}>
                <div className={styles.playerIslandName} title={islandDisplayName}>
                  {islandDisplayName}
                </div>
                <div className={styles.playerIslandTitle} title={islandDisplayTitle}>
                  {islandDisplayTitle}
                </div>
              </div>
            </div>
            <m.button
              type="button"
              className={`${styles.playerIslandFollow} ${islandIsFollowed ? styles.playerIslandFollowed : ""}`}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 520, damping: 38, mass: 0.7 }}
              onClick={() => {
                if (!island.platform || !island.roomId) return;
                const fp: FollowPlatform =
                  island.platform === Platform.DOUYU
                    ? "DOUYU"
                    : island.platform === Platform.DOUYIN
                      ? "DOUYIN"
                      : island.platform === Platform.HUYA
                        ? "HUYA"
                        : "BILIBILI";
                if (follow.isFollowed(fp, island.roomId)) follow.unfollowStreamer(fp, island.roomId);
                else {
                  follow.followStreamer({
                    id: island.roomId,
                    platform: fp,
                    nickname: islandDisplayName || island.roomId,
                    avatarUrl: island.avatarUrl || "",
                    roomTitle: island.title || "",
                    currentRoomId: island.roomId,
                    liveStatus: "UNKNOWN"
                  });
                }
              }}
            >
              {islandIsFollowed ? "取关" : "关注"}
            </m.button>
            <button
              type="button"
              className={styles.playerIslandExpand}
              title={playerUi.danmuPanel.available ? "展开弹幕" : "当前窗口过窄，无法展开弹幕列表"}
              disabled={!playerUi.danmuPanel.available}
              onClick={() => playerUi.requestShowDanmuPanel()}
            >
              <ChevronDown size={14} />
            </button>
          </m.div>
        ) : null}
      </AnimatePresence>

      <div className={styles.actions} data-tauri-drag-region>
        {activePlatform !== "custom" ? (
          <div className={styles.searchContainer} data-tauri-drag-region="false">
          {isPlayerRoute && !playerSearchOpen ? (
            <m.button
              type="button"
              className={styles.searchIconBtn}
              aria-label="打开搜索"
              title="搜索"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: "spring", stiffness: 520, damping: 40, mass: 0.7 }}
              onClick={openPlayerSearch}
            >
              <Search size={16} />
            </m.button>
          ) : null}

          <m.div
            className={`${styles.searchShell} ${isSearchFocused ? styles.searchShellFocused : ""}`}
            initial={false}
            animate={isPlayerRoute ? { width: playerSearchOpen ? 320 : 36, opacity: playerSearchOpen ? 1 : 0 } : undefined}
            transition={isPlayerRoute ? { type: "spring", stiffness: 520, damping: 44, mass: 0.7 } : undefined}
            style={isPlayerRoute ? { maxWidth: "36vw", overflow: "hidden", display: playerSearchOpen ? "inline-flex" : "none" } : undefined}
          >
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={placeholderText}
              className={styles.searchInput}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => {
                setIsSearchFocused(false);
                if (!isPlayerRoute) return;
                if (searchQuery.trim()) return;
                window.setTimeout(() => setPlayerSearchOpen(false), 80);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (!isPlayerRoute) return;
                  setSearchQuery("");
                  setSearchResults([]);
                  setSearchError(null);
                  setIsSearchFocused(false);
                  setPlayerSearchOpen(false);
                  return;
                }
                if (e.key !== "Enter") return;
                const trimmed = searchQuery.trim();
                if (!trimmed) return;
                if (/^\d+$/.test(trimmed)) {
                  navigateToPlayer(activePlatform, trimmed);
                }
              }}
            />
            {searchQuery ? (
              <button
                type="button"
                className={styles.searchIconBtn}
                aria-label="清除搜索"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSearchQuery("");
                  setSearchResults([]);
                  setSearchError(null);
                }}
              >
                <X size={14} />
              </button>
            ) : null}
            <button
              type="button"
              className={styles.searchIconBtn}
              aria-label="搜索"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const trimmed = searchQuery.trim();
                if (!trimmed) return;
                if (/^\d+$/.test(trimmed)) {
                  navigateToPlayer(activePlatform, trimmed);
                }
              }}
            >
              <Search size={15} />
            </button>
          </m.div>

          {showResults ? (
            <div className={styles.searchResultsWrapper}>
              {isLoadingSearch ? <div className={styles.searchMeta}>搜索中...</div> : null}
              {!isLoadingSearch && searchError ? <div className={styles.searchMeta}>{searchError}</div> : null}
              {!isLoadingSearch && !searchError && searchResults.length ? (
                <div className={styles.searchResultsList}>
                  {searchResults.map((anchor) => (
                    <div
                      key={`${anchor.platform}-${anchor.roomId}`}
                      className={styles.searchResultItem}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        navigateToPlayer(anchor.platform, anchor.roomId);
                      }}
                    >
                      <div className={styles.resultAvatar}>
                        {anchor.avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className={styles.resultAvatarImg}
                            src={anchor.platform === "bilibili" || anchor.platform === "huya" ? proxify(anchor.avatar) : anchor.avatar}
                            alt={anchor.userName}
                          />
                        ) : (
                          <div className={styles.resultAvatarFallback}>{(anchor.userName || "?").slice(0, 1)}</div>
                        )}
                      </div>
                      <div className={styles.resultMain}>
                        <div className={styles.resultName} title={anchor.userName}>
                          {anchor.userName}
                        </div>
                        <div className={styles.resultTitle} title={anchor.roomTitle}>
                          {anchor.roomTitle}
                        </div>
                      </div>
                      <span className={`${styles.liveDot} ${anchor.liveStatus ? styles.liveDotOn : ""}`} aria-hidden="true" />
                    </div>
                  ))}
                </div>
              ) : null}

              {!isLoadingSearch && !searchError && !searchResults.length ? (
                <div className={styles.searchMeta}>
                  未找到结果
                  {searchQuery.trim() && /^\d+$/.test(searchQuery.trim()) ? (
                    <button
                      type="button"
                      className={styles.searchFallbackBtn}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const rid = searchQuery.trim();
                        navigateToPlayer(activePlatform, rid);
                      }}
                    >
                      进入房间 {searchQuery.trim()}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          </div>
        ) : null}

        <button
          type="button"
          // eslint-disable-next-line react/no-unknown-property
          data-tauri-drag-region="false"
          className={styles.versionBtn}
          title="版本信息"
          aria-label="版本信息"
          onClick={() => setUpdateOpen(true)}
        >
          <span className={styles.versionText}>v{localVersion || "?"}</span>
          {hasUpdate ? <span className={styles.badgeNew}>NEW</span> : null}
        </button>

        <button
          type="button"
          // eslint-disable-next-line react/no-unknown-property
          data-tauri-drag-region="false"
          className={styles.navIconBtn}
          title="打赏支持"
          aria-label="打赏"
          onClick={() => setDonateOpen(true)}
        >
          <ThumbsUp size={18} />
        </button>

        <button
          type="button"
          // eslint-disable-next-line react/no-unknown-property
          data-tauri-drag-region="false"
          className={styles.navIconBtn}
          title="Data Sync"
          aria-label="Data Sync"
          onClick={() => setLanSyncOpen(true)}
        >
          <FolderSync size={18} />
        </button>

        <button
          type="button"
          // eslint-disable-next-line react/no-unknown-property
          data-tauri-drag-region="false"
          className={`${styles.themeToggle} ${theme === "dark" ? styles.themeToggleDark : styles.themeToggleLight}`}
          onClick={onThemeToggle}
          aria-label={theme === "dark" ? "切换到浅色" : "切换到深色"}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {isWindows ? (
          <div className={styles.winControls} data-tauri-drag-region="false" aria-label="Window controls">
            <button type="button" className={styles.winBtn} title="最小化" onClick={() => void minimizeWindow()}>
              <WinCaptionMinimizeIcon />
            </button>
            <button type="button" className={styles.winBtn} title={isMaximized ? "还原" : "最大化"} onClick={() => void toggleMaximizeWindow()}>
              {isMaximized ? <WinCaptionRestoreIcon /> : <WinCaptionMaximizeIcon />}
            </button>
            <button type="button" className={`${styles.winBtn} ${styles.winBtnClose}`} title="关闭" onClick={() => void closeWindow()}>
              <WinCaptionCloseIcon />
            </button>
          </div>
        ) : null}
      </div>

      <AnimatePresence>
        {donateOpen ? (
          <m.div
            className={styles.overlayBackdrop}
            // eslint-disable-next-line react/no-unknown-property
            data-tauri-drag-region="false"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={() => setDonateOpen(false)}
          >
            <m.div
              className={styles.overlayCard}
              initial={{ opacity: 0, y: 10, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.99 }}
              transition={{ type: "spring", stiffness: 520, damping: 44, mass: 0.7 }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className={styles.overlayHeader}>
                <div className={styles.overlayTitle}>打赏支持</div>
                <button type="button" className={styles.overlayClose} onClick={() => setDonateOpen(false)} aria-label="关闭">
                  <X size={16} />
                </button>
              </div>
              <div className={styles.overlayBody}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={styles.qrImage} src="/donate-qr.png" alt="打赏二维码" />
                <div className={styles.overlayHint}>感谢支持，扫码即可。</div>
              </div>
            </m.div>
          </m.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {updateOpen ? (
          <m.div
            className={styles.overlayBackdrop}
            // eslint-disable-next-line react/no-unknown-property
            data-tauri-drag-region="false"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={() => setUpdateOpen(false)}
          >
            <m.div
              className={styles.overlayCard}
              initial={{ opacity: 0, y: 10, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.99 }}
              transition={{ type: "spring", stiffness: 520, damping: 44, mass: 0.7 }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className={styles.overlayHeader}>
                <div className={styles.overlayTitle}>
                  {hasUpdate && versionInfo ? versionInfo.title || `发现新版本 v${versionInfo.version}` : "版本信息"}
                </div>
                <button type="button" className={styles.overlayClose} onClick={() => setUpdateOpen(false)} aria-label="关闭">
                  <X size={16} />
                </button>
              </div>
              <div className={styles.overlayBody}>
                <div className={styles.updateMeta}>
                  <span>当前版本：v{localVersion || "?"}</span>
                  {hasUpdate && versionInfo ? <span>最新版本：v{versionInfo.version}</span> : <span>已是最新</span>}
                  {hasUpdate && versionInfo?.published_at ? <span>发布日期：{versionInfo.published_at}</span> : null}
                </div>
                {hasUpdate && versionInfo?.notes?.length ? (
                  <ul className={styles.updateNotes}>
                    {versionInfo.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                ) : null}

                {hasUpdate && versionInfo?.url ? (
                  <div className={styles.updateActions}>
                    <button type="button" className={styles.primaryBtn} onClick={() => void openExternal(versionInfo.url!)}>
                      <ExternalLink size={16} />
                      打开下载页
                    </button>
                  </div>
                ) : null}
              </div>
            </m.div>
          </m.div>
        ) : null}
      </AnimatePresence>

      <LanSyncModal open={lanSyncOpen} onClose={() => setLanSyncOpen(false)} appVersion={localVersion} />
    </nav>
  );
}
