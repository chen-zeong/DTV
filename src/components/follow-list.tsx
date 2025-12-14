"use client";

import { ChevronDown, Plus, RefreshCw } from "lucide-react";
import Image from "next/image";
import { ThemeMode } from "@/types/follow-list";
import { type FollowListItem, useFollowStore } from "@/stores/follow-store";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/utils/cn";
import { platformLabelMap } from "@/utils/platform";
import { usePlayerOverlayStore } from "@/stores/player-overlay-store";
import { createPortal } from "react-dom";
import { normalizeAvatarUrl } from "@/utils/image";
import { Platform } from "@/types/platform";

type FollowListProps = {
  theme: ThemeMode;
};

export function FollowList({ theme }: FollowListProps) {
  const isDark = theme === "dark";
  const follows = useFollowStore((s) => s.followedStreamers);
  const folders = useFollowStore((s) => s.folders);
  const createFolder = useFollowStore((s) => s.createFolder);
  const renameFolder = useFollowStore((s) => s.renameFolder);
  const toggleFolderExpanded = useFollowStore((s) => s.toggleFolderExpanded);
  const hydrate = useFollowStore((s) => s.hydrateFromLegacy);
  const moveToFolder = useFollowStore((s) => s.moveStreamerToFolder);
  const removeFromFolder = useFollowStore((s) => s.removeStreamerFromFolder);
  const deleteFolder = useFollowStore((s) => s.deleteFolder);
  const listOrder = useFollowStore((s) => s.listOrder);
  const updateListOrder = useFollowStore((s) => s.updateListOrder);
  const updateStreamerDetails = useFollowStore((s) => s.updateStreamerDetails);
  const openPlayer = usePlayerOverlayStore((s) => s.open);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragReadyKey, setDragReadyKey] = useState<string | null>(null);
  const [dragSourceFolder, setDragSourceFolder] = useState<string | null>(null);
  const [hoverFolderId, setHoverFolderId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ folderId: string; x: number; y: number } | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const glassClass = isDark
    ? "bg-[rgba(20,20,20,0.65)] border-r border-[rgba(255,255,255,0.08)] text-white"
    : "bg-[rgba(255,255,255,0.85)] border-r border-[rgba(0,0,0,0.05)] text-gray-900";

  const backdropBlur = "backdrop-blur-[24px]";

  const toKey = (platform: Platform, id: string) => `${String(platform).toUpperCase()}:${id}`;

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
    () => follows.filter((f) => !inFolderKeys.has(toKey(f.platform, f.id))),
    [follows, inFolderKeys]
  );

  const folderMap = useMemo(() => {
    const map = new Map<string, typeof follows[number]>();
    follows.forEach((f) => map.set(`${f.platform}:${f.id}`, f));
    return map;
  }, [follows]);

  const hasFolderStreamers = folders.some((f) => (f.streamerIds || []).length > 0);
  const orderedAvailable = useMemo(() => {
    const availableMap = new Map<string, (typeof availableStreamers)[number]>();
    availableStreamers.forEach((s) => availableMap.set(toKey(s.platform, s.id), s));
    const ordered = listOrder
      .filter((item): item is Extract<typeof listOrder[number], { type: "streamer" }> => item.type === "streamer")
      .map((item) => availableMap.get(toKey(item.data.platform, item.data.id)))
      .filter((s): s is (typeof availableStreamers)[number] => Boolean(s));
    const leftover = availableStreamers.filter((s) => !ordered.includes(s));
    return [...ordered, ...leftover];
  }, [availableStreamers, listOrder]);
  const emptyState = orderedAvailable.length === 0 && !hasFolderStreamers;

  const startLongPress = (key: string) => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
    }
    longPressTimer.current = window.setTimeout(() => setDragReadyKey(key), 220);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
    }
    longPressTimer.current = null;
    setDragReadyKey(null);
  };

  const initiateDrag = (event: DragEvent<HTMLElement>, key: string, sourceFolder: string | null) => {
    // 允许长按后拖拽，也允许直接鼠标拖动
    if (dragReadyKey !== key) {
      setDragReadyKey(key);
    }
    console.log("[follow-list] drag start", { key, sourceFolder });
    setDraggingKey(key);
    setDragSourceFolder(sourceFolder);
    event.dataTransfer?.setData("text/plain", key);
    event.dataTransfer.effectAllowed = "move";
  };

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    const handleGlobalContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest("#follow-context-menu")) return;
      setContextMenu(null);
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("click", handleClick);
    window.addEventListener("contextmenu", handleGlobalContextMenu);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("contextmenu", handleGlobalContextMenu);
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(
    () => () => {
      cancelLongPress();
    },
    []
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  const refreshFollowStatus = useCallback(async () => {
    try {
      const resp = await fetch("/api/follow/status", { method: "GET" });
      const data = await resp.json();
      const list: Array<Partial<typeof follows[number]> & { platform: Platform; id: string }> =
        Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      list.forEach((item) => {
        if (!item.platform || !item.id) return;
        updateStreamerDetails({
          platform: item.platform,
          id: item.id,
          nickname: item.nickname,
          displayName: item.displayName,
          roomTitle: item.roomTitle,
          avatarUrl: item.avatarUrl,
          isLive: item.isLive,
        });
      });
      console.log("[follow-list] refreshed status", { count: list.length });
    } catch (error) {
      console.error("[follow-list] refresh status failed", error);
    }
  }, [updateStreamerDetails, follows]);

  useEffect(() => {
    void refreshFollowStatus();
    const timer = window.setInterval(() => void refreshFollowStatus(), 60000);
    return () => window.clearInterval(timer);
  }, [refreshFollowStatus]);

  const resetDragState = () => {
    setDraggingKey(null);
    setDragSourceFolder(null);
    setHoverFolderId(null);
    setHoverIndex(null);
    cancelLongPress();
  };

  const computeTargetIndex = (event: DragEvent<HTMLElement> | React.DragEvent<HTMLElement>, baseIndex: number) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    const before = offsetY < rect.height / 2;
    return before ? baseIndex : baseIndex + 1;
  };

  const handleRootDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!dragSourceFolder) return;
    event.preventDefault();
    const key = event.dataTransfer?.getData("text/plain") || draggingKey;
    if (!key) return;
    console.log("[follow-list] drop to root", { key, dragSourceFolder });
    removeFromFolder(key, dragSourceFolder);
    resetDragState();
    setHoverIndex(null);
  };

  const finalizeDrag = () => {
    if (!draggingKey) return;
    console.log("[follow-list] drag finalize", {
      draggingKey,
      hoverFolderId,
      hoverIndex,
      dragSourceFolder,
    });
    if (hoverFolderId && hoverFolderId !== dragSourceFolder) {
      moveToFolder(draggingKey, hoverFolderId);
    } else if (hoverIndex !== null && dragSourceFolder === null) {
      handleReorder(hoverIndex);
    } else if (dragSourceFolder && !hoverFolderId) {
      removeFromFolder(draggingKey, dragSourceFolder);
    }
    resetDragState();
  };

  const handleRenameFolder = (folderId: string) => {
    const target = folders.find((f) => f.id === folderId);
    if (!target) return;
    const name = window.prompt("重命名文件夹", target.name);
    if (name && name.trim()) {
      renameFolder(folderId, name.trim());
    }
    setContextMenu(null);
  };

  const persistReorder = (ordered: typeof availableStreamers) => {
    const keyQueue = ordered.map((s) => toKey(s.platform, s.id));
    const streamerMap = new Map<string, typeof follows[number]>();
    availableStreamers.forEach((s) => streamerMap.set(toKey(s.platform, s.id), s));

    const nextListOrder = listOrder
      .map((item) => {
        if (item.type === "folder") return item;
        const nextKey = keyQueue.shift();
        if (!nextKey) return null;
        const nextStreamer = streamerMap.get(nextKey);
        if (!nextStreamer) return null;
        return { type: "streamer" as const, data: nextStreamer };
      })
      .filter((v): v is FollowListItem => Boolean(v));

    keyQueue.forEach((key) => {
      const streamer = streamerMap.get(key);
      if (streamer) {
        nextListOrder.push({ type: "streamer", data: streamer });
      }
    });

    updateListOrder(nextListOrder);
  };

  const handleReorder = (targetIndex: number) => {
    if (!draggingKey || dragSourceFolder) return;
    const fromIndex = orderedAvailable.findIndex((s) => toKey(s.platform, s.id) === draggingKey);
    console.log("[follow-list] handleReorder", {
      draggingKey,
      fromIndex,
      targetIndex,
      orderedKeys: orderedAvailable.map((s) => toKey(s.platform, s.id)),
    });
    if (fromIndex === -1 || targetIndex === fromIndex || targetIndex === fromIndex + 1) return;
    let toIndex = targetIndex;
    if (fromIndex < toIndex) toIndex -= 1;
    const reordered = [...orderedAvailable];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    persistReorder(reordered);
    setHoverIndex(null);
  };

  const handleDeleteFolder = (folderId: string) => {
    const target = folders.find((f) => f.id === folderId);
    if (!target) return;
    const ok = window.confirm(`确认删除文件夹「${target.name}」？`);
    if (ok) {
      deleteFolder(folderId);
    }
    setContextMenu(null);
  };

  return (
    <div className={`w-full md:w-[240px] h-full flex flex-col relative z-40 ${glassClass} ${backdropBlur} transition-colors duration-300`}>
      <div
        className="flex-1 overflow-y-auto no-scrollbar px-3 pt-3 space-y-5 pb-10"
        onDragOver={(e) => {
          if (!dragSourceFolder) return;
          e.preventDefault();
        }}
        onDrop={handleRootDrop}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-gray-400 leading-tight">
              长按主播卡片拖拽，可重新排序或拖入自定义文件夹follow list
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => hydrate()}
                className="p-2 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 transition-colors text-xs"
                title="刷新"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  const name = window.prompt("新建自定义文件夹", "自定义文件夹");
                  if (name && name.trim()) {
                    createFolder(name.trim());
                  }
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold shadow-sm transition-colors",
                  isDark
                    ? "border-emerald-200/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
                    : "border-emerald-500/50 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                )}
                title="新建自定义文件夹"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">自定义文件夹</span>
              </button>
            </div>
          </div>
          {dragSourceFolder && (
            <div
              className={`text-[11px] text-center px-3 py-2 rounded-lg border border-dashed transition-colors ${
                isDark
                  ? "border-emerald-300/50 text-emerald-200 bg-emerald-500/5"
                  : "border-emerald-500/40 text-emerald-700 bg-emerald-50"
              }`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.stopPropagation();
                handleRootDrop(e);
              }}
              onPointerUp={(e) => {
                if (!dragSourceFolder) return;
                e.preventDefault();
                handleRootDrop(e as unknown as DragEvent<HTMLDivElement>);
              }}
            >
              将主播拖到此处即可移出文件夹
            </div>
          )}
          {folders.length > 0 && (
            <div className="space-y-2.5">
              {folders.map((folder) => {
                const items = (folder.streamerIds || [])
                  .map((id) => folderMap.get(id))
                  .filter((v): v is typeof follows[number] => Boolean(v));
                const expanded = folder.expanded ?? true;
                const hovering = hoverFolderId === folder.id;
                return (
                  <motion.div
                    key={folder.id}
                    layout
                    initial={false}
                    className={`relative overflow-hidden rounded-xl border p-3 transition-colors ${
                      isDark ? "border-white/10 bg-white/5" : "border-black/10 bg-white"
                    }`}
                    animate={{
                      scale: hovering ? 1.015 : 1,
                      borderColor: hovering
                        ? isDark
                          ? "rgba(52,211,153,0.75)"
                          : "rgba(16,185,129,0.9)"
                        : undefined,
                      backgroundColor: hovering
                        ? isDark
                          ? "rgba(16,185,129,0.08)"
                          : "rgba(16,185,129,0.08)"
                        : undefined,
                      boxShadow: hovering
                        ? isDark
                          ? "0 16px 60px -24px rgba(16,185,129,0.65)"
                          : "0 16px 60px -24px rgba(16,185,129,0.55)"
                        : "none",
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({ folderId: folder.id, x: e.clientX, y: e.clientY });
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                      setHoverFolderId(folder.id);
                    }}
                    onPointerEnter={() => {
                      if (!draggingKey) return;
                      setHoverFolderId(folder.id);
                    }}
                    onDragEnter={() => setHoverFolderId(folder.id)}
                    onDragLeave={() => setHoverFolderId((prev) => (prev === folder.id ? null : prev))}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const key = e.dataTransfer?.getData("text/plain") || draggingKey;
                      if (!key) return;
                      if (dragSourceFolder === folder.id) {
                        resetDragState();
                        return;
                      }
                      moveToFolder(key, folder.id);
                      resetDragState();
                    }}
                    onPointerUp={(e) => {
                      if (!draggingKey) return;
                      e.preventDefault();
                      if (hoverFolderId && hoverFolderId !== dragSourceFolder) {
                        moveToFolder(draggingKey, hoverFolderId);
                      }
                      resetDragState();
                    }}
                  >
                    <AnimatePresence>
                      {hovering && draggingKey ? (
                        <motion.div
                          key={`${folder.id}-glow`}
                          layoutId="folder-hover-glow"
                          className="absolute inset-0 pointer-events-none rounded-[14px]"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ type: "spring", stiffness: 280, damping: 32 }}
                          style={{
                            background:
                              "radial-gradient(circle at 16% 10%, rgba(16,185,129,0.12), transparent 35%), rgba(16,185,129,0.08)",
                            boxShadow: isDark
                              ? "0 20px 80px -40px rgba(16,185,129,0.65)"
                              : "0 20px 80px -40px rgba(16,185,129,0.55)",
                          }}
                        />
                      ) : null}
                    </AnimatePresence>
                    <div className="relative z-[1] flex items-center justify-between mb-2">
                      <button
                        type="button"
                        onClick={() => toggleFolderExpanded(folder.id)}
                        className="inline-flex items-center gap-2 text-sm font-semibold"
                      >
                        <motion.span
                          animate={{ rotate: expanded ? 0 : -90 }}
                          transition={{ duration: 0.2, ease: [0.25, 0.8, 0.4, 1] }}
                          className="inline-flex"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </motion.span>
                        <span className="truncate max-w-[120px]" title={folder.name}>
                          {folder.name}
                        </span>
                        <span className="text-[11px] text-gray-400">({items.length})</span>
                      </button>
                      <div className="text-[11px] text-gray-400">{dragSourceFolder ? "拖放即可移动" : "右键管理"}</div>
                    </div>
                    <AnimatePresence initial={false}>
                      {expanded ? (
                        <motion.div
                          key={`${folder.id}-items`}
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                          className="relative z-[1] space-y-1.5 overflow-hidden"
                        >
                          {items.length === 0 ? (
                            <div className="text-[12px] text-gray-400 px-1 py-1.5">暂无主播，拖动加入</div>
                          ) : (
                            items.map((item) => {
                              const key = toKey(item.platform, item.id);
                              return (
                                <div
                                  key={`${item.platform}-${item.id}`}
                                  className={`flex items-center justify-between py-1.5 px-2 rounded-lg ${
                                    isDark ? "bg-white/5" : "bg-black/5"
                                  }`}
                                  draggable
                                  onPointerDown={() => startLongPress(key)}
                                  onPointerUp={cancelLongPress}
                                  onPointerLeave={(e) => {
                                    if (e.buttons === 0) cancelLongPress();
                                  }}
                                  onDragStart={(e) => initiateDrag(e, key, folder.id)}
                                  onDragEnd={finalizeDrag}
                                >
                                  <div className="flex items-center gap-2">
                                    <Image
                                      src={normalizeAvatarUrl(item.platform, item.avatarUrl) || ""}
                                      alt={item.nickname}
                                      width={32}
                                      height={32}
                                      className="rounded-full object-cover w-8 h-8 border border-white/10"
                                    />
                                    <div className="flex flex-col">
                                      <span
                                        className={`text-[13px] font-semibold line-clamp-1 ${isDark ? "text-white" : "text-gray-900"}`}
                                        title={item.nickname || item.displayName}
                                      >
                                        {item.nickname || item.displayName}
                                      </span>
                                      <span
                                        className="text-[11px] text-gray-400 line-clamp-2"
                                        title={item.roomTitle || platformLabelMap[item.platform]}
                                      >
                                        {item.roomTitle || platformLabelMap[item.platform]}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      className="text-[11px] px-3 py-1 rounded-full border border-white/20 hover:bg-white/10"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openPlayer({
                                          platform: item.platform,
                                          roomId: item.id,
                                          title: item.roomTitle,
                                          anchorName: item.nickname,
                                          avatar: item.avatarUrl,
                                        });
                                      }}
                                    >
                                      播放
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {emptyState ? (
          <div className="mt-10 text-center text-sm text-gray-400">
            <p>暂无关注主播</p>
            <p className="text-xs mt-1 text-gray-500">在首页关注后会出现在这里</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {orderedAvailable.map((item, index) => {
              const key = toKey(item.platform, item.id);
              const isHover = hoverIndex === index;
              const isDragging = draggingKey === key;
              return (
                <div key={key} className="flex flex-col">
              <motion.div
                layout
                className="rounded-full"
                animate={{
                  height: isHover ? 12 : 8,
                  backgroundColor: isHover ? "rgba(16,185,129,0.45)" : "rgba(0,0,0,0)",
                  opacity: isHover ? 1 : 0.5,
                }}
                onDragOver={(e) => {
                  if (!draggingKey || dragSourceFolder) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setHoverIndex(computeTargetIndex(e, index));
                }}
                onPointerEnter={() => {
                  if (!draggingKey || dragSourceFolder) return;
                  setHoverIndex(index);
                }}
                onDragLeave={() => setHoverIndex((prev) => (prev === index ? null : prev))}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleReorder(computeTargetIndex(e, index));
                }}
                onPointerUp={(e) => {
                  if (!draggingKey) return;
                  e.preventDefault();
                  finalizeDrag();
                }}
              />
                  <div
                className={cn(
                  "flex items-center justify-between py-2.5 group rounded-lg px-3 transition-colors cursor-pointer",
                  isDark ? "hover:bg-white/5" : "hover:bg-black/5",
                  isHover ? "ring-1 ring-emerald-400/60" : "",
                  isDragging ? "opacity-80" : ""
                )}
                onClick={(e) => {
                  if (draggingKey || dragReadyKey === key) {
                    e.preventDefault();
                    return;
                  }
                  openPlayer({
                    platform: item.platform,
                    roomId: item.id,
                    title: item.roomTitle,
                    anchorName: item.nickname,
                    avatar: normalizeAvatarUrl(item.platform, item.avatarUrl),
                  });
                }}
                draggable
                onPointerDown={() => startLongPress(key)}
                onPointerUp={(e) => {
                  if (draggingKey) {
                    e.preventDefault();
                    finalizeDrag();
                    return;
                  }
                  cancelLongPress();
                }}
                onPointerLeave={(e) => {
                  if (e.buttons === 0) cancelLongPress();
                }}
                onDragStart={(e) => initiateDrag(e, key, null)}
                onDragEnd={finalizeDrag}
              >
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        {normalizeAvatarUrl(item.platform, item.avatarUrl) ? (
                          <Image
                            src={normalizeAvatarUrl(item.platform, item.avatarUrl) || ""}
                            alt={item.nickname}
                            width={40}
                            height={40}
                            sizes="40px"
                            className={`w-10 h-10 rounded-full object-cover border ${isDark ? "border-white/10" : "border-black/5"}`}
                          />
                        ) : (
                          <div
                            className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold uppercase ${
                              isDark ? "bg-white/10 text-white" : "bg-black/5 text-gray-800"
                            }`}
                          >
                            {item.nickname?.slice(0, 1) || "?"}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col">
                        <span
                          className={`text-[15px] font-semibold leading-tight ${isDark ? "text-white" : "text-gray-900"} line-clamp-1`}
                          title={item.nickname || item.displayName}
                        >
                          {item.nickname || item.displayName}
                        </span>
                        <span
                          className={`text-xs leading-tight ${isDark ? "text-gray-500" : "text-gray-500"} line-clamp-2`}
                          title={item.roomTitle || item.nickname || item.displayName}
                        >
                          {item.roomTitle || item.displayName || item.nickname}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {orderedAvailable.length > 0 ? (
              <motion.div
                layout
                className="rounded-full"
                animate={{
                  height: hoverIndex === orderedAvailable.length ? 12 : 8,
                  backgroundColor: hoverIndex === orderedAvailable.length ? "rgba(16,185,129,0.45)" : "rgba(0,0,0,0)",
                  opacity: hoverIndex === orderedAvailable.length ? 1 : 0.5,
                }}
                onDragOver={(e) => {
                  if (!draggingKey || dragSourceFolder) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setHoverIndex(computeTargetIndex(e, orderedAvailable.length - 1));
                }}
                onPointerEnter={() => {
                  if (!draggingKey || dragSourceFolder) return;
                  setHoverIndex(orderedAvailable.length);
                }}
                onDragLeave={() => setHoverIndex((prev) => (prev === orderedAvailable.length ? null : prev))}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleReorder(computeTargetIndex(e, orderedAvailable.length - 1));
                }}
                onDragEnd={finalizeDrag}
                onPointerUp={(e) => {
                  if (!draggingKey) return;
                  e.preventDefault();
                  finalizeDrag();
                }}
              />
            ) : null}
          </div>
        )}

        {mounted && contextMenu
          ? createPortal(
              <div
                id="follow-context-menu"
                className={`fixed min-w-[140px] rounded-lg border text-sm shadow-2xl overflow-hidden ${
                  isDark
                    ? "border-white/10 bg-[rgba(20,20,20,0.95)] text-white"
                    : "border-black/10 bg-white text-gray-900"
                }`}
                style={{ top: contextMenu.y, left: contextMenu.x, zIndex: 9999 }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className={`w-full text-left px-3 py-2 ${
                    isDark ? "hover:bg-white/10" : "hover:bg-black/5"
                  }`}
                  onClick={() => handleRenameFolder(contextMenu.folderId)}
                >
                  重命名
                </button>
                <button
                  className={`w-full text-left px-3 py-2 text-red-300 ${
                    isDark ? "hover:bg-red-500/10" : "hover:bg-red-100"
                  }`}
                  onClick={() => handleDeleteFolder(contextMenu.folderId)}
                >
                  删除
                </button>
              </div>,
              document.body
            )
          : null}
      </div>
    </div>
  );
}
