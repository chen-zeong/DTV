"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";

export type Platform = "DOUYU" | "DOUYIN" | "HUYA" | "BILIBILI";

export type FollowedStreamer = {
  id: string;
  platform: Platform;
  nickname: string;
  avatarUrl: string;
  roomTitle?: string;
  currentRoomId: string;
  liveStatus: "UNKNOWN" | "LIVE" | "OFFLINE";
};

export interface FollowFolder {
  id: string;
  name: string;
  streamerIds: string[];
  expanded?: boolean;
}

export type FollowListItem =
  | { type: "folder"; data: FollowFolder }
  | { type: "streamer"; data: FollowedStreamer };

type FollowContextValue = {
  followedStreamers: FollowedStreamer[];
  folders: FollowFolder[];
  listOrder: FollowListItem[];
  hydrated: boolean;
  consumeInitialAutoRefresh: () => boolean;
  beginTransaction: () => void;
  commitTransaction: () => void;
  rollbackTransaction: () => void;
  isFollowed: (platform: Platform, id: string) => boolean;
  followStreamer: (streamer: FollowedStreamer) => void;
  unfollowStreamer: (platform: Platform, id: string) => void;
  updateOrder: (nextOrder: FollowListItem[]) => void;
  updateListOrder: (nextOrder: FollowListItem[]) => void;
  createFolder: (name: string) => void;
  renameFolder: (folderId: string, name: string) => void;
  deleteFolder: (folderId: string) => void;
  toggleFolderExpanded: (folderId: string) => void;
  moveStreamerToFolder: (streamerKey: string, folderId: string) => void;
  addStreamerToFolder: (folderId: string, platform: Platform, id: string) => void;
  removeStreamerFromFolder: (folderId: string, platform: Platform, id: string) => void;
  removeStreamerFromFolderByKey: (streamerKey: string, folderId: string) => void;
  updateStreamer: (platform: Platform, id: string, patch: Partial<FollowedStreamer>) => void;
};

