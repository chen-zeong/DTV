"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, m, useMotionValue, useSpring } from "framer-motion";
import { Check, ChevronDown, Folder, FolderPlus, ListCollapse, RotateCw, UsersRound, X } from "lucide-react";
import { createPortal } from "react-dom";

import styles from "./FollowsList.module.css";
import { Platform as PlatformEnum } from "@/platforms/common/types";
import { useFollow, type FollowListItem, type FollowedStreamer, type Platform as FollowPlatform } from "@/state/follow/FollowProvider";
import { useImageProxy } from "@/hooks/useImageProxy";
import { usePlayerOverlay } from "@/state/playerOverlay/PlayerOverlayProvider";

const FOLLOW_REFRESH_CONCURRENCY = 2;
const REFRESH_INITIAL_DELAY_MS = 1500;
const DRAG_PREP_DELAY_MS = 150;
const DRAG_MIN_PX = 8;

function normalizeFollowKey(key: string) {
  const [p, id] = String(key || "").split(":");
  return `${String(p || "").toUpperCase()}:${String(id || "")}`;
}

function normalizeLiveStatus(isLive: boolean | null | undefined): FollowedStreamer["liveStatus"] {
  if (isLive === true) return "LIVE";
  if (isLive === false) return "OFFLINE";
  return "UNKNOWN";
}

async function refreshOne(streamer: FollowedStreamer) {
  if (streamer.platform === "DOUYU") {
    const info = await invoke<any>("fetch_douyu_room_info", { roomId: streamer.id });
    const showStatus = typeof info?.show_status === "number" ? info.show_status : Number(info?.show_status ?? 0);
    const rawVideoLoop = info?.video_loop ?? info?.videoLoop ?? null;
    const videoLoop =
      typeof rawVideoLoop === "number" ? rawVideoLoop : rawVideoLoop === null || typeof rawVideoLoop === "undefined" ? null : Number(rawVideoLoop);

    // Douyu: show_status === 1 需要结合 video_loop 判断；未知值一律不展示“在线”以避免误判
    let liveStatus: FollowedStreamer["liveStatus"] = "OFFLINE";
    if (showStatus === 1) {
      if (videoLoop === 0) liveStatus = "LIVE";
      else if (videoLoop === 1) liveStatus = "OFFLINE";
      else liveStatus = "UNKNOWN";
    }
    return {
      nickname: info?.nickname ?? streamer.nickname,
      avatarUrl: info?.avatar_url ?? streamer.avatarUrl,
      roomTitle: info?.room_name ?? info?.roomName ?? streamer.roomTitle,
      liveStatus
    } satisfies Partial<FollowedStreamer>;
  }

  if (streamer.platform === "HUYA") {
    try {
      const info = await invoke<any>("get_huya_unified_cmd", { roomId: streamer.id, quality: null, line: null });
      return {
        nickname: info?.nick ?? streamer.nickname,
        avatarUrl: info?.avatar ?? streamer.avatarUrl,
        roomTitle: info?.title ?? streamer.roomTitle,
        liveStatus: normalizeLiveStatus(!!info?.is_live)
      } satisfies Partial<FollowedStreamer>;
    } catch (e: any) {
      const msg = typeof e === "string" ? e : e?.message || "";
      if (msg.includes("主播未开播或获取虎牙房间详情失败")) {
        return { liveStatus: "OFFLINE" } satisfies Partial<FollowedStreamer>;
      }
      throw e;
    }
  }

  if (streamer.platform === "BILIBILI") {
    const payload = { platform: PlatformEnum.BILIBILI, args: { room_id_str: streamer.id } };
    const cookie = typeof localStorage !== "undefined" ? localStorage.getItem("bilibili_cookie") || null : null;
    const info = await invoke<any>("fetch_bilibili_streamer_info", { payload, cookie });
    const live = Number(info?.status ?? 0) === 1;
    return {
      nickname: info?.anchor_name ?? streamer.nickname,
      avatarUrl: info?.avatar ?? streamer.avatarUrl,
      roomTitle: info?.title ?? streamer.roomTitle,
      liveStatus: normalizeLiveStatus(live)
    } satisfies Partial<FollowedStreamer>;
  }

  if (streamer.platform === "DOUYIN") {
    const payload = { platform: PlatformEnum.DOUYIN, args: { room_id_str: streamer.id } };
    const info = await invoke<any>("fetch_douyin_streamer_info", { payload });
    const status = Number(info?.status ?? 0);
    // Douyin: status === 2 means live (align with player/follow helpers)
    const live = status === 2;
    return {
      nickname: info?.anchor_name ?? streamer.nickname,
      avatarUrl: info?.avatar ?? streamer.avatarUrl,
      roomTitle: info?.title ?? streamer.roomTitle,
      liveStatus: normalizeLiveStatus(live)
    } satisfies Partial<FollowedStreamer>;
  }

  return {} satisfies Partial<FollowedStreamer>;
}

