"use client";

import { Plus, RefreshCw } from "lucide-react";
import Image from "next/image";
import { ThemeMode } from "@/types/follow-list";
import { Platform } from "@/types/platform";
import { type FollowListItem, useFollowStore } from "@/stores/follow-store";
import { type DragEvent, useEffect, useMemo, useState } from "react";
import { cn } from "@/utils/cn";
import { platformLabelMap } from "@/utils/platform";
import { SearchPanel } from "@/components/search/search-panel";
import { usePlayerOverlayStore } from "@/stores/player-overlay-store";

type FollowListProps = {
  theme: ThemeMode;
  searchPlatform: Platform;
};

export function FollowList({ theme, searchPlatform }: FollowListProps) {
  const isDark = theme === "dark";
  const follows = useFollowStore((s) => s.followedStreamers);
  const folders = useFollowStore((s) => s.folders);
  const createFolder = useFollowStore((s) => s.createFolder);
  const renameFolder = useFollowStore((s) => s.renameFolder);
  const hydrate = useFollowStore((s) => s.hydrateFromLegacy);
  const moveToFolder = useFollowStore((s) => s.moveStreamerToFolder);
  const removeFromFolder = useFollowStore((s) => s.removeStreamerFromFolder);
  const deleteFolder = useFollowStore((s) => s.deleteFolder);
  const listOrder = useFollowStore((s) => s.listOrder);
  const updateListOrder = useFollowStore((s) => s.updateListOrder);
  const openPlayer = usePlayerOverlayStore((s) => s.open);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragSourceFolder, setDragSourceFolder] = useState<string | null>(null);
  const [hoverFolderId, setHoverFolderId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ folderId: string; x: number; y: number } | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
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

  const resetDragState = () => {
    setDraggingKey(null);
    setDragSourceFolder(null);
    setHoverFolderId(null);
  };

  const handleRootDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!dragSourceFolder) return;
    event.preventDefault();
    const key = event.dataTransfer?.getData("text/plain") || draggingKey;
    if (!key) return;
    removeFromFolder(key, dragSourceFolder);
    resetDragState();
    setHoverIndex(null);
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
    if (fromIndex === -1) return;
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
    <div className={`w-[280px] h-full flex flex-col relative z-40 ${glassClass} ${backdropBlur} transition-colors duration-300`}>
      <div className="px-5 pb-4 pt-4">
        <SearchPanel platform={searchPlatform} />
      </div>

      <div
        className="flex-1 overflow-y-auto no-scrollbar px-2.5 pt-2 space-y-8 pb-20"
        onDragOver={(e) => {
          if (!dragSourceFolder) return;
          e.preventDefault();
        }}
        onDrop={handleRootDrop}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => hydrate()}
              className="p-2 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 transition-colors text-xs"
              title="刷新"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => createFolder("新建文件夹")}
              className="p-2 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 transition-colors text-xs"
              title="新建文件夹"
            >
              <Plus className="w-4 h-4" />
            </button>
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
            >
              将主播拖到此处即可移出文件夹
            </div>
          )}
          {folders.length > 0 && (
            <div className="space-y-3">
              {folders.map((folder) => {
                const items = (folder.streamerIds || [])
                  .map((id) => folderMap.get(id))
                  .filter((v): v is typeof follows[number] => Boolean(v));
                return (
                  <div
                    key={folder.id}
                    className={`rounded-xl border p-3 transition-colors ${
                      hoverFolderId === folder.id
                        ? "border-emerald-400/60 bg-emerald-400/5"
                        : isDark
                          ? "border-white/10 bg-white/5"
                          : "border-black/10 bg-white"
                    }`}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({ folderId: folder.id, x: e.clientX, y: e.clientY });
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setHoverFolderId(folder.id);
                    }}
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
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold">{folder.name}</div>
                      <div className="text-[11px] text-gray-400">{dragSourceFolder ? "拖放即可移动" : "右键管理"}</div>
                    </div>
                    {items.length === 0 ? null : (
                      <div className="space-y-2">
                        {items.map((item) => (
                          <div
                            key={`${item.platform}-${item.id}`}
                            className={`flex items-center justify-between py-2 px-2 rounded-lg ${
                              isDark ? "bg-white/5" : "bg-black/5"
                            }`}
                            draggable
                            onDragStart={(e) => {
                              setDraggingKey(toKey(item.platform, item.id));
                              setDragSourceFolder(folder.id);
                              e.dataTransfer?.setData("text/plain", toKey(item.platform, item.id));
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={resetDragState}
                          >
                            <div className="flex items-center gap-2">
                              <Image
                                src={item.avatarUrl || ""}
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
                        ))}
                      </div>
                    )}
                  </div>
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
          <div className="flex flex-col gap-2">
            {orderedAvailable.map((item, index) => {
              const key = toKey(item.platform, item.id);
              const isHover = hoverIndex === index;
              return (
                <div key={key} className="flex flex-col">
                  <div
                    className={`h-2 transition-colors ${isHover ? "bg-emerald-400/50" : "bg-transparent"}`}
                    onDragOver={(e) => {
                      if (!draggingKey || dragSourceFolder) return;
                      e.preventDefault();
                      setHoverIndex(index);
                    }}
                    onDragLeave={() => setHoverIndex((prev) => (prev === index ? null : prev))}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleReorder(index);
                    }}
                  />
                  <div
                    className={cn(
                      "flex items-center justify-between py-3 group rounded-lg px-3 transition-colors",
                      isDark ? "hover:bg-white/5" : "hover:bg-black/5",
                      isHover ? "ring-1 ring-emerald-400/60" : ""
                    )}
                    onClick={() => {
                      openPlayer({
                        platform: item.platform,
                        roomId: item.id,
                        title: item.roomTitle,
                        anchorName: item.nickname,
                        avatar: item.avatarUrl,
                      });
                    }}
                    draggable
                    onDragStart={(e) => {
                      setDraggingKey(key);
                      setDragSourceFolder(null);
                      e.dataTransfer?.setData("text/plain", key);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      resetDragState();
                      setHoverIndex(null);
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        {item.avatarUrl ? (
                          <Image
                            src={item.avatarUrl}
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
              <div
                className="h-2 transition-colors"
                onDragOver={(e) => {
                  if (!draggingKey || dragSourceFolder) return;
                  e.preventDefault();
                  setHoverIndex(orderedAvailable.length);
                }}
                onDragLeave={() => setHoverIndex((prev) => (prev === orderedAvailable.length ? null : prev))}
                onDrop={(e) => {
                  e.preventDefault();
                  handleReorder(orderedAvailable.length);
                }}
              />
            ) : null}
          </div>
        )}

        {contextMenu && (
          <div
            id="follow-context-menu"
            className={`fixed z-[100] min-w-[140px] rounded-lg border text-sm shadow-2xl overflow-hidden ${
              isDark
                ? "border-white/10 bg-[rgba(20,20,20,0.95)] text-white"
                : "border-black/10 bg-white text-gray-900"
            }`}
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className={`w-full text-left px-3 py-2 ${isDark ? "hover:bg-white/10" : "hover:bg-black/5"}`}
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
          </div>
        )}
      </div>
    </div>
  );
}