const FollowContext = createContext<FollowContextValue | null>(null);

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function deepClone<T>(value: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sc = (globalThis as any).structuredClone as ((v: unknown) => unknown) | undefined;
  if (typeof sc === "function") return sc(value) as T;
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeStreamerKey(streamerKey: string) {
  const [rawPlatform, rawId] = String(streamerKey || "").split(":");
  const platform = String(rawPlatform || "").toUpperCase();
  const id = String(rawId || "");
  return { platform, id, key: `${platform}:${id}` };
}

function isKnownPlatform(platform: string): platform is Platform {
  return platform === "DOUYU" || platform === "DOUYIN" || platform === "HUYA" || platform === "BILIBILI";
}

function normalizeListOrder(order: FollowListItem[]): FollowListItem[] {
  const folderedKeys = new Set<string>();
  for (const item of order) {
    if (item.type !== "folder") continue;
    for (const rawKey of item.data.streamerIds) {
      folderedKeys.add(normalizeStreamerKey(rawKey).key);
    }
  }

  const nextFolders: Extract<FollowListItem, { type: "folder" }>[] = [];
  const nextStreamers: Extract<FollowListItem, { type: "streamer" }>[] = [];
  const seenFolderIds = new Set<string>();
  const seenStreamerKeys = new Set<string>();

  for (const item of order) {
    if (item.type === "folder") {
      const id = item.data.id;
      if (seenFolderIds.has(id)) continue;
      seenFolderIds.add(id);
      nextFolders.push(item);
      continue;
    }

    const key = normalizeStreamerKey(`${item.data.platform}:${item.data.id}`).key;
    if (seenStreamerKeys.has(key)) continue;
    seenStreamerKeys.add(key);
    if (folderedKeys.has(key)) continue; // streamers managed by folder stay inside folder only
    nextStreamers.push(item);
  }

  return [...nextFolders, ...nextStreamers];
}

export function FollowProvider({ children }: { children: React.ReactNode }) {
  const [followedStreamers, setFollowedStreamers] = useState<FollowedStreamer[]>([]);
  const [listOrder, setListOrder] = useState<FollowListItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const snapshotRef = useRef<{ followedStreamers: FollowedStreamer[]; listOrder: FollowListItem[] } | null>(null);
  const initialAutoRefreshConsumedRef = useRef(false);

  const folders = useMemo(() => listOrder.filter((x): x is { type: "folder"; data: FollowFolder } => x.type === "folder").map((x) => x.data), [listOrder]);

  useEffect(() => {
    const follows = loadJson<FollowedStreamer[]>("followedStreamers", []);
    const loadedFolders = loadJson<FollowFolder[]>("followFolders", []);
    const loadedOrder = loadJson<FollowListItem[]>("followListOrder", []);

    let nextOrder: FollowListItem[] = [];
    const byKey = new Map<string, FollowedStreamer>();

    for (const s of Array.isArray(follows) ? follows : []) {
      if (!s?.platform || !s?.id) continue;
      byKey.set(`${s.platform}:${s.id}`, s);
    }

    for (const item of Array.isArray(loadedOrder) ? loadedOrder : []) {
      if (item?.type !== "streamer") continue;
      const s = item.data as FollowedStreamer;
      if (!s?.platform || !s?.id) continue;
      byKey.set(`${s.platform}:${s.id}`, s);
    }

    const folderSources = [
      ...(Array.isArray(loadedFolders) ? loadedFolders : []),
      ...((Array.isArray(loadedOrder) ? loadedOrder : []).filter((x): x is Extract<FollowListItem, { type: "folder" }> => x?.type === "folder").map((x) => x.data))
    ];
    for (const folder of folderSources) {
      for (const rawKey of folder?.streamerIds ?? []) {
        const norm = normalizeStreamerKey(rawKey);
        if (!norm.id || !isKnownPlatform(norm.platform)) continue;
        const key = `${norm.platform}:${norm.id}`;
        if (byKey.has(key)) continue;
        byKey.set(key, {
          id: norm.id,
          platform: norm.platform,
          nickname: norm.id,
          avatarUrl: "",
          roomTitle: "",
          currentRoomId: norm.id,
          liveStatus: "UNKNOWN"
        });
      }
    }

    const nextFollowedStreamers = Array.from(byKey.values());
    setFollowedStreamers(nextFollowedStreamers);

    if (loadedOrder.length > 0) {
      nextOrder = loadedOrder;
    } else if (loadedFolders.length > 0) {
      const folderItems: FollowListItem[] = loadedFolders.map((f) => ({ type: "folder" as const, data: f }));
      const folderStreamerKeys = new Set(loadedFolders.flatMap((f) => f.streamerIds));
      const topLevelStreamers = nextFollowedStreamers.filter((s) => !folderStreamerKeys.has(`${s.platform}:${s.id}`));
      nextOrder = [...folderItems, ...topLevelStreamers.map((s) => ({ type: "streamer" as const, data: s }))];
    } else {
      nextOrder = nextFollowedStreamers.map((s) => ({ type: "streamer" as const, data: s }));
    }

    setListOrder(normalizeListOrder(nextOrder));
    setHydrated(true);
  }, []);

  useEffect(() => saveJson("followedStreamers", followedStreamers), [followedStreamers]);
  useEffect(() => saveJson("followFolders", folders), [folders]);
  useEffect(() => saveJson("followListOrder", listOrder), [listOrder]);

  const updateStreamer = useCallback((platform: Platform, id: string, patch: Partial<FollowedStreamer>) => {
    const key = `${platform}:${id}`;
    setFollowedStreamers((prev) => prev.map((s) => (`${s.platform}:${s.id}` === key ? { ...s, ...patch } : s)));
    setListOrder((prev) =>
      prev.map((item) => {
        if (item.type === "streamer") {
          return `${item.data.platform}:${item.data.id}` === key ? { ...item, data: { ...item.data, ...patch } } : item;
        }
        const nextStreamerIds = item.data.streamerIds.map((x) => x); // keep stable ref
        return { ...item, data: { ...item.data, streamerIds: nextStreamerIds } };
      })
    );
  }, []);

  const value = useMemo<FollowContextValue>(() => {
    return {
      followedStreamers,
      folders,
      listOrder,
      hydrated,
      consumeInitialAutoRefresh: () => {
        if (initialAutoRefreshConsumedRef.current) return false;
        initialAutoRefreshConsumedRef.current = true;
        return true;
      },
      beginTransaction: () => {
        snapshotRef.current = {
          followedStreamers: deepClone(followedStreamers),
          listOrder: deepClone(listOrder)
        };
      },
      commitTransaction: () => {
        snapshotRef.current = null;
      },
      rollbackTransaction: () => {
        const snap = snapshotRef.current;
        if (!snap) return;
        snapshotRef.current = null;
        setFollowedStreamers(snap.followedStreamers);
        setListOrder(normalizeListOrder(snap.listOrder));
      },
      isFollowed: (platform, id) => followedStreamers.some((s) => s.platform === platform && s.id === id),
      followStreamer: (streamer) => {
        setFollowedStreamers((prev) => {
          if (prev.some((s) => s.platform === streamer.platform && s.id === streamer.id)) return prev;
          return [...prev, streamer];
        });
        setListOrder((prev) => {
          const key = `${streamer.platform}:${streamer.id}`;
          if (prev.some((item) => item.type === "streamer" && `${item.data.platform}:${item.data.id}` === key)) return prev;
          return normalizeListOrder([...prev, { type: "streamer", data: streamer }]);
        });
      },
      unfollowStreamer: (platform, id) => {
        const key = `${platform}:${id}`;
        setFollowedStreamers((prev) => prev.filter((s) => !(s.platform === platform && s.id === id)));
        setListOrder((prev) =>
          normalizeListOrder(
            prev
              .map((item) => {
                if (item.type === "folder") {
                  return { ...item, data: { ...item.data, streamerIds: item.data.streamerIds.filter((x) => x !== key) } };
                }
                return item;
              })
              .filter((item) => !(item.type === "streamer" && `${item.data.platform}:${item.data.id}` === key))
          )
        );
      },
      updateOrder: (nextOrder) => setListOrder(normalizeListOrder(nextOrder)),
      updateListOrder: (nextOrder) => setListOrder(normalizeListOrder(nextOrder)),

      createFolder: (name) => {
        const trimmed = (name || "").trim();
        if (!trimmed) return;
        const folder: FollowFolder = { id: uuidv4(), name: trimmed, streamerIds: [], expanded: true };
        setListOrder((prev) => normalizeListOrder([{ type: "folder" as const, data: folder }, ...prev]));
      },
      renameFolder: (folderId, name) => {
        const trimmed = (name || "").trim();
        if (!trimmed) return;
        setListOrder((prev) =>
          normalizeListOrder(
            prev.map((item) => (item.type === "folder" && item.data.id === folderId ? { ...item, data: { ...item.data, name: trimmed } } : item))
          )
        );
      },
      deleteFolder: (folderId) => {
        setListOrder((prev) => {
          const idx = prev.findIndex((x) => x.type === "folder" && x.data.id === folderId);
          if (idx < 0) return prev;
          const folder = prev[idx] as any as { type: "folder"; data: FollowFolder };
          const folderKeys = new Set(folder.data.streamerIds);
          const backToTop = followedStreamers
            .filter((s) => folderKeys.has(`${s.platform}:${s.id}`))
            .map((s) => ({ type: "streamer" as const, data: s }));
          const next = prev.filter((x) => !(x.type === "folder" && x.data.id === folderId));
          const insertAt = Math.min(idx, next.length);
          return normalizeListOrder([...next.slice(0, insertAt), ...backToTop, ...next.slice(insertAt)]);
        });
      },
      toggleFolderExpanded: (folderId) => {
        setListOrder((prev) =>
          normalizeListOrder(
            prev.map((item) =>
              item.type === "folder" && item.data.id === folderId
                ? { ...item, data: { ...item.data, expanded: !item.data.expanded } }
                : item
            )
          )
        );
      },
      moveStreamerToFolder: (streamerKey, folderId) => {
        const norm = normalizeStreamerKey(streamerKey);
        if (!norm.platform || !norm.id) return;

        setListOrder((prev) => {
          const folderExists = prev.some((x) => x.type === "folder" && x.data.id === folderId);
          if (!folderExists) return prev;

          const next = prev
            .filter((item) => !(item.type === "streamer" && normalizeStreamerKey(`${item.data.platform}:${item.data.id}`).key === norm.key))
            .map((item) => {
              if (item.type !== "folder") return item;

              const nextIds = item.data.streamerIds.filter((id) => normalizeStreamerKey(id).key !== norm.key);
              if (item.data.id !== folderId) {
                return nextIds.length === item.data.streamerIds.length ? item : { ...item, data: { ...item.data, streamerIds: nextIds } };
              }

              if (!nextIds.some((id) => normalizeStreamerKey(id).key === norm.key)) nextIds.push(norm.key);
              return { ...item, data: { ...item.data, streamerIds: nextIds, expanded: true } };
            });

          return normalizeListOrder(next);
        });
      },
      addStreamerToFolder: (folderId, platform, id) => {
        const key = `${platform}:${id}`;
        setListOrder((prev) => {
          const next = prev
            .map((item) => {
              if (item.type === "folder" && item.data.id === folderId) {
                if (item.data.streamerIds.includes(key)) return item;
                return { ...item, data: { ...item.data, streamerIds: [...item.data.streamerIds, key], expanded: true } };
              }
              return item;
            })
            .filter((item) => !(item.type === "streamer" && `${item.data.platform}:${item.data.id}` === key));
          return normalizeListOrder(next);
        });
      },
      removeStreamerFromFolder: (folderId, platform, id) => {
        const key = `${platform}:${id}`;
        const norm = normalizeStreamerKey(key);
        if (!norm.platform || !norm.id) return;

        setListOrder((prev) => {
          const folderIndex = prev.findIndex((x) => x.type === "folder" && x.data.id === folderId);
          if (folderIndex < 0) return prev;

          const streamer = followedStreamers.find((s) => normalizeStreamerKey(`${s.platform}:${s.id}`).key === norm.key);
          const existsInTop = prev.some((x) => x.type === "streamer" && normalizeStreamerKey(`${x.data.platform}:${x.data.id}`).key === norm.key);

          const next = prev.map((item) => {
            if (item.type !== "folder" || item.data.id !== folderId) return item;
            const nextIds = item.data.streamerIds.filter((x) => normalizeStreamerKey(x).key !== norm.key);
            return nextIds.length === item.data.streamerIds.length ? item : { ...item, data: { ...item.data, streamerIds: nextIds } };
          });

          if (!existsInTop && streamer) {
            const insertAt = Math.min(folderIndex + 1, next.length);
            next.splice(insertAt, 0, { type: "streamer" as const, data: streamer });
          }

          return normalizeListOrder(next);
        });
      },
      removeStreamerFromFolderByKey: (streamerKey, folderId) => {
        const norm = normalizeStreamerKey(streamerKey);
        if (!norm.platform || !norm.id) return;

        setListOrder((prev) => {
          const folderIndex = prev.findIndex((x) => x.type === "folder" && x.data.id === folderId);
          if (folderIndex < 0) return prev;

          const streamer = followedStreamers.find((s) => normalizeStreamerKey(`${s.platform}:${s.id}`).key === norm.key);
          const existsInTop = prev.some((x) => x.type === "streamer" && normalizeStreamerKey(`${x.data.platform}:${x.data.id}`).key === norm.key);

          const next = prev.map((item) => {
            if (item.type !== "folder" || item.data.id !== folderId) return item;
            const nextIds = item.data.streamerIds.filter((x) => normalizeStreamerKey(x).key !== norm.key);
            return nextIds.length === item.data.streamerIds.length ? item : { ...item, data: { ...item.data, streamerIds: nextIds } };
          });

          if (!existsInTop && streamer) {
            const insertAt = Math.min(folderIndex + 1, next.length);
            next.splice(insertAt, 0, { type: "streamer" as const, data: streamer });
          }

          return normalizeListOrder(next);
        });
      },
      updateStreamer
    };
  }, [followedStreamers, folders, hydrated, listOrder]);

  return <FollowContext.Provider value={value}>{children}</FollowContext.Provider>;
}

export function useFollow() {
  const ctx = useContext(FollowContext);
  if (!ctx) throw new Error("useFollow must be used within FollowProvider");
  return ctx;
}
