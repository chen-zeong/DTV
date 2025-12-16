"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { RotateCw, PanelLeftClose, PanelLeftOpen, Plus, ChevronDown, FolderPlus } from "lucide-react";
import { ThemeMode } from "@/types/follow-list";
import type { FollowedStreamer, Platform } from "@/types/platform";
import { useFollowStore } from "@/stores/follow-store";
import { usePlayerOverlayStore } from "@/stores/player-overlay-store";
import { platformLabelMap } from "@/utils/platform";
import { useSidebarStore } from "@/stores/sidebar-store";
import { Reorder, motion, useDragControls, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { createPortal } from "react-dom";
import { tauriInvoke } from "@/lib/tauri";
import { normalizeAvatarUrl as normalizeAvatarGlobal } from "@/utils/image";
import { cn } from "@/utils/cn";

const toKey = (platform: string, id: string) => `${String(platform).toUpperCase()}:${id}`;

type SidebarProps = {
  className?: string;
  theme: ThemeMode;
  isLeaderboardOpen: boolean;
};

export function Sidebar({ className, theme, isLeaderboardOpen }: SidebarProps) {
  const isDark = theme === "dark";
  const followedStreamers = useFollowStore((s) => s.followedStreamers);
  const listOrder = useFollowStore((s) => s.listOrder);
  const folders = useFollowStore((s) => s.folders);
  const createFolder = useFollowStore((s) => s.createFolder);
  const moveToFolder = useFollowStore((s) => s.moveStreamerToFolder);
  const renameFolder = useFollowStore((s) => s.renameFolder);
  const deleteFolder = useFollowStore((s) => s.deleteFolder);
  const toggleFolderExpanded = useFollowStore((s) => s.toggleFolderExpanded);
  const hydrate = useFollowStore((s) => s.hydrateFromLegacy);
  const openPlayer = usePlayerOverlayStore((s) => s.open);
  const updateListOrder = useFollowStore((s) => s.updateListOrder);
  const updateStreamerDetails = useFollowStore((s) => s.updateStreamerDetails);
  const toggleSidebar = useSidebarStore((s) => s.toggle);
  const normalizeAvatar = (platform: string, url?: string | null) => normalizeAvatarGlobal(platform, url);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const hoverRefs = useRef<{ full: Array<HTMLElement | null>; icons: Array<HTMLElement | null> }>({
    full: [],
    icons: [],
  });
  const hoverMeasureRaf = useRef<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<{ layout: "full" | "icons"; index: number } | null>(null);
  const [hoverRect, setHoverRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [hoverFolderId, setHoverFolderId] = useState<string | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ id: string; x: number; y: number; renameDraft?: string } | null>(
    null
  );
  const [folderPreview, setFolderPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const [collapsedHover, setCollapsedHover] = useState<{
    key: string;
    x: number;
    y: number;
    name: string;
    title: string;
    avatar?: string;
  } | null>(null);
  const [mounted, setMounted] = useState(false);
  const folderPreviewTimer = useRef<number | null>(null);
  const collapsedPreviewTimer = useRef<number | null>(null);
  const refreshLock = useRef(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const orderedFollows = useMemo(() => {
    const map = new Map<string, (typeof followedStreamers)[number]>();
    followedStreamers.forEach((s) => map.set(`${s.platform}:${s.id}`, s));
    const ordered = listOrder
      .filter((item): item is Extract<typeof listOrder[number], { type: "streamer" }> => item.type === "streamer")
      .map((item) => map.get(`${item.data.platform}:${item.data.id}`))
      .filter((s): s is (typeof followedStreamers)[number] => Boolean(s));
    if (ordered.length) return ordered;
    return followedStreamers;
  }, [followedStreamers, listOrder]);

  const inFolderKeys = useMemo(() => {
    const set = new Set<string>();
    folders.forEach((folder) => {
      (folder.streamerIds || []).forEach((id) => {
        const [p, i] = (id || "").split(":");
        if (!p || !i) return;
        set.add(`${String(p).toUpperCase()}:${i}`);
      });
    });
    return set;
  }, [folders]);

  const availableStreamers = useMemo(
    () => followedStreamers.filter((f) => !inFolderKeys.has(toKey(f.platform, f.id))),
    [followedStreamers, inFolderKeys]
  );

  const orderedAvailable = useMemo(() => {
    // live 优先，再按用户自定义顺序
    const orderMap = new Map<string, number>();
    listOrder.forEach((item, idx) => {
      if (item.type === "streamer") {
        orderMap.set(toKey(item.data.platform, item.data.id), idx);
      }
    });
    const scored = availableStreamers.map((s) => {
      const key = toKey(s.platform, s.id);
      return { s, idx: orderMap.get(key) ?? Number.MAX_SAFE_INTEGER, live: Boolean(s.isLive) };
    });
    scored.sort((a, b) => {
      if (a.live !== b.live) return a.live ? -1 : 1;
      if (a.idx !== b.idx) return a.idx - b.idx;
      return (a.s.nickname || a.s.displayName || "").localeCompare(b.s.nickname || b.s.displayName || "");
    });
    return scored.map((v) => v.s);
  }, [availableStreamers, listOrder]);

  const orderedIds = useMemo(() => orderedAvailable.map((s) => toKey(s.platform, s.id)), [orderedAvailable]);

  const collapsedItems = useMemo(() => {
    // 折叠态：文件夹优先，再按直播优先和用户顺序显示主播。
    let items: typeof listOrder;
    if (listOrder.length) {
      const streamerMap = new Map<string, (typeof orderedAvailable)[number]>();
      orderedAvailable.forEach((s) => streamerMap.set(`${s.platform}:${s.id}`, s));
      items = listOrder.map((item) => {
        if (item.type === "streamer") {
          const s = streamerMap.get(`${item.data.platform}:${item.data.id}`) || item.data;
          return { type: "streamer" as const, data: s };
        }
        return item;
      });
    } else {
      items = orderedAvailable.map((s) => ({ type: "streamer", data: s })) as typeof listOrder;
    }
    const foldersFirst = items.filter((i) => i.type === "folder");
    const streamerItems = items
      .map((item, idx) => ({ item, idx, live: item.type === "streamer" && Boolean(item.data.isLive) }))
      .filter((v) => v.item.type === "streamer")
      .sort((a, b) => {
        if (a.live !== b.live) return a.live ? -1 : 1;
        return a.idx - b.idx;
      })
      .map((v) => v.item);
    return [...foldersFirst, ...streamerItems];
  }, [listOrder, orderedAvailable]);

  const containerClass = isDark
    ? "bg-slate-900/80 border-white/10 text-white shadow-2xl"
    : "bg-white/70 border-white/40 text-slate-800 shadow-xl";

  const getHoverFolderId = (clientX: number, clientY: number) => {
    if (typeof document === "undefined") return null;
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-folder-drop]"));
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        const id = el.dataset.folderId;
        if (id) return id;
      }
    }
    return null;
  };

  const getClientPoint = (e: MouseEvent | PointerEvent | TouchEvent) => {
    if ("touches" in e && e.touches?.[0]) {
      const t = e.touches[0];
      return { x: t.clientX, y: t.clientY };
    }
    if ("changedTouches" in e && e.changedTouches?.[0]) {
      const t = e.changedTouches[0];
      return { x: t.clientX, y: t.clientY };
    }
    return { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY };
  };

  const measureHover = useCallback(
    (layout: "full" | "icons", index: number) => {
      const parent = sidebarRef.current;
      const el = hoverRefs.current[layout][index];
      if (!parent || !el) {
        setHoverRect((prev) => (prev === null ? prev : null));
        return;
      }
      const parentRect = parent.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      const next = {
        left: rect.left - parentRect.left,
        top: rect.top - parentRect.top,
        width: rect.width,
        height: rect.height,
      };
      setHoverRect((prev) => {
        if (
          prev &&
          prev.left === next.left &&
          prev.top === next.top &&
          prev.width === next.width &&
          prev.height === next.height
        ) {
          return prev;
        }
        return next;
      });
    },
    []
  );

  const setHoverRef = useCallback(
    (layout: "full" | "icons", index: number) => (el: HTMLElement | null) => {
      hoverRefs.current[layout][index] = el;
      if (hoveredIndex && hoveredIndex.layout === layout && hoveredIndex.index === index) {
        if (hoverMeasureRaf.current) cancelAnimationFrame(hoverMeasureRaf.current);
        hoverMeasureRaf.current = requestAnimationFrame(() => {
          measureHover(layout, index);
          hoverMeasureRaf.current = null;
        });
      }
    },
    [hoveredIndex, measureHover]
  );

  const handleHover = useCallback((layout: "full" | "icons", index: number) => {
    setHoveredIndex({ layout, index });
  }, []);

  const clearHover = useCallback(() => {
    setHoveredIndex(null);
    setHoverRect(null);
  }, []);

  const handleScroll = useCallback(() => {
    if (hoveredIndex) {
      measureHover(hoveredIndex.layout, hoveredIndex.index);
    }
  }, [hoveredIndex, measureHover]);

  const refreshFollowStatus = useCallback(async () => {
    if (refreshLock.current) return;
    refreshLock.current = true;
    try {
      const promises = followedStreamers.map(async (s) => {
        try {
          let info: any = null;
          if (s.platform === "DOUYU") {
            info = await tauriInvoke("fetch_douyu_room_info", { roomId: s.id });
          } else if (s.platform === "DOUYIN") {
            info = await tauriInvoke("fetch_douyin_streamer_info", { payload: { args: { room_id_str: s.id } } });
          } else if (s.platform === "BILIBILI") {
            info = await tauriInvoke("fetch_bilibili_streamer_info", { payload: { args: { room_id_str: s.id } } });
          } else if (s.platform === "HUYA") {
            info = await tauriInvoke("get_huya_unified_cmd", { roomId: s.id, quality: null, line: null });
          } else {
            console.log("[sidebar] refresh skipped (unsupported platform)", { platform: s.platform, id: s.id });
            return;
          }
          if (!info) return;
          const liveFlag =
            s.platform === "DOUYU"
              ? Number(info.show_status) === 1
              : s.platform === "DOUYIN"
                ? Number(info.status ?? info.live_status) === 2 || info.status === 1
                : s.platform === "BILIBILI"
                  ? Number(info.live_status ?? info.status) === 1
                  : s.platform === "HUYA"
                    ? Boolean(info.is_live ?? info.status)
                    : Boolean(info.is_live ?? info.isLive ?? info.status);
          const avatarUrl = normalizeAvatar(
            s.platform,
            s.platform === "BILIBILI" ? info.avatar : info.avatar_url || info.avatar || info.pic || info.avatar180 || s.avatarUrl
          );
          updateStreamerDetails({
            platform: s.platform,
            id: s.id,
            nickname: info.nickname || info.anchor_name || info.nick || info.owner_name || info.nickName || s.nickname,
            displayName:
              info.displayName || info.anchorName || info.owner_name || info.nick || info.anchor_name || s.displayName,
            roomTitle:
              info.room_title ||
              info.title ||
              info.roomTitle ||
              info.live_title ||
              info.roomName ||
              info.introduction ||
              s.roomTitle,
            avatarUrl,
            isLive: liveFlag,
          });
          console.log("[sidebar] refresh single ok", {
            platform: s.platform,
            id: s.id,
            live: liveFlag,
            title: info.room_title || info.title || info.roomTitle || info.live_title || info.roomName,
          });
        } catch (err) {
          console.warn("[sidebar] refresh single failed", { platform: s.platform, id: s.id, err });
        }
      });
      await Promise.all(promises);
      console.log("[sidebar] refreshed follow status via per-platform detail");
    } finally {
      refreshLock.current = false;
    }
  }, [followedStreamers, updateStreamerDetails]);

  const clearFolderPreviewTimer = () => {
    if (folderPreviewTimer.current) {
      window.clearTimeout(folderPreviewTimer.current);
      folderPreviewTimer.current = null;
    }
  };

  const scheduleHideFolderPreview = (delay = 120) => {
    clearFolderPreviewTimer();
    folderPreviewTimer.current = window.setTimeout(() => setFolderPreview(null), delay);
  };

  const clearCollapsedPreviewTimer = () => {
    if (collapsedPreviewTimer.current) {
      window.clearTimeout(collapsedPreviewTimer.current);
      collapsedPreviewTimer.current = null;
    }
  };

  const scheduleHideCollapsedPreview = (delay = 80) => {
    clearCollapsedPreviewTimer();
    collapsedPreviewTimer.current = window.setTimeout(() => setCollapsedHover(null), delay);
  };

  const statusDot = (live?: boolean | null) => (
    <span
      className={cn(
        "absolute -bottom-0.5 -right-0.5 rounded-full border-2 w-3.5 h-3.5",
        isDark ? "border-slate-900" : "border-white",
        live ? "bg-emerald-400" : "bg-gray-500/70"
      )}
    />
  );

  const streamerMap = useMemo(() => {
    const map = new Map<string, (typeof availableStreamers)[number]>();
    availableStreamers.forEach((s) => map.set(toKey(s.platform, s.id), s));
    return map;
  }, [availableStreamers]);

  const reorderItems = useMemo(() => {
    return orderedIds
      .map((key) => {
        const s = streamerMap.get(key);
        return s ? { key, data: s } : null;
      })
      .filter((v): v is { key: string; data: (typeof availableStreamers)[number] } => Boolean(v));
  }, [orderedIds, streamerMap]);

  const reorderValues = useMemo(() => reorderItems.map((r) => r.key), [reorderItems]);

  const persistReorder = (orderedKeys: string[]) => {
    const nextListOrder = listOrder
      .map((item) => {
        if (item.type === "folder") return item;
        const nextKey = orderedKeys.shift();
        if (!nextKey) return null;
        const nextStreamer = streamerMap.get(nextKey);
        if (!nextStreamer) return null;
        return { type: "streamer" as const, data: nextStreamer };
      })
      .filter((v): v is typeof listOrder[number] => Boolean(v));

    orderedKeys.forEach((key) => {
      const streamer = streamerMap.get(key);
      if (streamer) {
        nextListOrder.push({ type: "streamer", data: streamer });
      }
    });

    updateListOrder(nextListOrder);
  };

  const handleReorderList = (nextKeys: string[]) => {
    persistReorder([...nextKeys]);
  };

  const handleCreateFolder = () => {
    const fallback = `自定义分组${folders.length + 1}`;
    const input =
      typeof window !== "undefined" && typeof window.prompt === "function"
        ? window.prompt("新建自定义文件夹", fallback)
        : null;
    const name = input?.trim() || fallback;
    createFolder(name);
  };

  useEffect(() => {
    const closeMenu = () => setFolderMenu(null);
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFolderMenu(null);
    };
    hydrate();
    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", handleEsc);
    setMounted(true);
    void refreshFollowStatus();
    return () => {
      if (hoverMeasureRaf.current) cancelAnimationFrame(hoverMeasureRaf.current);
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", handleEsc);
    };
  }, [hydrate]);

  useEffect(() => {
    return () => {
      clearFolderPreviewTimer();
      clearCollapsedPreviewTimer();
      if (hoverMeasureRaf.current) cancelAnimationFrame(hoverMeasureRaf.current);
    };
  }, []);

  useEffect(() => {
    if (hoveredIndex) {
      measureHover(hoveredIndex.layout, hoveredIndex.index);
    } else {
      setHoverRect(null);
    }
  }, [hoveredIndex, measureHover]);

  useEffect(() => {
    const handleResize = () => {
      if (hoveredIndex) {
        measureHover(hoveredIndex.layout, hoveredIndex.index);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [hoveredIndex, measureHover]);

  useEffect(() => {
    if (hoveredIndex) {
      measureHover(hoveredIndex.layout, hoveredIndex.index);
    } else {
      setHoverRect(null);
    }
  }, [isLeaderboardOpen, hoveredIndex, measureHover]);

  let fullHoverIndex = 0;
  const hoverPadX = hoveredIndex?.layout === "icons" ? 7 : 4;
  const hoverPadY = hoveredIndex?.layout === "icons" ? 4 : 2;

  return (
    <aside
      ref={sidebarRef}
      onMouseLeave={clearHover}
      onScroll={handleScroll}
      className={`relative flex flex-col items-center py-4 w-full max-w-[240px] h-full border-r backdrop-blur-xl transition-all duration-300 overflow-y-auto no-scrollbar ${containerClass} ${className}`}
    >
      <AnimatePresence>
        {hoverRect ? (
          <motion.div
            key="nav-hover"
            layoutId="nav-hover"
            className="absolute pointer-events-none rounded-3xl border"
            style={{
              pointerEvents: "none",
              backgroundImage: isDark
                ? "linear-gradient(to right bottom, rgba(255,255,255,0.18), rgba(255,255,255,0.12))"
                : "linear-gradient(to right bottom, rgba(0,0,0,0.08), rgba(0,0,0,0.04))",
              boxShadow: "none",
              borderColor: "transparent",
            }}
            initial={false}
            animate={{
              opacity: 1,
              left: hoverRect.left - hoverPadX,
              top: hoverRect.top - hoverPadY,
              width: hoverRect.width + hoverPadX * 2,
              height: hoverRect.height + hoverPadY * 2,
            }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 30, mass: 0.9 }}
          />
        ) : null}
      </AnimatePresence>
      <div className={`w-full flex flex-col ${isLeaderboardOpen ? "items-start" : "items-center"} gap-4 px-3`}>
        <div className="flex items-center gap-2">
          {isLeaderboardOpen ? (
            <>
              <button
                onClick={toggleSidebar}
                className={`h-11 w-11 inline-flex items-center justify-center rounded-2xl text-sm font-semibold transition-all ${
                  isDark ? "bg-white/6 hover:bg-white/12 text-white" : "bg-white hover:bg-gray-50 text-gray-900"
                }`}
                title={isLeaderboardOpen ? "Collapse follows" : "Expand follows"}
              >
                {isLeaderboardOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (isRefreshing) return;
                  setIsRefreshing(true);
                  try {
                    hydrate();
                    await refreshFollowStatus();
                  } finally {
                    setIsRefreshing(false);
                  }
                }}
                className={`h-11 w-11 inline-flex items-center justify-center rounded-2xl text-sm font-semibold transition-all ${
                  isDark ? "bg-white/6 hover:bg-white/12 text-white" : "bg-white hover:bg-gray-50 text-gray-900"
                }`}
                title="刷新关注状态"
              >
                <RotateCw className={`w-5 h-5 ${isRefreshing ? "animate-spin" : ""}`} />
              </button>
              <button
                type="button"
                onClick={handleCreateFolder}
                className={`h-11 w-11 inline-flex items-center justify-center rounded-2xl text-sm font-semibold transition-all ${
                  isDark ? "bg-white/6 hover:bg-white/12 text-white" : "bg-white hover:bg-gray-50 text-gray-900"
                }`}
                title="新建文件夹"
              >
                <FolderPlus className="w-5 h-5" />
              </button>
            </>
          ) : (
            <button
              onClick={toggleSidebar}
              className={`w-11 h-11 inline-flex items-center justify-center rounded-2xl transition-colors ${
                isDark ? "bg-white/6 hover:bg-white/12" : "bg-white hover:bg-gray-100"
              }`}
              title={isLeaderboardOpen ? "Collapse follows" : "Expand follows"}
            >
              {isLeaderboardOpen ? (
                <PanelLeftClose className={`w-5 h-5 ${isDark ? "text-white" : "text-gray-900"}`} />
              ) : (
                <PanelLeftOpen className={`w-5 h-5 ${isDark ? "text-white" : "text-gray-900"}`} />
              )}
            </button>
          )}
        </div>

        {!isLeaderboardOpen && (orderedFollows.length > 0 || folders.length > 0) ? (
          <div className="flex flex-col items-center gap-3 mt-1 w-full px-2">
            {collapsedItems.map((item, idx) => {
              if (item.type === "streamer") {
                const s = orderedFollows.find((f) => f.platform === item.data.platform && f.id === item.data.id);
                if (!s) return null;
                const key = toKey(s.platform, s.id);
                const hoverIndex = idx;
                return (
                  <button
                    key={key}
                    type="button"
                    ref={setHoverRef("icons", hoverIndex)}
                    data-follow-item-key={key}
                    onClick={() =>
                      openPlayer({
                        platform: s.platform,
                        roomId: s.id,
                        title: s.roomTitle,
                        anchorName: s.nickname,
                        avatar: normalizeAvatar(s.platform, s.avatarUrl),
                      })
                    }
                    onMouseEnter={(e) => {
                      if (isLeaderboardOpen) return;
                      handleHover("icons", hoverIndex);
                      clearCollapsedPreviewTimer();
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setCollapsedHover({
                        key: `${s.platform}:${s.id}`,
                        x: rect.right + 10,
                        y: rect.top,
                        name: s.nickname || s.displayName || s.id,
                        title: s.roomTitle || s.displayName || s.nickname || "",
                        avatar: normalizeAvatar(s.platform, s.avatarUrl),
                      });
                    }}
                    onMouseLeave={() => {
                      scheduleHideCollapsedPreview();
                      clearHover();
                    }}
                    className={`relative w-10 h-10 rounded-full border shadow-sm transition-all duration-200 ${
                      isDark
                        ? "border-white/10 hover:border-white/25 hover:scale-105"
                        : "border-gray-200 hover:border-gray-300 hover:scale-105"
                    }`}
                    title={s.nickname || s.displayName || s.id}
                  >
                    {normalizeAvatar(s.platform, s.avatarUrl) ? (
                      <Image
                        src={normalizeAvatar(s.platform, s.avatarUrl) || ""}
                        alt={s.nickname || s.displayName || s.id}
                        width={40}
                        height={40}
                        sizes="40px"
                        className="w-full h-full rounded-full object-cover"
                      />
                    ) : (
                      <div
                        className={`w-full h-full rounded-full flex items-center justify-center text-xs ${
                          isDark ? "text-gray-300 bg-white/10" : "text-gray-600 bg-gray-100"
                        }`}
                      >
                        {(s.nickname || s.displayName || s.id).slice(0, 1)}
                      </div>
                    )}
                    {statusDot(s.isLive)}
                  </button>
                );
              }
              const folder = folders.find((f) => f.id === item.data.id);
              if (!folder) return null;
              const items = (folder.streamerIds || [])
                .map((id) => {
                  const [p, i] = (id || "").split(":");
                  return followedStreamers.find(
                    (s) => String(s.platform).toUpperCase() === String(p || "").toUpperCase() && s.id === i
                  );
                })
                .filter((v): v is (typeof followedStreamers)[number] => Boolean(v));
              const label = (folder.name || "F").slice(0, 1);
              const hoverIndex = idx;
              return (
                <div
                  key={`folder-${folder.id}`}
                  ref={setHoverRef("icons", hoverIndex)}
                  className={`px-3 h-10 rounded-2xl border shadow-sm flex items-center justify-center text-xs font-semibold uppercase transition-all duration-200 ${
                    isDark
                      ? "border-white/10 bg-white/10 text-white hover:border-white/25"
                      : "border-gray-200 bg-gray-50 text-gray-800 hover:border-gray-300"
                  }`}
                  title={folder.name}
                  onMouseEnter={(e) => {
                    if (isLeaderboardOpen) return;
                    handleHover("icons", hoverIndex);
                    clearFolderPreviewTimer();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setFolderPreview({ id: folder.id, x: rect.right + 10, y: rect.top });
                  }}
                  onMouseLeave={() => {
                    scheduleHideFolderPreview();
                    clearHover();
                  }}
                >
                  {label}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {isLeaderboardOpen ? (
        <div className="flex-1 w-full overflow-y-auto no-scrollbar py-3 px-2.5 space-y-2">
          {orderedIds.length === 0 && <div className="text-xs text-center text-gray-400">No followed streamers</div>}
          <div className="flex flex-col gap-2">
            {folders.map((folder) => {
              const items = (folder.streamerIds || [])
                .map((id) => {
                  const [p, i] = (id || "").split(":");
                  return followedStreamers.find(
                    (s) => String(s.platform).toUpperCase() === String(p || "").toUpperCase() && s.id === i
                  );
                })
                .filter((v): v is (typeof followedStreamers)[number] => Boolean(v));
              const sortedItems = items
                .map((item, idx) => ({ item, idx }))
                .sort((a, b) => {
                  if (Boolean(a.item.isLive) !== Boolean(b.item.isLive)) return a.item.isLive ? -1 : 1;
                  return a.idx - b.idx;
                })
                .map((v) => v.item);
              const expanded = folder.expanded ?? true;
              const isHover = hoverFolderId === folder.id;
              return (
                <div
                  key={`folder-${folder.id}`}
                  data-folder-drop
                  data-folder-id={folder.id}
                  className={`w-full rounded-xl border text-xs font-medium transition-all duration-150 ${
                    isDark ? "border-white/10 bg-white/5 text-white" : "border-gray-200 bg-gray-50 text-gray-800"
                  } ${
                    isHover
                      ? isDark
                        ? "border-emerald-300/80 bg-emerald-500/10 shadow-[0_10px_30px_-12px_rgba(16,185,129,0.7)] ring-1 ring-emerald-300/70"
                        : "border-emerald-500 bg-emerald-50 shadow-[0_10px_30px_-12px_rgba(16,185,129,0.35)] ring-1 ring-emerald-400/70"
                      : ""
                  }`}
                  title={folder.name}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setHoverFolderId(folder.id);
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setHoverFolderId(folder.id);
                  }}
                  onDragLeave={() => setHoverFolderId((prev) => (prev === folder.id ? null : prev))}
                  onDrop={(e) => {
                    e.preventDefault();
                    const key = e.dataTransfer?.getData("text/plain") || draggingKey;
                    if (key) {
                      moveToFolder(key, folder.id);
                    }
                    setDraggingKey(null);
                    setHoverFolderId(null);
                  }}
                  onPointerEnter={() => {
                    if (!draggingKey) return;
                    setHoverFolderId(folder.id);
                  }}
                  onPointerLeave={() => setHoverFolderId((prev) => (prev === folder.id ? null : prev))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    console.log("[sidebar] open folder menu", { id: folder.id, name: folder.name });
                    setFolderMenu({ id: folder.id, x: e.clientX, y: e.clientY, renameDraft: undefined });
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleFolderExpanded(folder.id)}
                    className="w-full px-3 py-2 flex items-center gap-2"
                  >
                    <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-0" : "-rotate-90"}`} />
                    <span className="truncate max-w-[120px] flex-1 text-left">{folder.name}</span>
                    <span className="text-[11px] text-gray-400">{folder.streamerIds?.length || 0}</span>
                  </button>
                  {expanded ? (
                    <div className="px-3 pb-2 space-y-1.5">
                      {sortedItems.length === 0 ? (
                        <div className="text-[11px] text-gray-400">暂无主播，拖动加入</div>
                      ) : (
                        sortedItems.map((item) => {
                          const itemKey = toKey(item.platform, item.id);
                          const avatar = normalizeAvatar(item.platform, item.avatarUrl);
                          const hoverIndex = fullHoverIndex++;
                          return (
                            <button
                              key={`${item.platform}:${item.id}`}
                              type="button"
                              ref={setHoverRef("full", hoverIndex)}
                              data-follow-item-key={itemKey}
                              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors"
                              onMouseEnter={() => handleHover("full", hoverIndex)}
                              onMouseLeave={clearHover}
                              onClick={() =>
                                openPlayer({
                                  platform: item.platform,
                                  roomId: item.id,
                                  title: item.roomTitle,
                                  anchorName: item.nickname,
                                  avatar,
                                })
                              }
                            >
                              <div className="relative flex-shrink-0">
                                {avatar ? (
                                  <Image
                                    src={avatar}
                                    alt={item.nickname || item.displayName || item.id}
                                    width={28}
                                    height={28}
                                    sizes="28px"
                                    className="w-7 h-7 rounded-full object-cover border border-white/10"
                                  />
                                ) : (
                                  <div
                                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold ${
                                      isDark ? "bg-white/10 text-white" : "bg-black/5 text-slate-800"
                                    }`}
                                  >
                                    {(item.nickname || item.displayName || item.id).slice(0, 1)}
                                  </div>
                                )}
                                {statusDot(item.isLive)}
                              </div>
                              <div className="flex flex-col min-w-0 text-left">
                                <span className="text-[12px] font-semibold truncate">
                                  {item.nickname || item.displayName}
                                </span>
                                <span className="text-[11px] text-gray-400 truncate">
                                  {item.roomTitle || item.displayName || platformLabelMap[item.platform]}
                                </span>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {orderedIds.length > 0 && reorderValues.length > 0 ? (
            <Reorder.Group axis="y" values={reorderValues} onReorder={handleReorderList} className="space-y-1">
              {reorderItems.map((item) => {
                const hoverIndex = fullHoverIndex++;
                return (
                  <ReorderableStreamer
                    key={item.key}
                    itemKey={item.key}
                    data={item.data}
                    isDark={isDark}
                    getHoverFolderId={getHoverFolderId}
                    getClientPoint={getClientPoint}
                    setDraggingKey={setDraggingKey}
                    setHoverFolderId={setHoverFolderId}
                    hoverFolderId={hoverFolderId}
                    moveToFolder={moveToFolder}
                    openPlayer={openPlayer}
                    statusDot={statusDot}
                    hoverIndex={hoverIndex}
                    onHover={(idx) => handleHover("full", idx)}
                    onHoverEnd={clearHover}
                    getHoverRef={(idx) => setHoverRef("full", idx)}
                  />
                );
              })}
            </Reorder.Group>
          ) : null}
          {mounted && folderMenu
            ? createPortal(
                <div
                  className="fixed inset-0 z-[9999]"
                  onClick={() => setFolderMenu(null)}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  <div
                    id="sidebar-folder-menu"
                    className={`absolute w-40 rounded-xl border shadow-lg p-1 ${
                      isDark ? "bg-slate-800 border-white/10 text-white" : "bg-white border-gray-200 text-slate-900"
                    }`}
                    style={{ top: folderMenu.y, left: folderMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {folderMenu.renameDraft !== undefined ? (
                      <div className="p-2 space-y-2">
                        <input
                          autoFocus
                          value={folderMenu.renameDraft}
                          onChange={(e) => setFolderMenu({ ...folderMenu, renameDraft: e.target.value })}
                          className={`w-full px-2 py-1 rounded-lg border text-sm outline-none ${
                            isDark ? "bg-slate-700 border-white/10 text-white" : "bg-white border-gray-200 text-slate-800"
                          }`}
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            className="px-3 py-1 rounded-lg text-sm hover:bg-black/5"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFolderMenu(null);
                            }}
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            className="px-3 py-1 rounded-lg text-sm bg-emerald-500 text-white hover:bg-emerald-600"
                            onClick={(e) => {
                              e.stopPropagation();
                              const folder = folders.find((f) => f.id === folderMenu.id);
                              if (!folder) return;
                              const nextName = folderMenu.renameDraft?.trim();
                              if (nextName) {
                                renameFolder(folder.id, nextName);
                                console.log("[sidebar] rename applied", { id: folder.id, nextName });
                              } else {
                                console.log("[sidebar] rename canceled or empty");
                              }
                              setFolderMenu(null);
                            }}
                          >
                            保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const folder = folders.find((f) => f.id === folderMenu.id);
                            if (!folder) return;
                            console.log("[sidebar] rename click", { id: folder.id, name: folder.name });
                            setFolderMenu({ ...folderMenu, renameDraft: folder.name });
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                            isDark ? "hover:bg-white/10" : "hover:bg-black/5"
                          }`}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const folder = folders.find((f) => f.id === folderMenu.id);
                            if (!folder) return;
                            console.log("[sidebar] delete click", { id: folder.id, name: folder.name });
                            deleteFolder(folder.id);
                            console.log("[sidebar] delete success", { id: folder.id });
                            setFolderMenu(null);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm text-red-500 ${
                            isDark ? "hover:bg-white/10" : "hover:bg-black/5"
                          }`}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>,
                document.body
              )
            : null}
        </div>
        ) : null}

      {mounted && !isLeaderboardOpen && folderPreview
        ? createPortal(
            <div className="fixed inset-0 z-[9999] pointer-events-none">
              <motion.div
                className={`absolute w-60 max-w-[270px] rounded-xl border shadow-xl p-3 pointer-events-auto ${
                  isDark ? "bg-slate-900 text-white border-white/10" : "bg-white text-slate-900 border-gray-200"
                }`}
                style={{ top: folderPreview.y, left: folderPreview.x }}
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 260, damping: 22, mass: 0.6 }}
                onMouseEnter={clearFolderPreviewTimer}
                onMouseLeave={() => scheduleHideFolderPreview()}
              >
                {(() => {
                  const folder = folders.find((f) => f.id === folderPreview.id);
                  if (!folder) return <div className="text-xs text-gray-400">未找到内容</div>;
                  const items = (folder.streamerIds || [])
                    .map((id) => {
                      const [p, i] = (id || "").split(":");
                      return followedStreamers.find(
                        (s) => String(s.platform).toUpperCase() === String(p || "").toUpperCase() && s.id === i
                      );
                    })
                    .filter((v): v is (typeof followedStreamers)[number] => Boolean(v));
                  if (items.length === 0) return <div className="text-xs text-gray-400">暂无主播</div>;
                  const sortedItems = items
                    .map((item, idx) => ({ item, idx }))
                    .sort((a, b) => {
                      if (Boolean(a.item.isLive) !== Boolean(b.item.isLive)) return a.item.isLive ? -1 : 1;
                      return a.idx - b.idx;
                    })
                    .map((v) => v.item);
                  const maxVisible = 8;
                  const listMaxHeight = `${Math.min(sortedItems.length, maxVisible) * 56}px`;
                  return (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold truncate">{folder.name}</div>
                      <div
                        className="space-y-1 overflow-y-auto pr-1 no-scrollbar"
                        style={{ maxHeight: listMaxHeight }}
                      >
                        {sortedItems.map((item) => {
                          const displayTitle =
                            item.roomTitle || item.displayName || item.nickname || platformLabelMap[item.platform];
                          return (
                          <button
                            key={`${item.platform}:${item.id}`}
                            className={`w-full flex items-center gap-2 text-sm rounded-lg px-1.5 py-1 transition-colors ${
                              isDark ? "hover:bg-white/10" : "hover:bg-black/5"
                            }`}
                            onClick={() =>
                              openPlayer({
                                platform: item.platform,
                                roomId: item.id,
                                title: item.roomTitle,
                                anchorName: item.nickname,
                                avatar: normalizeAvatar(item.platform, item.avatarUrl),
                              })
                            }
                          >
                            <div className="relative w-7 h-7">
                              {normalizeAvatar(item.platform, item.avatarUrl) ? (
                                <Image
                                  src={normalizeAvatar(item.platform, item.avatarUrl) || ""}
                                  alt={item.nickname || item.displayName || item.id}
                                  width={28}
                                  height={28}
                                  sizes="28px"
                                  className="w-7 h-7 rounded-full object-cover border border-white/10"
                                />
                              ) : (
                                <div
                                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold ${
                                    isDark ? "bg-white/10 text-white" : "bg-black/5 text-slate-800"
                                  }`}
                                >
                                  {(item.nickname || item.displayName || item.id).slice(0, 1)}
                                </div>
                              )}
                              {statusDot(item.isLive)}
                            </div>
                            <div className="flex flex-col min-w-0 text-left">
                              <span className="text-[12px] font-semibold truncate">
                                {item.nickname || item.displayName}
                              </span>
                              <span className="text-[11px] text-gray-400 truncate" title={displayTitle}>
                                {displayTitle}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                      </div>
                    </div>
                  );
                })()}
              </motion.div>
            </div>,
            document.body
          )
        : null}

      {mounted && !isLeaderboardOpen && collapsedHover
        ? createPortal(
            <motion.div
              className="fixed z-[9998] pointer-events-none"
              style={{ top: collapsedHover.y, left: collapsedHover.x }}
              initial={{ opacity: 0, y: -4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 280, damping: 18, mass: 0.6 }}
            >
              <div
                className={`rounded-xl border px-3 py-2 shadow-lg max-w-[240px] ${
                  isDark
                    ? "bg-slate-900/95 text-white border-white/10 backdrop-blur-md"
                    : "bg-white text-slate-900 border-gray-200 backdrop-blur-md"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="relative w-8 h-8">
                    {collapsedHover.avatar ? (
                      <Image
                        src={collapsedHover.avatar}
                        alt={collapsedHover.name}
                        width={32}
                        height={32}
                        sizes="32px"
                        className="w-8 h-8 rounded-full object-cover border border-white/10"
                      />
                    ) : (
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${
                          isDark ? "bg-white/10 text-white" : "bg-black/5 text-slate-800"
                        }`}
                      >
                        {collapsedHover.name.slice(0, 1)}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold truncate">{collapsedHover.name}</span>
                    <span className="text-[11px] text-gray-400 truncate">{collapsedHover.title}</span>
                  </div>
                </div>
              </div>
            </motion.div>,
            document.body
          )
        : null}
    </aside>
  );
}

type ReorderableStreamerProps = {
  itemKey: string;
  data: FollowedStreamer;
  isDark: boolean;
  getHoverFolderId: (x: number, y: number) => string | null;
  getClientPoint: (e: MouseEvent | PointerEvent | TouchEvent) => { x: number; y: number };
  setDraggingKey: (key: string | null) => void;
  setHoverFolderId: (id: string | null) => void;
  hoverFolderId: string | null;
  moveToFolder: (key: string, folderId: string) => void;
  openPlayer: (payload: {
    platform: Platform;
    roomId: string;
    title?: string | null;
    anchorName?: string | null;
    avatar?: string | null;
  }) => void;
  statusDot: (live?: boolean | null) => React.ReactElement;
  hoverIndex: number;
  onHover: (index: number) => void;
  onHoverEnd: () => void;
  getHoverRef: (index: number) => (el: HTMLElement | null) => void;
};

function ReorderableStreamer({
  itemKey,
  data,
  isDark,
  getHoverFolderId,
  getClientPoint,
  setDraggingKey,
  setHoverFolderId,
  hoverFolderId,
  moveToFolder,
  openPlayer,
  statusDot,
  hoverIndex,
  onHover,
  onHoverEnd,
  getHoverRef,
}: ReorderableStreamerProps) {
  const controls = useDragControls();
  const pressTimer = useRef<number | null>(null);
  const dragStarted = useRef(false);
  const lastPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const wasDragging = useRef(false);
  const pointerActive = useRef(false);

  const clearTimer = () => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const startDrag = (e: React.PointerEvent) => {
    if (dragStarted.current) return;
    dragStarted.current = true;
    wasDragging.current = true;
    setDraggingKey(itemKey);
    setHoverFolderId(null);
    controls.start(e);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    wasDragging.current = false;
    dragStarted.current = false;
    pointerActive.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    clearTimer();
    pressTimer.current = window.setTimeout(() => startDrag(e), 220);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointerActive.current || dragStarted.current) return;
    if (!(e.buttons & 1)) {
      pointerActive.current = false;
      clearTimer();
      return;
    }
    const dx = Math.abs(e.clientX - lastPos.current.x);
    const dy = Math.abs(e.clientY - lastPos.current.y);
    if (dx + dy > 6) {
      clearTimer();
      startDrag(e);
    }
  };

  const handlePointerUp = () => {
    clearTimer();
    dragStarted.current = false;
    pointerActive.current = false;
    setTimeout(() => {
      wasDragging.current = false;
    }, 50);
  };

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, []);

  const avatar = normalizeAvatarGlobal(data.platform, data.avatarUrl);
  const hoverRef = getHoverRef(hoverIndex);

  return (
    <Reorder.Item
      value={itemKey}
      dragListener={false}
      dragControls={controls}
      as="div"
      layout
      transition={{ type: "spring", stiffness: 320, damping: 28, mass: 0.9 }}
      whileDrag={{ scale: 0.98, opacity: 0.9 }}
      className="flex"
      onDragStart={(e) => {
        onHoverEnd();
        setDraggingKey(itemKey);
        setHoverFolderId(null);
        const { x, y } = getClientPoint(e as unknown as MouseEvent | PointerEvent | TouchEvent);
        const hit = getHoverFolderId(x, y);
        if (hit) setHoverFolderId(hit);
      }}
      onDrag={(e) => {
        const { x, y } = getClientPoint(e as unknown as MouseEvent | PointerEvent | TouchEvent);
        const hit = getHoverFolderId(x, y);
        setHoverFolderId(hit);
      }}
      onDragEnd={(e) => {
        const { x, y } = getClientPoint(e as unknown as MouseEvent | PointerEvent | TouchEvent);
        const hit = getHoverFolderId(x, y) || hoverFolderId;
        if (hit) {
          moveToFolder(itemKey, hit);
        }
        onHoverEnd();
        setDraggingKey(null);
        setHoverFolderId(null);
        wasDragging.current = true;
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <button
        data-follow-item-key={itemKey}
        ref={hoverRef}
        onMouseEnter={() => onHover(hoverIndex)}
        onMouseLeave={onHoverEnd}
        onClick={() => {
          if (wasDragging.current) {
            wasDragging.current = false;
            return;
          }
          openPlayer({
            platform: data.platform,
            roomId: data.id,
            title: data.roomTitle,
            anchorName: data.nickname,
            avatar,
          });
        }}
        className="group w-full flex items-center gap-2 p-1.5 rounded-xl transition-all"
      >
        <div className="relative flex-shrink-0">
          {avatar ? (
            <Image
              src={avatar}
              alt={data.nickname || data.displayName || data.id}
              width={32}
              height={32}
              sizes="32px"
              className="w-8 h-8 rounded-full object-cover border border-white/10"
            />
          ) : (
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold ${
                isDark ? "bg-white/10 text-white" : "bg-black/5 text-slate-800"
              }`}
            >
              {(data.nickname || data.displayName || data.id).slice(0, 1)}
            </div>
          )}
          {statusDot(data.isLive)}
        </div>
        <div className="flex flex-col min-w-0 text-left">
          <span className="text-[13px] font-semibold truncate">{data.nickname || data.displayName}</span>
          <span className="text-[11px] text-gray-400 truncate">
            {data.roomTitle || data.displayName || platformLabelMap[data.platform]}
          </span>
        </div>
      </button>
    </Reorder.Item>
  );
}
