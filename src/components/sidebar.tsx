"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, PanelLeftClose, PanelLeftOpen, Plus, ChevronDown } from "lucide-react";
import { ThemeMode } from "@/types/follow-list";
import { useFollowStore } from "@/stores/follow-store";
import { usePlayerOverlayStore } from "@/stores/player-overlay-store";
import { platformLabelMap } from "@/utils/platform";
import { useSidebarStore } from "@/stores/sidebar-store";
import { Reorder } from "framer-motion";
import Image from "next/image";
import { createPortal } from "react-dom";

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
  const toggleSidebar = useSidebarStore((s) => s.toggle);
  const toKey = (platform: string, id: string) => `${String(platform).toUpperCase()}:${id}`;
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [hoverFolderId, setHoverFolderId] = useState<string | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ id: string; x: number; y: number; renameDraft?: string } | null>(
    null
  );
  const [mounted, setMounted] = useState(false);
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

  const collapsedItems = useMemo(() => {
    if (listOrder.length) return listOrder;
    return orderedFollows.map((s) => ({ type: "streamer", data: s })) as typeof listOrder;
  }, [listOrder, orderedFollows]);

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
    const availableMap = new Map<string, (typeof availableStreamers)[number]>();
    availableStreamers.forEach((s) => availableMap.set(toKey(s.platform, s.id), s));
    const ordered = listOrder
      .filter((item): item is Extract<typeof listOrder[number], { type: "streamer" }> => item.type === "streamer")
      .map((item) => availableMap.get(toKey(item.data.platform, item.data.id)))
      .filter((s): s is (typeof availableStreamers)[number] => Boolean(s));
    const leftover = availableStreamers.filter((s) => !ordered.includes(s));
    return [...ordered, ...leftover];
  }, [availableStreamers, listOrder]);

  const orderedIds = useMemo(() => orderedAvailable.map((s) => toKey(s.platform, s.id)), [orderedAvailable]);

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

  const statusDot = (live?: boolean) => (
    <span
      className={`absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full border ${
        isDark ? "border-slate-900" : "border-white"
      } ${live ? "bg-emerald-400" : "bg-gray-500/70"}`}
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
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", handleEsc);
    };
  }, [hydrate]);

  return (
    <aside
      className={`flex flex-col items-center py-4 w-full max-w-[240px] h-full border-r backdrop-blur-xl transition-all duration-300 overflow-y-auto no-scrollbar ${containerClass} ${className}`}
    >
      <div className={`w-full flex flex-col ${isLeaderboardOpen ? "items-start" : "items-center"} gap-4 px-3`}>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleSidebar}
            className={`w-11 h-11 inline-flex items-center justify-center rounded-2xl border transition-colors ${
              isDark ? "border-white/10 bg-white/5 hover:bg-white/10" : "border-gray-200 bg-white hover:bg-gray-100"
            }`}
            title={isLeaderboardOpen ? "Collapse follows" : "Expand follows"}
          >
            {isLeaderboardOpen ? (
              <PanelLeftClose className={`w-5 h-5 ${isDark ? "text-white" : "text-gray-900"}`} />
            ) : (
              <PanelLeftOpen className={`w-5 h-5 ${isDark ? "text-white" : "text-gray-900"}`} />
            )}
          </button>
          {isLeaderboardOpen ? (
            <>
              <button
                type="button"
                onClick={() => hydrate()}
                className={`w-11 h-11 inline-flex items-center justify-center rounded-2xl border transition-colors ${
                  isDark ? "border-white/10 bg-white/5 hover:bg-white/10" : "border-gray-200 bg-white hover:bg-gray-100"
                }`}
                title="Refresh follows"
              >
                <RefreshCw className={`w-5 h-5 ${isDark ? "text-white" : "text-gray-900"}`} />
              </button>
              <button
                type="button"
                onClick={handleCreateFolder}
                className={`w-11 h-11 inline-flex items-center justify-center rounded-2xl border transition-colors ${
                  isDark ? "border-white/10 bg-white/5 hover:bg-white/10" : "border-gray-200 bg-white hover:bg-gray-100"
                }`}
                title="New folder"
              >
                <Plus className={`w-5 h-5 ${isDark ? "text-white" : "text-gray-900"}`} />
              </button>
            </>
          ) : null}
        </div>

        {!isLeaderboardOpen && (orderedFollows.length > 0 || folders.length > 0) ? (
          <div className="flex flex-col items-center gap-3 mt-1 w-full px-2">
            {collapsedItems.map((item) => {
              if (item.type === "streamer") {
                const s = orderedFollows.find((f) => f.platform === item.data.platform && f.id === item.data.id);
                if (!s) return null;
                return (
                  <button
                    key={`${s.platform}:${s.id}`}
                    type="button"
                    onClick={() =>
                      openPlayer({
                        platform: s.platform,
                        roomId: s.id,
                        title: s.roomTitle,
                        anchorName: s.nickname,
                        avatar: s.avatarUrl,
                      })
                    }
                    className={`relative w-10 h-10 rounded-full border shadow-sm transition-all duration-200 ${
                      isDark
                        ? "border-white/10 hover:border-white/25 hover:scale-105"
                        : "border-gray-200 hover:border-gray-300 hover:scale-105"
                    }`}
                    title={s.nickname || s.displayName || s.id}
                  >
                    {s.avatarUrl ? (
                      <Image
                        src={s.avatarUrl}
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
              const label = (folder.name || "F").slice(0, 1);
              return (
                <div
                  key={`folder-${folder.id}`}
                  className={`px-3 h-10 rounded-2xl border shadow-sm flex items-center justify-center text-xs font-semibold uppercase transition-all duration-200 ${
                    isDark
                      ? "border-white/10 bg-white/10 text-white hover:border-white/25"
                      : "border-gray-200 bg-gray-50 text-gray-800 hover:border-gray-300"
                  }`}
                  title={folder.name}
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
          <div className="w-full">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-[0.08em] text-gray-400">Folders</div>
              <button
                type="button"
                onClick={handleCreateFolder}
                className={`text-[11px] font-semibold px-2 py-1 rounded-lg border transition-colors ${
                  isDark ? "border-white/10 text-white hover:bg-white/10" : "border-gray-200 text-gray-800 hover:bg-gray-100"
                }`}
              >
                新建
              </button>
            </div>
            {folders.length > 0 ? (
              <div className="flex flex-col gap-2">
                {folders.map((folder) => {
                  const items = (folder.streamerIds || []).map((id) => {
                    const [p, i] = (id || "").split(":");
                    return followedStreamers.find(
                      (s) => String(s.platform).toUpperCase() === String(p || "").toUpperCase() && s.id === i
                    );
                  }).filter((v): v is (typeof followedStreamers)[number] => Boolean(v));
                  const expanded = folder.expanded ?? true;
                  const isHover = hoverFolderId === folder.id;
                  return (
                    <div
                      key={`folder-${folder.id}`}
                      data-folder-drop
                      data-folder-id={folder.id}
                      className={`w-full rounded-xl border text-xs font-medium transition-all duration-150 ${
                        isDark
                          ? "border-white/10 bg-white/5 text-white"
                          : "border-gray-200 bg-gray-50 text-gray-800"
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
                        <ChevronDown
                          className={`w-4 h-4 transition-transform ${expanded ? "rotate-0" : "-rotate-90"}`}
                        />
                        <span className="truncate max-w-[120px] flex-1 text-left">{folder.name}</span>
                        <span className="text-[11px] text-gray-400">{folder.streamerIds?.length || 0}</span>
                      </button>
                      {expanded ? (
                        <div className="px-3 pb-2 space-y-1.5">
                          {items.length === 0 ? (
                            <div className="text-[11px] text-gray-400">暂无主播，拖动加入</div>
                          ) : (
                            items.map((item) => (
                              <button
                                key={`${item.platform}:${item.id}`}
                                type="button"
                                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${
                                  isDark ? "hover:bg-white/10" : "hover:bg-black/5"
                                }`}
                                onClick={() =>
                                  openPlayer({
                                    platform: item.platform,
                                    roomId: item.id,
                                    title: item.roomTitle,
                                    anchorName: item.nickname,
                                    avatar: item.avatarUrl,
                                  })
                                }
                              >
                                <div className="relative flex-shrink-0">
                                  {item.avatarUrl ? (
                                    <Image
                                      src={item.avatarUrl}
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
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-gray-400 px-1 py-1.5">尚未创建文件夹</div>
            )}
          </div>
          {orderedIds.length > 0 && reorderValues.length > 0 ? (
            <Reorder.Group axis="y" values={reorderValues} onReorder={handleReorderList} className="space-y-1">
              {reorderItems.map((item) => {
                const itemKey = item.key;
                const data = item.data;
                return (
                  <Reorder.Item
                    key={itemKey}
                    value={itemKey}
                    dragListener
                    as="div"
                    layout
                    transition={{ type: "spring", stiffness: 320, damping: 28, mass: 0.9 }}
                    whileDrag={{ scale: 0.98, opacity: 0.9 }}
                    className="flex"
                    onDragStart={(e) => {
                      setDraggingKey(itemKey);
                      setHoverFolderId(null);
                      const hit = getHoverFolderId(e.clientX, e.clientY);
                      if (hit) setHoverFolderId(hit);
                    }}
                    onDrag={(e) => {
                      const hit = getHoverFolderId(e.clientX, e.clientY);
                      setHoverFolderId(hit);
                    }}
                    onDragEnd={(e) => {
                      const hit = getHoverFolderId(e.clientX, e.clientY) || hoverFolderId;
                      if (hit) {
                        moveToFolder(itemKey, hit);
                      }
                      setDraggingKey(null);
                      setHoverFolderId(null);
                    }}
                  >
                    <button
                      draggable
                      onDragStart={(e) => {
                        setDraggingKey(itemKey);
                        e.dataTransfer?.setData("text/plain", itemKey);
                      }}
                      onDragEnd={() => {
                        setDraggingKey(null);
                        setHoverFolderId(null);
                      }}
                      onClick={() =>
                        openPlayer({
                          platform: data.platform,
                          roomId: data.id,
                          title: data.roomTitle,
                          anchorName: data.nickname,
                          avatar: data.avatarUrl,
                        })
                      }
                      className={`group w-full flex items-center gap-2 p-1.5 rounded-xl transition-all ${
                        isDark ? "hover:bg-white/10" : "hover:bg-black/5"
                      }`}
                    >
                      <div className="relative flex-shrink-0">
                        {data.avatarUrl ? (
                          <Image
                            src={data.avatarUrl}
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
    </aside>
  );
}
