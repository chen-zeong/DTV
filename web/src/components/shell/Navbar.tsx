"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { m } from "framer-motion";
import { ChevronDown, Copy, LayoutGrid, Maximize2, Minus, Moon, Search, Sun, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import styles from "./Navbar.module.css";
import { searchAnchors, type SearchAnchorResult, type SearchPlatform } from "@/services/search";
import { usePlayerUi } from "@/state/playerUi/PlayerUiProvider";
import { useFollow, type Platform as FollowPlatform } from "@/state/follow/FollowProvider";
import { Platform } from "@/platforms/common/types";
import { useImageProxy } from "@/hooks/useImageProxy";
import { useCustomCategories } from "@/state/customCategories/CustomCategoriesProvider";

type UiPlatform = "douyu" | "douyin" | "huya" | "bilibili" | "custom";

const basePlatforms: Array<{ id: Exclude<UiPlatform, "custom">; name: string }> = [
  { id: "douyu", name: "斗鱼" },
  { id: "douyin", name: "抖音" },
  { id: "huya", name: "虎牙" },
  { id: "bilibili", name: "B站" }
];

const customPlatform = { id: "custom" as const, name: "自定义" };

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
  const router = useRouter();
  const pathname = usePathname();
  const [isWindows, setIsWindows] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const playerUi = usePlayerUi();
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

  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchAnchorResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isLoadingSearch, setIsLoadingSearch] = useState(false);

  const searchPlatform: SearchPlatform | null = useMemo(() => {
    if (activePlatform === "bilibili") return "bilibili";
    if (activePlatform === "huya") return "huya";
    if (activePlatform === "douyu") return "douyu";
    return null; // custom / douyin：暂不支持统一搜索
  }, [activePlatform]);

  const placeholderText = useMemo(() => {
    if (activePlatform === "huya") return "搜索虎牙主播/房间...";
    if (activePlatform === "bilibili") return "搜索B站直播间...";
    if (activePlatform === "douyin") return "抖音暂不支持搜索（可直接输入房间号进入）";
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

      {isPlayerRoute && island.visible && island.roomId ? (
        <div className={styles.playerIsland} data-tauri-drag-region="false">
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
          <button
            type="button"
            className={`${styles.playerIslandFollow} ${islandIsFollowed ? styles.playerIslandFollowed : ""}`}
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
          </button>
          <button
            type="button"
            className={styles.playerIslandExpand}
            title="展开弹幕"
            onClick={() => playerUi.requestShowDanmuPanel()}
          >
            <ChevronDown size={14} />
          </button>
        </div>
      ) : null}

      <div className={styles.actions} data-tauri-drag-region>
        <div className={styles.searchContainer} data-tauri-drag-region="false">
          <div className={`${styles.searchShell} ${isSearchFocused ? styles.searchShellFocused : ""}`}>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={placeholderText}
              className={styles.searchInput}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const trimmed = searchQuery.trim();
                if (!trimmed) return;
                if (/^\d+$/.test(trimmed)) {
                  router.push(`/player?platform=${encodeURIComponent(activePlatform)}&roomId=${encodeURIComponent(trimmed)}`);
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
                  router.push(`/player?platform=${encodeURIComponent(activePlatform)}&roomId=${encodeURIComponent(trimmed)}`);
                }
              }}
            >
              <Search size={15} />
            </button>
          </div>

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
                        router.push(`/player?platform=${encodeURIComponent(anchor.platform)}&roomId=${encodeURIComponent(anchor.roomId)}`);
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
                        router.push(`/player?platform=${encodeURIComponent(activePlatform)}&roomId=${encodeURIComponent(rid)}`);
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
              <Minus size={14} />
            </button>
            <button type="button" className={styles.winBtn} title={isMaximized ? "还原" : "最大化"} onClick={() => void toggleMaximizeWindow()}>
              {isMaximized ? <Copy size={14} /> : <Maximize2 size={14} />}
            </button>
            <button type="button" className={`${styles.winBtn} ${styles.winBtnClose}`} title="关闭" onClick={() => void closeWindow()}>
              <X size={14} />
            </button>
          </div>
        ) : null}
      </div>
    </nav>
  );
}
