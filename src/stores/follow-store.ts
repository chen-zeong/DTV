"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { FollowedStreamer } from "@/types/platform";
import { Platform } from "@/types/platform";

export interface FollowFolder {
  id: string;
  name: string;
  streamerIds: string[];
  expanded?: boolean;
}

export type FollowListItem = { type: "folder"; data: FollowFolder } | { type: "streamer"; data: FollowedStreamer };
type FollowStreamerItem = Extract<FollowListItem, { type: "streamer" }>;

type Snapshot = {
  followedStreamers: FollowedStreamer[];
  folders: FollowFolder[];
  listOrder: FollowListItem[];
};

type FollowState = Snapshot & {
  _snapshot: Snapshot | null;
};

type FollowActions = {
  hydrateFromLegacy: () => void;
  beginTransaction: () => void;
  commitTransaction: () => void;
  rollbackTransaction: () => void;
  initializeListOrder: () => void;
  followStreamer: (streamer: FollowedStreamer) => void;
  unfollowStreamer: (platform: Platform, id: string) => void;
  updateOrder: (newList: FollowedStreamer[]) => void;
  updateListOrder: (newOrder: FollowListItem[]) => void;
  updateStreamerDetails: (updatedStreamer: Partial<FollowedStreamer> & { platform: Platform; id: string }) => void;
  replaceStreamerId: (platform: Platform, oldId: string, newId: string) => void;
  createFolder: (name: string) => string;
  renameFolder: (folderId: string, newName: string) => void;
  deleteFolder: (folderId: string) => void;
  toggleFolderExpanded: (folderId: string) => void;
  moveStreamerToFolder: (streamerKey: string, folderId: string) => void;
  removeStreamerFromFolder: (streamerKey: string, folderId: string) => void;
  isFollowed: (platform: Platform, id: string) => boolean;
  getFollowedStreamers: () => FollowedStreamer[];
};

export type FollowStore = FollowState & FollowActions;

const storage = createJSONStorage<FollowState>(() => (typeof window !== "undefined" ? localStorage : undefined));

const toKey = (platform: Platform, id: string) => `${String(platform).toUpperCase()}:${id}`;