export function FollowsList() {
  const pathname = usePathname();
  const follow = useFollow();
  const { ensureProxyStarted, getAvatarSrc } = useImageProxy();
  const playerOverlay = usePlayerOverlay();

  const listRef = useRef<HTMLDivElement | null>(null);
  const streamersListRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const expandBtnRef = useRef<HTMLButtonElement | null>(null);

  const hoverOpacity = useMotionValue(0);
  const hoverYRaw = useMotionValue(0);
  const hoverHRaw = useMotionValue(38);
  const hoverY = useSpring(hoverYRaw, { stiffness: 520, damping: 44, mass: 0.7 });
  const hoverH = useSpring(hoverHRaw, { stiffness: 520, damping: 44, mass: 0.7 });

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [showCheckIcon, setShowCheckIcon] = useState(false);

  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayAlignLeft, setOverlayAlignLeft] = useState(240);
  const [overlayDeleteMode, setOverlayDeleteMode] = useState(false);
  const [overlayFilter, setOverlayFilter] = useState<"ALL" | FollowPlatform>("ALL");
  const overlayAnchorCenterXRef = useRef<number | null>(null);
  const overlayPanelRef = useRef<HTMLDivElement | null>(null);

  const [folderNameModal, setFolderNameModal] = useState<{ open: boolean; mode: "create" | "rename"; folderId: string | null }>({ open: false, mode: "create", folderId: null });
  const [folderNameInput, setFolderNameInput] = useState("");
  const [folderMenu, setFolderMenu] = useState<{ open: boolean; x: number; y: number; folderId: string | null }>({ open: false, x: 0, y: 0, folderId: null });
  const [folderDeleteConfirm, setFolderDeleteConfirm] = useState<{ open: boolean; folderId: string | null }>({ open: false, folderId: null });
  const portalTarget = typeof document !== "undefined" ? document.body : null;

  const listItems: FollowListItem[] = follow.listOrder;
  const allStreamers = follow.followedStreamers;
  const listItemsRef = useRef(listItems);
  const foldersRef = useRef(follow.folders);

  useEffect(() => {
    listItemsRef.current = listItems;
    foldersRef.current = follow.folders;
  }, [listItems, follow.folders]);

  useEffect(() => {
    if (allStreamers.some((s) => (s.platform === "BILIBILI" || s.platform === "HUYA") && !!s.avatarUrl)) {
      void ensureProxyStarted();
    }
  }, [allStreamers, ensureProxyStarted]);

  // 仅在“本次启动首次进入软件”时：延迟 + idle 自动刷新一次；后续只能手动刷新
  useEffect(() => {
    if (!follow.hydrated) return;
    if (allStreamers.length === 0) return;
    // 等待关注数据就绪后再消耗一次性标记，避免 hydrated 先到导致错过自动刷新
    if (!follow.consumeInitialAutoRefresh()) return;
    const hasBiliOrHuya = allStreamers.some((s) => s.platform === "BILIBILI" || s.platform === "HUYA");

    let cancelled = false;
    const requestIdle = (cb: () => void, timeout = REFRESH_INITIAL_DELAY_MS) => {
      const ric = (window as any).requestIdleCallback as ((fn: () => void, opts?: { timeout?: number }) => number) | undefined;
      if (typeof ric === "function") {
        const id = ric(() => cb(), { timeout });
        return () => (window as any).cancelIdleCallback?.(id);
      }
      const t = window.setTimeout(cb, timeout);
      return () => window.clearTimeout(t);
    };

    const cancelIdle = requestIdle(() => {
      if (cancelled) return;
      if (hasBiliOrHuya) void ensureProxyStarted();
      void refreshList();
    }, REFRESH_INITIAL_DELAY_MS);

    return () => {
      cancelled = true;
      cancelIdle();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allStreamers.length, follow.hydrated]);

  const streamerByKey = useMemo(() => {
    const m = new Map<string, FollowedStreamer>();
    for (const s of allStreamers) m.set(`${s.platform}:${s.id}`, s);
    return m;
  }, [allStreamers]);

  const folderCounts = useCallback(
    (folderKeys: string[]) => {
      const seen = new Set<string>();
      let total = 0;
      let online = 0;
      for (const raw of folderKeys) {
        const key = normalizeFollowKey(raw);
        if (!key || seen.has(key)) continue;
        const s = streamerByKey.get(key);
        if (!s) continue;
        seen.add(key);
        total += 1;
        if (s.liveStatus === "LIVE") online += 1;
      }
      return { online, total };
    },
    [streamerByKey]
  );

  const onItemEnter = useCallback((el: HTMLElement) => {
    const root = listRef.current;
    if (!root) return;
    const rr = root.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    hoverYRaw.set(r.top - rr.top + root.scrollTop);
    hoverHRaw.set(r.height);
    hoverOpacity.set(1);
  }, [hoverHRaw, hoverOpacity, hoverYRaw]);

  const refreshList = useCallback(async () => {
    if (isRefreshing) return;
    const streamers = follow.followedStreamers;
    const updatedByKey = new Map<string, FollowedStreamer>(streamers.map((s) => [`${s.platform}:${s.id}`, s]));
    setIsRefreshing(true);
    setShowCheckIcon(false);
    setProgressTotal(streamers.length);
    setProgressCurrent(0);

    try {
      const concurrency = FOLLOW_REFRESH_CONCURRENCY;
      let idx = 0;
      const workers = Array.from({ length: Math.min(concurrency, streamers.length) }, async () => {
        while (idx < streamers.length) {
          const current = streamers[idx];
          idx += 1;
          try {
            const patch = await refreshOne(current);
            follow.updateStreamer(current.platform, current.id, patch);
            updatedByKey.set(`${current.platform}:${current.id}`, { ...current, ...patch });
          } catch {
            // 刷新失败时，至少不要继续显示“LIVE”（避免误判在线）
            if (current.liveStatus === "LIVE") {
              follow.updateStreamer(current.platform, current.id, { liveStatus: "UNKNOWN" });
              updatedByKey.set(`${current.platform}:${current.id}`, { ...current, liveStatus: "UNKNOWN" });
            }
          } finally {
            setProgressCurrent((v) => v + 1);
          }
        }
      });
      await Promise.all(workers);

      // 对齐老项目：刷新完成后，把“直播中”的主播优先展示（保留同一状态桶内的原相对顺序）
      const baseOrder = listItemsRef.current;
      const folderItems = baseOrder.filter((x): x is Extract<FollowListItem, { type: "folder" }> => x.type === "folder");
      const liveItems: Extract<FollowListItem, { type: "streamer" }>[] = [];
      const restItems: Extract<FollowListItem, { type: "streamer" }>[] = [];
      const seen = new Set<string>();

      for (const item of baseOrder) {
        if (item.type !== "streamer") continue;
        const key = `${item.data.platform}:${item.data.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const latest = updatedByKey.get(key) ?? item.data;
        const nextItem = { type: "streamer" as const, data: latest };
        if (latest.liveStatus === "LIVE") liveItems.push(nextItem);
        else restItems.push(nextItem);
      }

      follow.updateListOrder([...folderItems, ...liveItems, ...restItems]);
    } finally {
      setIsRefreshing(false);
      setShowCheckIcon(true);
      window.setTimeout(() => setShowCheckIcon(false), 1000);
    }
  }, [follow, isRefreshing]);

  const openOverlay = useCallback(() => {
    const btnRect = expandBtnRef.current?.getBoundingClientRect();
    const centerX = btnRect ? btnRect.left + btnRect.width / 2 : null;
    overlayAnchorCenterXRef.current = centerX;

    // Set an initial left; re-center precisely after panel is mounted/measured.
    const estimatedPanelWidth = 820;
    const requestedLeft = centerX != null ? Math.round(centerX - estimatedPanelWidth / 2) : 240;
    const fallbackMaxLeft = typeof window !== "undefined" ? Math.max(16, window.innerWidth - estimatedPanelWidth - 16) : requestedLeft;
    setOverlayAlignLeft(Math.max(16, Math.min(requestedLeft, fallbackMaxLeft)));
    setOverlayDeleteMode(false);
    setOverlayFilter("ALL");
    setOverlayOpen(true);
  }, []);

  const closeOverlay = useCallback(() => {
    setOverlayOpen(false);
    setOverlayDeleteMode(false);
  }, []);

  useEffect(() => {
    if (!overlayOpen) return;
    // Re-clamp left based on real panel width (align with old project behavior)
    const panelWidth = overlayPanelRef.current?.getBoundingClientRect().width ?? 0;
    if (typeof window !== "undefined" && panelWidth > 0) {
      const maxLeft = Math.max(16, window.innerWidth - panelWidth - 16);
      const centerX = overlayAnchorCenterXRef.current;
      const desired = centerX != null ? Math.round(centerX - panelWidth / 2) : null;
      setOverlayAlignLeft((v) => Math.max(16, Math.min(desired ?? v, maxLeft)));
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeOverlay, overlayOpen]);

  const openCreateFolderModal = useCallback(() => {
    const nextName = `新文件夹 ${follow.folders.length + 1}`;
    setFolderNameInput(nextName);
    setFolderNameModal({ open: true, mode: "create", folderId: null });
  }, [follow.folders.length]);

  const openRenameFolderModal = useCallback(
    (folderId: string) => {
      const folder = follow.folders.find((f) => f.id === folderId);
      setFolderNameInput(folder?.name ?? "");
      setFolderNameModal({ open: true, mode: "rename", folderId });
    },
    [follow.folders]
  );

  const submitFolderNameModal = useCallback(() => {
    const trimmed = folderNameInput.trim();
    if (!trimmed) return;

    if (folderNameModal.mode === "create") {
      follow.createFolder(trimmed);
    } else if (folderNameModal.folderId) {
      follow.renameFolder(folderNameModal.folderId, trimmed);
    }
    setFolderNameModal({ open: false, mode: "create", folderId: null });
  }, [follow, folderNameInput, folderNameModal.folderId, folderNameModal.mode]);

  const dragRef = useRef<{
    isDragging: boolean;
    draggedIndex: number;
    draggedItemType: "folder" | "streamer" | null;
    dragOverFolderId: string | null;
    draggedStreamerKey: string | null;
    draggedFromFolder: boolean;
    sourceFolderId: string | null;
    startX: number;
    startY: number;
  }>({
    isDragging: false,
    draggedIndex: -1,
    draggedItemType: null,
    dragOverFolderId: null,
    draggedStreamerKey: null,
    draggedFromFolder: false,
    sourceFolderId: null,
    startX: 0,
    startY: 0
  });

  const pendingDragRef = useRef<{
    active: boolean;
    timer: number | null;
    startX: number;
    startY: number;
    payload: null | { type: "folder" | "streamer"; index: number; streamerKey?: string; fromFolder?: boolean; sourceFolderId?: string | null };
  }>({ active: false, timer: null, startX: 0, startY: 0, payload: null });

  const [dragUi, setDragUi] = useState<{ isDragging: boolean; dragOverFolderId: string | null; draggedItemType: "folder" | "streamer" | null }>({ isDragging: false, dragOverFolderId: null, draggedItemType: null });
  const didDragRef = useRef(false);

  const resetDragUi = useCallback(() => {
    dragRef.current = {
      isDragging: false,
      draggedIndex: -1,
      draggedItemType: null,
      dragOverFolderId: null,
      draggedStreamerKey: null,
      draggedFromFolder: false,
      sourceFolderId: null,
      startX: 0,
      startY: 0
    };
    setDragUi({ isDragging: false, dragOverFolderId: null, draggedItemType: null });
    document.body.style.userSelect = "";
    document.removeEventListener("mousemove", handleDragMove as any);
    document.removeEventListener("mouseup", handleDragUp as any);
  }, []);

  const cancelPendingDrag = useCallback(() => {
    const p = pendingDragRef.current;
    if (!p.active) return;
    if (p.timer !== null) window.clearTimeout(p.timer);
    pendingDragRef.current = { active: false, timer: null, startX: 0, startY: 0, payload: null };
    document.removeEventListener("mousemove", handlePrepMove as any);
    document.removeEventListener("mouseup", handlePrepUp as any);
  }, []);

  // handlers need hoisting for reset/cancel above
  function beginDrag(payload: { type: "folder" | "streamer"; index: number; streamerKey?: string; fromFolder?: boolean; sourceFolderId?: string | null }, startX: number, startY: number) {
    cancelPendingDrag();
    if (dragRef.current.isDragging) {
      follow.rollbackTransaction();
      resetDragUi();
    }

    follow.beginTransaction();
    dragRef.current.isDragging = true;
    dragRef.current.draggedItemType = payload.type;
    dragRef.current.draggedIndex = payload.fromFolder ? -1 : payload.index;
    dragRef.current.draggedStreamerKey = payload.streamerKey ?? null;
    dragRef.current.draggedFromFolder = !!payload.fromFolder;
    dragRef.current.sourceFolderId = payload.sourceFolderId ?? null;
    dragRef.current.dragOverFolderId = null;
    dragRef.current.startX = startX;
    dragRef.current.startY = startY;

    document.body.style.userSelect = "none";
    setDragUi({ isDragging: true, dragOverFolderId: null, draggedItemType: payload.type });
    document.addEventListener("mousemove", handleDragMove as any);
    document.addEventListener("mouseup", handleDragUp as any);
  }

  function handlePrepMove(e: MouseEvent) {
    const p = pendingDragRef.current;
    if (!p.active || !p.payload) return;
    const dist = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
    if (dist >= DRAG_MIN_PX) {
      beginDrag(p.payload, p.startX, p.startY);
      didDragRef.current = true;
    }
  }

  function handlePrepUp() {
    cancelPendingDrag();
  }

  const prepareDrag = useCallback(
    (payload: { type: "folder" | "streamer"; index: number; streamerKey?: string; fromFolder?: boolean; sourceFolderId?: string | null }, e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if (folderMenu.open) setFolderMenu((m) => ({ ...m, open: false }));
      if (folderNameModal.open) return;

      cancelPendingDrag();
      const startX = e.clientX;
      const startY = e.clientY;
      pendingDragRef.current = { active: true, timer: null, startX, startY, payload };
      pendingDragRef.current.timer = window.setTimeout(() => {
        if (!pendingDragRef.current.active || !pendingDragRef.current.payload) return;
        beginDrag(pendingDragRef.current.payload, startX, startY);
        didDragRef.current = true;
      }, DRAG_PREP_DELAY_MS);

      document.addEventListener("mousemove", handlePrepMove as any);
      document.addEventListener("mouseup", handlePrepUp as any);
    },
    [cancelPendingDrag, folderMenu.open, folderNameModal.open, resetDragUi, follow]
  );

  const handleStreamerClick = useCallback(
    (platform: FollowPlatform, id: string) => {
      if (dragRef.current.isDragging || pendingDragRef.current.active || didDragRef.current) return;
      playerOverlay.openPlayer({ platform: platform.toLowerCase(), roomId: id });
    },
    [playerOverlay]
  );

  const overlayPlatforms = useMemo(() => {
    const present = new Set<FollowPlatform>();
    for (const s of allStreamers) present.add(s.platform);
    const order: FollowPlatform[] = ["DOUYU", "HUYA", "DOUYIN", "BILIBILI"];
    return order.filter((p) => present.has(p));
  }, [allStreamers]);

  const overlayItems = useMemo(() => {
    if (overlayFilter === "ALL") return allStreamers;
    return allStreamers.filter((s) => s.platform === overlayFilter);
  }, [allStreamers, overlayFilter]);

  const platformLabel = useCallback((p: "ALL" | FollowPlatform) => {
    if (p === "ALL") return "全部";
    if (p === "DOUYU") return "斗鱼";
    if (p === "HUYA") return "虎牙";
    if (p === "DOUYIN") return "抖音";
    if (p === "BILIBILI") return "B站";
    return p;
  }, []);

  function handleDragMove(e: MouseEvent) {
    const d = dragRef.current;
    if (!d.isDragging || !d.draggedItemType) return;

    // streamer: hover folder detection
    if (d.draggedItemType === "streamer" && d.draggedStreamerKey) {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const folderEl = el?.closest("[data-folder-id]") as HTMLElement | null;
      const folderId = folderEl?.getAttribute("data-folder-id") || null;
      if (folderId) {
        const folder = foldersRef.current.find((f) => f.id === folderId) || null;
        const exists = folder ? folder.streamerIds.some((x) => normalizeFollowKey(x) === normalizeFollowKey(d.draggedStreamerKey as string)) : false;
        if (folder && !exists) {
          d.dragOverFolderId = folderId;
          setDragUi((u) => ({ ...u, dragOverFolderId: folderId }));
          return;
        }
      }
      if (d.dragOverFolderId) {
        d.dragOverFolderId = null;
        setDragUi((u) => ({ ...u, dragOverFolderId: null }));
      }
    }

    // reorder only for top-level drags
    if (d.draggedIndex < 0) return;
    const root = streamersListRef.current;
    if (!root) return;
    const children = Array.from(root.children) as HTMLElement[];
    if (children.length === 0) return;
    const currentOrder = listItemsRef.current;
    if (d.draggedIndex >= currentOrder.length) return;

    const folderCount = currentOrder.reduce((acc, item) => (item.type === "folder" ? acc + 1 : acc), 0);

    const cursorY = e.clientY;
    let targetIndex = 0;
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (cursorY > mid) targetIndex = i + 1;
    }
    targetIndex = Math.max(0, Math.min(currentOrder.length - 1, targetIndex));
    if (targetIndex === d.draggedIndex) return;

    if (d.draggedItemType === "folder") {
      targetIndex = Math.max(0, Math.min(Math.max(0, folderCount - 1), targetIndex));
    } else if (d.draggedItemType === "streamer") {
      // streamers never go above folders
      targetIndex = Math.max(folderCount, targetIndex);
      targetIndex = Math.min(currentOrder.length - 1, targetIndex);
    }
    if (targetIndex === d.draggedIndex) return;

    const targetItem = currentOrder[targetIndex];
    if (d.draggedItemType === "streamer" && targetItem?.type === "folder" && targetItem.data.expanded !== false) {
      d.dragOverFolderId = targetItem.data.id;
      setDragUi((u) => ({ ...u, dragOverFolderId: targetItem.data.id }));
      return;
    }

    const next = [...currentOrder];
    const [removed] = next.splice(d.draggedIndex, 1);
    next.splice(targetIndex, 0, removed);
    follow.updateListOrder(next);
    d.draggedIndex = targetIndex;
  }

  function handleDragUp(ev: MouseEvent) {
    const d = dragRef.current;
    if (!d.isDragging || !d.draggedItemType) {
      resetDragUi();
      return;
    }

    cancelPendingDrag();

    const movedDist = Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY);

    if (d.draggedItemType === "streamer" && d.draggedStreamerKey && d.dragOverFolderId) {
      follow.moveStreamerToFolder(d.draggedStreamerKey, d.dragOverFolderId);
      follow.commitTransaction();
    } else if (d.draggedItemType === "streamer" && d.draggedFromFolder) {
      let isStillInsideSource = false;
      if (d.sourceFolderId) {
        const sourceEl = document.querySelector(`[data-folder-id="${d.sourceFolderId}"]`) as HTMLElement | null;
        const rect = sourceEl?.getBoundingClientRect();
        if (rect) {
          isStillInsideSource = ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom;
        }
      }
      if (d.sourceFolderId && movedDist >= DRAG_MIN_PX && !isStillInsideSource) {
        follow.removeStreamerFromFolderByKey(d.draggedStreamerKey || "", d.sourceFolderId);
        follow.commitTransaction();
      } else {
        follow.rollbackTransaction();
      }
    } else {
      if (movedDist < DRAG_MIN_PX) follow.rollbackTransaction();
      else follow.commitTransaction();
    }

    resetDragUi();
    didDragRef.current = true;
    window.setTimeout(() => {
      didDragRef.current = false;
    }, 0);
  }

  useEffect(() => {
    const onBlur = () => {
      if (!dragRef.current.isDragging) return;
      follow.rollbackTransaction();
      resetDragUi();
    };
    const onVis = () => {
      if (document.hidden) onBlur();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [follow, resetDragUi]);

  const renderStreamerRow = (
    s: FollowedStreamer,
    itemKey: string,
    opts: { index: number; fromFolder?: boolean; sourceFolderId?: string | null; onEnter?: (el: HTMLElement) => void; onLeave?: () => void }
  ) => {
    const liveDotClass = s.liveStatus === "LIVE" ? styles.liveDotLive : s.liveStatus === "UNKNOWN" ? styles.liveDotUnknown : styles.liveDotOffline;
    const dragKey = `${s.platform}:${s.id}`;
    const avatarSrc = getAvatarSrc(s.platform, s.avatarUrl);
    const dragEnabled = opts.fromFolder || opts.index >= 0;
    const inFolder = !!opts.fromFolder;
    return (
      <div
        key={itemKey}
        className={styles.listItemWrapper}
        onMouseEnter={inFolder ? (e) => opts.onEnter?.(e.currentTarget) : (e) => onItemEnter(e.currentTarget)}
        onMouseLeave={inFolder ? () => opts.onLeave?.() : undefined}
        onMouseDown={
          dragEnabled
            ? (e) =>
                prepareDrag(
                  { type: "streamer", index: opts.index, streamerKey: dragKey, fromFolder: !!opts.fromFolder, sourceFolderId: opts.sourceFolderId ?? null },
                  e
                )
            : undefined
        }
      >
        <div
          className={`${styles.streamerItem} ${inFolder ? styles.streamerItemInFolder : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => handleStreamerClick(s.platform, s.id)}
        >
          <span className={styles.avatarWrap} aria-hidden="true">
            <span className={styles.avatar}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {avatarSrc ? (
                <img className={styles.avatarImg} src={avatarSrc} alt={s.nickname} loading="lazy" decoding="async" draggable={false} />
              ) : (
                <span className={styles.avatarFallback}>{(s.nickname || "?").slice(0, 1)}</span>
              )}
            </span>
            <span className={`${styles.liveDot} ${styles.liveDotOnAvatar} ${liveDotClass}`} aria-hidden="true" />
          </span>
          <div className={styles.meta}>
            <div className={styles.name} title={s.nickname}>
              {s.nickname}
            </div>
            <div className={styles.sub} title={s.roomTitle || ""}>
              {s.roomTitle || "暂无直播标题"}
            </div>
          </div>
        </div>
      </div>
    );
  };

  function clearHoverHighlight() {
    hoverOpacity.set(0);
  }

  return (
    <div className={styles.followList}>
      <div className={styles.listHeader} ref={headerRef}>
        <h3 className={styles.headerTitle} aria-label="关注列表">
          <span className={styles.headerLabel}>Live Channels</span>
        </h3>
        <div className={styles.headerActions}>
          {!isRefreshing ? (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.refreshBtn}`}
              title="刷新列表"
              onClick={() => void refreshList()}
            >
              {showCheckIcon ? <Check size={18} /> : <RotateCw size={18} />}
            </button>
          ) : (
            <span className={styles.progressWithSpinner} aria-live="polite">
              <span className={styles.spinner} aria-hidden="true" />
              <span>
                {progressCurrent}/{progressTotal}
              </span>
            </span>
          )}

          <button
            type="button"
            className={`${styles.actionBtn} ${styles.folderBtn}`}
            title="新建文件夹"
            onClick={openCreateFolderModal}
          >
            <FolderPlus size={18} />
          </button>

          <button
            type="button"
            className={`${styles.actionBtn} ${styles.expandBtn}`}
            title="展开关注列表"
            ref={expandBtnRef}
            onClick={openOverlay}
          >
            <ListCollapse size={18} />
          </button>
        </div>
      </div>

      <div
        className={styles.listContent}
        ref={listRef}
        onScroll={() => hoverOpacity.set(0)}
        onMouseLeave={() => hoverOpacity.set(0)}
      >
        <m.div
          className={styles.hoverHighlight}
          style={{ opacity: hoverOpacity, y: hoverY, height: hoverH }}
        />

        <div className={`${styles.streamersList} ${dragUi.isDragging ? styles.draggingList : ""}`} ref={streamersListRef}>
          {listItems.length === 0 ? (
            <div style={{ padding: 18, color: "var(--secondary-text)", fontWeight: 800, textAlign: "center" }}>
              暂无关注主播
            </div>
          ) : (
            listItems.map((item, index) => {
              if (item.type === "streamer") {
                const key = `${item.data.platform}:${item.data.id}`;
                const latest = streamerByKey.get(key) ?? item.data;
                return renderStreamerRow(latest, key, { index });
              }

              const folder = item.data;
              const expanded = folder.expanded !== false;
              const counts = folderCounts(folder.streamerIds);
              return (
                <div
                  key={`folder_${folder.id}`}
                  className={`${styles.listItemWrapper} ${styles.folderItem} ${expanded ? styles.folderItemExpanded : ""} ${
                    dragUi.dragOverFolderId === folder.id ? styles.folderItemDragOver : ""
                  }`}
                  onMouseEnter={() => clearHoverHighlight()}
                  data-folder-id={folder.id}
                  onMouseDown={(e) => prepareDrag({ type: "folder", index }, e)}
                >
                  <div
                    className={styles.folderHeader}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (dragRef.current.isDragging || pendingDragRef.current.active || didDragRef.current) return;
                      follow.toggleFolderExpanded(folder.id);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setFolderMenu({ open: true, x: e.clientX, y: e.clientY, folderId: folder.id });
                    }}
                  >
                    <Folder size={16} className={`${styles.folderIcon} ${expanded ? styles.folderIconExpanded : ""}`} />
                    <span className={styles.folderName} title={folder.name}>
                      {folder.name}
                    </span>
                    <span className={styles.folderCount}>
                      {counts.online}/{counts.total}
                    </span>
                    <m.span
                      className={styles.expandIcon}
                      animate={{ rotate: expanded ? 180 : 0 }}
                      transition={{ duration: 0.2, ease: [0.25, 0.8, 0.4, 1] }}
                      aria-hidden="true"
                    >
                      <ChevronDown size={12} />
                    </m.span>
                  </div>

                  <FolderChildren
                    expanded={expanded}
                    folderId={folder.id}
                    streamerKeys={folder.streamerIds}
                    normalizeKey={normalizeFollowKey}
                    streamerByKey={streamerByKey}
                    render={(s, itemKey, handlers) =>
                      renderStreamerRow(s, itemKey, { index: -1, fromFolder: true, sourceFolderId: folder.id, onEnter: handlers.onEnter, onLeave: handlers.onLeave })
                    }
                  />
                </div>
              );
            })
          )}
        </div>
      </div>

      {portalTarget
        ? createPortal(
            <AnimatePresence>
              {overlayOpen ? (
                <m.div
                  className={styles.overlayBackdrop}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onMouseDown={(e) => {
                    if (e.target === e.currentTarget) closeOverlay();
                  }}
                >
                  <div className={styles.followOverlayAnchor}>
                    <m.div
                      className={styles.followOverlayPanel}
                      ref={overlayPanelRef}
                      initial={{ opacity: 0, scale: 0.96, y: 16 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96, y: 16 }}
                      transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                <button type="button" className={styles.followOverlayCloseBtn} title="关闭" onClick={closeOverlay}>
                  <X size={18} />
                </button>

                <div className={styles.followOverlayHeader}>
                  <div className={styles.followOverlayFilters}>
                    <button
                      type="button"
                      className={`${styles.filterChip} ${overlayFilter === "ALL" ? styles.filterChipActive : ""}`}
                      onClick={() => setOverlayFilter("ALL")}
                    >
                      {platformLabel("ALL")}
                    </button>
                    {overlayPlatforms.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={`${styles.filterChip} ${overlayFilter === p ? styles.filterChipActive : ""}`}
                        onClick={() => setOverlayFilter(p)}
                      >
                        {platformLabel(p)}
                      </button>
                    ))}
                  </div>
                  <div className={styles.followOverlayActions}>
                    <button
                      type="button"
                      className={`${styles.overlayTextBtn} ${overlayDeleteMode ? styles.overlayTextBtnActive : ""}`}
                      onClick={() => setOverlayDeleteMode((v) => !v)}
                    >
                      {overlayDeleteMode ? "完成" : "管理"}
                    </button>
                    <button
                      type="button"
                      className={`${styles.overlayTextBtn} ${isRefreshing ? styles.overlayTextBtnRefreshing : ""}`}
                      disabled={isRefreshing}
                      onClick={() => void refreshList()}
                    >
                      <span>刷新</span>
                      <span className={styles.overlaySpinner} aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className={styles.followOverlayContent}>
                  {overlayItems.length === 0 ? (
                    <div className={styles.followOverlayEmpty}>
                      <div className={styles.emptyTitle}>暂无关注主播</div>
                      <div className={styles.emptyText}>当前筛选下暂无关注主播</div>
                    </div>
                  ) : (
                    <div className={styles.followOverlayGrid}>
                      {overlayItems.map((s) => {
                        const avatarSrc = getAvatarSrc(s.platform, s.avatarUrl);
                        const liveDotClass = s.liveStatus === "LIVE" ? styles.liveDotLive : s.liveStatus === "UNKNOWN" ? styles.liveDotUnknown : styles.liveDotOffline;
                        return (
                          <div
                            key={`${s.platform}:${s.id}`}
                            className={`${styles.followOverlayCard} ${overlayDeleteMode ? styles.followOverlayCardManage : ""}`}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              if (overlayDeleteMode) return;
                              playerOverlay.openPlayer({ platform: s.platform.toLowerCase(), roomId: s.id });
                              closeOverlay();
                            }}
                          >
                            {overlayDeleteMode ? (
                              <button
                                type="button"
                                className={styles.followOverlayRemoveBtn}
                                title="删除"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  follow.unfollowStreamer(s.platform, s.id);
                                }}
                              >
                                ×
                              </button>
                            ) : null}
                            <div className={styles.followOverlayCardTop}>
                              <div className={styles.resultAvatar}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {avatarSrc ? <img className={styles.resultAvatarImg} src={avatarSrc} alt={s.nickname} /> : <div className={styles.resultAvatarFallback}>{(s.nickname || "?").slice(0, 1)}</div>}
                              </div>
                              <div className={styles.resultMain}>
                                <div className={styles.resultName} title={s.nickname}>
                                  {s.nickname}
                                </div>
                              <div className={styles.resultTitle} title={`${platformLabel(s.platform)} · ${s.id}`}>
                                {platformLabel(s.platform)} · {s.id}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    </div>
                  )}
                </div>
                    </m.div>
                  </div>
                </m.div>
              ) : null}
            </AnimatePresence>,
            portalTarget
          )
        : null}

      {portalTarget
        ? createPortal(
            <AnimatePresence>
              {folderNameModal.open ? (
                <m.div
                  className={styles.modalBackdrop}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onMouseDown={() => setFolderNameModal({ open: false, mode: "create", folderId: null })}
                >
                  <m.div
                    className={styles.modalPanel}
                    initial={{ opacity: 0, scale: 0.98, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98, y: 8 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>{folderNameModal.mode === "create" ? "新建文件夹" : "重命名文件夹"}</div>
                <button type="button" className={styles.miniBtn} title="关闭" onClick={() => setFolderNameModal({ open: false, mode: "create", folderId: null })}>
                  <X size={14} />
                </button>
              </div>
              <div className={styles.modalBody}>
                <input
                  className={styles.textInput}
                  value={folderNameInput}
                  autoFocus
                  placeholder="输入文件夹名称"
                  onChange={(e) => setFolderNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitFolderNameModal();
                    if (e.key === "Escape") setFolderNameModal({ open: false, mode: "create", folderId: null });
                  }}
                />
              </div>
              <div className={styles.modalFooter}>
                <button type="button" className={styles.secondaryBtn} onClick={() => setFolderNameModal({ open: false, mode: "create", folderId: null })}>
                  取消
                </button>
                <button type="button" className={styles.primaryBtn} onClick={submitFolderNameModal}>
                  确定
                </button>
              </div>
                  </m.div>
                </m.div>
              ) : null}
            </AnimatePresence>,
            portalTarget
          )
        : null}

      <AnimatePresence>
        {folderMenu.open ? (
          <m.div
            className={styles.menuBackdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={() => setFolderMenu((m) => ({ ...m, open: false }))}
          >
            <m.div
              className={styles.contextMenu}
              style={{ left: folderMenu.x, top: folderMenu.y }}
              initial={{ opacity: 0, scale: 0.98, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 4 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  if (folderMenu.folderId) openRenameFolderModal(folderMenu.folderId);
                  setFolderMenu((m) => ({ ...m, open: false }));
                }}
              >
                重命名
              </button>
              <button
                type="button"
                className={`${styles.menuItem} ${styles.menuDanger}`}
                onClick={() => {
                  setFolderDeleteConfirm({ open: true, folderId: folderMenu.folderId });
                  setFolderMenu((m) => ({ ...m, open: false }));
                }}
              >
                删除
              </button>
            </m.div>
          </m.div>
        ) : null}
      </AnimatePresence>

      {portalTarget
        ? createPortal(
            <AnimatePresence>
              {folderDeleteConfirm.open ? (
                <m.div
                  className={styles.modalBackdrop}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onMouseDown={() => setFolderDeleteConfirm({ open: false, folderId: null })}
                >
                  <m.div
                    className={styles.modalPanel}
                    initial={{ opacity: 0, scale: 0.98, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98, y: 8 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>删除文件夹</div>
                <button type="button" className={styles.miniBtn} title="关闭" onClick={() => setFolderDeleteConfirm({ open: false, folderId: null })}>
                  <X size={14} />
                </button>
              </div>
              <div className={styles.modalBody} style={{ color: "var(--secondary-text)", fontWeight: 800 }}>
                删除后，文件夹里的主播会回到主列表。
              </div>
              <div className={styles.modalFooter}>
                <button type="button" className={styles.secondaryBtn} onClick={() => setFolderDeleteConfirm({ open: false, folderId: null })}>
                  取消
                </button>
                <button
                  type="button"
                  className={styles.dangerBtn}
                  onClick={() => {
                    if (folderDeleteConfirm.folderId) follow.deleteFolder(folderDeleteConfirm.folderId);
                    setFolderDeleteConfirm({ open: false, folderId: null });
                  }}
                >
                  删除
                </button>
              </div>
                  </m.div>
                </m.div>
              ) : null}
            </AnimatePresence>,
            portalTarget
          )
        : null}
    </div>
  );
}

function FolderChildren({
  expanded,
  folderId,
  streamerKeys,
  normalizeKey,
  streamerByKey,
  render
}: {
  expanded: boolean;
  folderId: string;
  streamerKeys: string[];
  normalizeKey: (key: string) => string;
  streamerByKey: Map<string, FollowedStreamer>;
  render: (s: FollowedStreamer, itemKey: string, handlers: { onEnter: (el: HTMLElement) => void; onLeave: () => void }) => React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);

  const hoverOpacity = useMotionValue(0);
  const hoverYRaw = useMotionValue(0);
  const hoverHRaw = useMotionValue(38);
  const hoverY = useSpring(hoverYRaw, { stiffness: 520, damping: 44, mass: 0.7 });
  const hoverH = useSpring(hoverHRaw, { stiffness: 520, damping: 44, mass: 0.7 });

  useLayoutEffect(() => {
    if (!expanded) {
      setHeight(0);
      hoverOpacity.set(0);
      return;
    }

    const el = innerRef.current;
    const panel = panelRef.current;
    if (!el || !panel) return;

    const update = () => {
      const s = window.getComputedStyle(panel);
      const padTop = Number.parseFloat(s.paddingTop || "0") || 0;
      const padBottom = Number.parseFloat(s.paddingBottom || "0") || 0;
      setHeight(el.scrollHeight + padTop + padBottom);
    };
    update();

    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded, hoverOpacity]);

  const onEnter = useCallback((el: HTMLElement) => {
    const root = panelRef.current;
    if (!root) return;
    const rr = root.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    hoverYRaw.set(r.top - rr.top + root.scrollTop);
    hoverHRaw.set(r.height);
    hoverOpacity.set(1);
  }, [hoverHRaw, hoverOpacity, hoverYRaw]);

  const onLeave = useCallback(() => {
    hoverOpacity.set(0);
  }, [hoverOpacity]);

  return (
    <AnimatePresence initial={false}>
      {expanded ? (
        <m.div
          className={styles.folderContent}
          ref={panelRef}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height, opacity: 1 }}
          exit={{ height: 0, opacity: 0, transition: { type: "tween", duration: 0.24, ease: [0.64, 0, 0.78, 0.39] } }}
          transition={{ type: "tween", duration: 0.24, ease: [0.22, 0.61, 0.36, 1] }}
          style={{ overflow: "hidden" }}
          onMouseLeave={onLeave}
        >
          <m.div
            className={styles.folderHoverHighlight}
            style={{ opacity: hoverOpacity, y: hoverY, height: hoverH }}
          />
          <div ref={innerRef} className={styles.folderItemsInner}>
            {streamerKeys.map((key) => {
              const normKey = normalizeKey(key);
              const s = streamerByKey.get(normKey);
              if (!s) return null;
              const itemKey = `${normKey}@folder:${folderId}`;
              return render(s, itemKey, { onEnter, onLeave });
            })}
          </div>
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}