export const useFollowStore = create<FollowStore>()(
  persist(
    (set, get) => ({
      followedStreamers: [],
      folders: [],
      listOrder: [],
      _snapshot: null,

      hydrateFromLegacy() {
        if (typeof window === "undefined") return;
        const hasData = get().followedStreamers.length || get().folders.length || get().listOrder.length;
        if (hasData) return;

        let followedStreamers: FollowedStreamer[] = [];
        let folders: FollowFolder[] = [];
        let listOrder: FollowListItem[] = [];

        try {
          const storedFollows = window.localStorage.getItem("followedStreamers");
          if (storedFollows) followedStreamers = JSON.parse(storedFollows) as FollowedStreamer[];
        } catch (error) {
          console.warn("[follow-store] parse followedStreamers failed", error);
        }

        try {
          const storedFolders = window.localStorage.getItem("followFolders");
          if (storedFolders) folders = JSON.parse(storedFolders) as FollowFolder[];
        } catch (error) {
          console.warn("[follow-store] parse followFolders failed", error);
        }

        try {
          const storedOrder = window.localStorage.getItem("followListOrder");
          if (storedOrder) listOrder = JSON.parse(storedOrder) as FollowListItem[];
        } catch (error) {
          console.warn("[follow-store] parse followListOrder failed", error);
        }

        set({ followedStreamers, folders, listOrder });
        if (!listOrder.length && followedStreamers.length) {
          get().initializeListOrder();
        }
      },

      beginTransaction() {
        const { followedStreamers, folders, listOrder } = get();
        set({
          _snapshot: {
            followedStreamers: JSON.parse(JSON.stringify(followedStreamers)),
            folders: JSON.parse(JSON.stringify(folders)),
            listOrder: JSON.parse(JSON.stringify(listOrder)),
          },
        });
      },

      commitTransaction() {
        set({ _snapshot: null });
      },

      rollbackTransaction() {
        const snap = get()._snapshot;
        if (!snap) return;
        set({ ...snap, _snapshot: null });
      },

      initializeListOrder() {
        const { followedStreamers } = get();
        if (!followedStreamers.length) {
          set({ listOrder: [] });
          return;
        }
        const listOrder: FollowListItem[] = followedStreamers.map((s) => ({ type: "streamer", data: s }));
        set({ listOrder });
      },

      followStreamer(streamer) {
        if (get().isFollowed(streamer.platform, streamer.id)) return;
        set((state) => ({
          followedStreamers: [...state.followedStreamers, streamer],
          listOrder: [...state.listOrder, { type: "streamer", data: streamer }],
        }));
      },

      unfollowStreamer(platform, id) {
        const key = toKey(platform, id);
        set((state) => {
          const followedStreamers = state.followedStreamers.filter((s) => toKey(s.platform, s.id) !== key);
          const listOrder = state.listOrder
            .map((item) => {
              if (item.type === "folder") {
                return {
                  ...item,
                  data: { ...item.data, streamerIds: item.data.streamerIds.filter((sid) => sid !== key) },
                };
              }
              return item;
            })
            .filter((item) => !(item.type === "streamer" && toKey(item.data.platform, item.data.id) === key));

          const folders = state.folders.map((folder) => ({
            ...folder,
            streamerIds: folder.streamerIds.filter((sid) => sid !== key),
          }));

          return { followedStreamers, listOrder, folders };
        });
      },

      updateOrder(newList) {
        set((state) => ({
          followedStreamers: newList,
          listOrder: state.listOrder.every((item) => item.type === "streamer")
            ? newList.map((s) => ({ type: "streamer" as const, data: s }))
            : state.listOrder,
        }));
      },

      updateListOrder(newOrder) {
        set({ listOrder: newOrder });
      },

      updateStreamerDetails(updatedStreamer) {
        set((state) => {
          const followedStreamers = state.followedStreamers.map((s) =>
            s.platform === updatedStreamer.platform && s.id === updatedStreamer.id ? { ...s, ...updatedStreamer } : s
          );
          return { followedStreamers };
        });
      },

      replaceStreamerId(platform, oldId, newId) {
        const oldKey = toKey(platform, oldId);
        const newKey = toKey(platform, newId);
        set((state) => {
          const followedStreamers = state.followedStreamers.map((s) =>
            s.platform === platform && s.id === oldId ? { ...s, id: newId } : s
          );

          const listOrder = state.listOrder.map((item) => {
            if (item.type === "folder") {
              const ids = item.data.streamerIds.map((id) => (id === oldKey ? newKey : id));
              return { ...item, data: { ...item.data, streamerIds: ids } };
            }
            return item;
          });

          return { followedStreamers, listOrder };
        });
      },

      createFolder(name) {
        const id = `folder_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const folder: FollowFolder = { id, name: name.trim() || "未命名", streamerIds: [], expanded: true };
        set((state) => ({
          folders: [folder, ...state.folders],
          listOrder: [{ type: "folder", data: folder }, ...state.listOrder],
        }));
        return id;
      },

      renameFolder(folderId, newName) {
        const trimmedName = newName.trim();
        if (!trimmedName) return;
        set((state) => {
          const folders = state.folders.map((f) => (f.id === folderId ? { ...f, name: trimmedName } : f));
          const listOrder = state.listOrder.map((item) =>
            item.type === "folder" && item.data.id === folderId
              ? { ...item, data: { ...item.data, name: trimmedName } }
              : item
          );
          return { folders, listOrder };
        });
      },

      deleteFolder(folderId) {
        set((state) => {
          const folder = state.folders.find((f) => f.id === folderId);
          if (!folder) return state;
          const folderIndex = state.listOrder.findIndex((item) => item.type === "folder" && item.data.id === folderId);

          const listOrder = [...state.listOrder];
          if (folderIndex !== -1) {
            const streamerItems: FollowStreamerItem[] = folder.streamerIds
              .map((key) => {
                const [p, i] = key.split(":");
                const streamer = state.followedStreamers.find(
                  (s) => String(s.platform).toUpperCase() === String(p || "").toUpperCase() && s.id === i
                );
                return streamer ? ({ type: "streamer", data: streamer } as FollowStreamerItem) : null;
              })
              .filter((item): item is FollowStreamerItem => item !== null);

            listOrder.splice(folderIndex, 1, ...streamerItems);
          }

          return {
            folders: state.folders.filter((f) => f.id !== folderId),
            listOrder,
          };
        });
      },

      toggleFolderExpanded(folderId) {
        set((state) => {
          const target = state.folders.find((f) => f.id === folderId);
          if (!target) return state;
          const nextExpanded = !(target.expanded ?? true);
          const folders = state.folders.map((f) => (f.id === folderId ? { ...f, expanded: nextExpanded } : f));
          const listOrder = state.listOrder.map((item) =>
            item.type === "folder" && item.data.id === folderId
              ? { ...item, data: { ...item.data, expanded: nextExpanded } }
              : item
          );
          return { folders, listOrder };
        });
      },

      moveStreamerToFolder(streamerKey, folderId) {
        const [rawPlatform, rawId] = streamerKey.split(":");
        const normKey = `${String(rawPlatform || "").toUpperCase()}:${rawId}`;
        set((state) => {
          const folders = state.folders.map((folder) => {
            if (folder.id !== folderId) {
              return {
                ...folder,
                streamerIds: folder.streamerIds.filter((id) => {
                  const [p, i] = (id || "").split(":");
                  return `${String(p || "").toUpperCase()}:${i}` !== normKey;
                }),
              };
            }
            const nextIds = new Set(
              folder.streamerIds.map((id) => {
                const [p, i] = (id || "").split(":");
                return `${String(p || "").toUpperCase()}:${i}`;
              })
            );
            nextIds.add(normKey);
            return { ...folder, streamerIds: Array.from(nextIds), expanded: true };
          });

          const listOrder = state.listOrder.filter((item) => {
            if (item.type === "streamer") {
              const key = `${String(item.data.platform).toUpperCase()}:${item.data.id}`;
              return key !== normKey;
            }
            return true;
          }).map((item) =>
            item.type === "folder" && item.data.id === folderId
              ? {
                  ...item,
                  data: {
                    ...item.data,
                    streamerIds: folders.find((f) => f.id === folderId)?.streamerIds || item.data.streamerIds,
                    expanded: true,
                  },
                }
              : item
          );

          return { folders, listOrder };
        });
      },

      removeStreamerFromFolder(streamerKey, folderId) {
        const [rawPlatform, rawId] = streamerKey.split(":");
        const normKey = `${String(rawPlatform || "").toUpperCase()}:${rawId}`;

        set((state) => {
          const folders = state.folders.map((folder) => {
            if (folder.id !== folderId) return folder;
            return { ...folder, streamerIds: folder.streamerIds.filter((id) => id !== normKey) };
          });

          const folderIndex = state.listOrder.findIndex((item) => item.type === "folder" && item.data.id === folderId);
          const listOrder = state.listOrder.map((item) =>
            item.type === "folder" && item.data.id === folderId
              ? { ...item, data: { ...item.data, streamerIds: folders.find((f) => f.id === folderId)?.streamerIds || [] } }
              : item
          );

          if (folderIndex !== -1) {
            const platformUpper = String(rawPlatform || "").toUpperCase();
            const streamer = state.followedStreamers.find(
              (s) => String(s.platform).toUpperCase() === platformUpper && s.id === rawId
            );
            if (streamer) {
              const existsInList = listOrder.some(
                (item) =>
                  item.type === "streamer" &&
                  String(item.data.platform).toUpperCase() === platformUpper &&
                  item.data.id === streamer.id
              );
              if (!existsInList) {
                listOrder.splice(folderIndex + 1, 0, { type: "streamer", data: streamer });
              }
            }
          }

          return { folders, listOrder };
        });
      },

      isFollowed(platform, id) {
        const key = toKey(platform, id);
        return get().followedStreamers.some((s) => toKey(s.platform, s.id) === key);
      },

      getFollowedStreamers() {
        return get().followedStreamers;
      },
    }),
    {
      name: "follow-store",
      storage,
      partialize: (state) => ({
        followedStreamers: state.followedStreamers,
        folders: state.folders,
        listOrder: state.listOrder,
      }),
    }
  )
);
