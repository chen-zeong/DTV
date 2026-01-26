import { defineStore } from "pinia";
import type { FollowedStreamer } from "../types/models/streamer";
import { Platform } from "../types/app/platform";
import { refreshDouyuFollowedStreamer } from "../services/platforms/douyu/followListHelper";
import { refreshDouyinFollowedStreamer } from "../services/platforms/douyin/followListHelper";
import { getLiveStreamV2 } from "../api/live";

// 文件夹类型
export interface FollowFolder {
  id: string;
  name: string;
  streamerIds: string[]; // 格式: "platform:id"
  expanded?: boolean; // 是否展开，默认 true
}

// 关注列表项类型：仅存储引用 ID
export type FollowListOrderItem =
  | { type: "folder"; id: string }
  | { type: "streamer"; id: string }; // id 格式: "platform:id"

// 供组件渲染使用的完整对象类型
export type FollowListItem =
  | { type: "folder"; data: FollowFolder }
  | { type: "streamer"; data: FollowedStreamer };

interface FollowState {
  streamersMap: Record<string, FollowedStreamer>;
  foldersMap: Record<string, FollowFolder>;
  listOrder: FollowListOrderItem[]; // 混合列表顺序
  _snapshot?: {
    streamersMap: Record<string, FollowedStreamer>;
    foldersMap: Record<string, FollowFolder>;
    listOrder: FollowListOrderItem[];
  } | null;
}

const getStreamerKey = (platform: string, id: string) => 
  `${String(platform).toUpperCase()}:${id}`;

export const useFollowStore = defineStore("follow", {
  state: (): FollowState => ({
    streamersMap: {},
    foldersMap: {},
    listOrder: [], 
    _snapshot: null,
  }),
  getters: {
    followedStreamers: (state): FollowedStreamer[] => {
      return Object.values(state.streamersMap);
    },
    folders: (state): FollowFolder[] => {
      return Object.values(state.foldersMap);
    },
    isFollowed:
      (state: FollowState) =>
      (platform: Platform, id: string): boolean => {
        return !!state.streamersMap[getStreamerKey(platform, id)];
      },
    displayList: (state): FollowListItem[] => {
      return state.listOrder
        .map((item) => {
          if (item.type === "streamer") {
            const streamer = state.streamersMap[item.id];
            return streamer ? { type: "streamer" as const, data: streamer } : null;
          } else {
            const folder = state.foldersMap[item.id];
            return folder ? { type: "folder" as const, data: folder } : null;
          }
        })
        .filter((item): item is FollowListItem => item !== null);
    },
  },
  actions: {
    // 事务支持
    beginTransaction() {
      this._snapshot = {
        streamersMap: JSON.parse(JSON.stringify(this.streamersMap)),
        foldersMap: JSON.parse(JSON.stringify(this.foldersMap)),
        listOrder: JSON.parse(JSON.stringify(this.listOrder)),
      };
    },
    commitTransaction() {
      this._snapshot = null;
      this._saveAll();
    },
    rollbackTransaction() {
      if (!this._snapshot) return;
      this.streamersMap = this._snapshot.streamersMap;
      this.foldersMap = this._snapshot.foldersMap;
      this.listOrder = this._snapshot.listOrder;
      this._snapshot = null;
      this._saveAll();
    },

    _saveAll() {
      this._saveFollows();
      this._saveFolders();
      this._saveListOrder();
    },

    _saveFollows() {
      localStorage.setItem("followedStreamers", JSON.stringify(this.followedStreamers));
    },
    _saveFolders() {
      localStorage.setItem("followFolders", JSON.stringify(this.folders));
    },
    _saveListOrder() {
      localStorage.setItem("followListOrder", JSON.stringify(this.listOrder));
    },

    loadFollowedStreamers() {
      // 1. 加载主播并转换为 Map
      const storedFollows = localStorage.getItem("followedStreamers");
      if (storedFollows) {
        try {
          const list = JSON.parse(storedFollows) as FollowedStreamer[];
          this.streamersMap = list.reduce((acc, s) => {
            acc[getStreamerKey(s.platform, s.id)] = s;
            return acc;
          }, {} as Record<string, FollowedStreamer>);
        } catch (e) {
          console.error("Error parsing followedStreamers", e);
        }
      }

      // 2. 加载文件夹并转换为 Map
      const storedFolders = localStorage.getItem("followFolders");
      if (storedFolders) {
        try {
          const list = JSON.parse(storedFolders) as FollowFolder[];
          this.foldersMap = list.reduce((acc, f) => {
            acc[f.id] = f;
            return acc;
          }, {} as Record<string, FollowFolder>);
        } catch (e) {
          console.error("Error parsing followFolders", e);
        }
      }

      // 3. 加载列表顺序并迁移数据
      const storedOrder = localStorage.getItem("followListOrder");
      if (storedOrder) {
        try {
          const rawOrder = JSON.parse(storedOrder) as any[];
          // 数据迁移逻辑：如果旧数据中包含完整 data 对象，则提取 ID
          this.listOrder = rawOrder.map(item => {
            if (item.data && item.data.id) {
              if (item.type === 'streamer') {
                return { type: 'streamer', id: getStreamerKey(item.data.platform, item.data.id) };
              } else {
                return { type: 'folder', id: item.data.id };
              }
            }
            return item as FollowListOrderItem;
          });
        } catch (e) {
          console.error("Error parsing followListOrder", e);
          this.initializeListOrder();
        }
      } else {
        this.initializeListOrder();
      }
    },

    initializeListOrder() {
      this.listOrder = this.followedStreamers.map((s) => ({
        type: "streamer" as const,
        id: getStreamerKey(s.platform, s.id),
      }));
      this._saveListOrder();
    },

    followStreamer(streamer: FollowedStreamer) {
      const key = getStreamerKey(streamer.platform, streamer.id);
      if (!this.streamersMap[key]) {
        const newStreamer = {
          ...streamer,
          followedAt: streamer.followedAt || Date.now(),
        };
        this.streamersMap[key] = newStreamer;
        this.listOrder.push({ type: "streamer", id: key });
        this._saveFollows();
        this._saveListOrder();
      }
    },

    unfollowStreamer(platform: Platform, id: string) {
      const key = getStreamerKey(platform, id);
      if (this.streamersMap[key]) {
        delete this.streamersMap[key];
        // 从主列表移除
        this.listOrder = this.listOrder.filter(item => !(item.type === 'streamer' && item.id === key));
        // 从所有文件夹移除
        Object.values(this.foldersMap).forEach(folder => {
          folder.streamerIds = folder.streamerIds.filter(sid => sid !== key);
        });
        this._saveAll();
      }
    },

    updateLastViewed(platform: Platform, id: string) {
      const key = getStreamerKey(platform, id);
      if (this.streamersMap[key]) {
        this.streamersMap[key].lastViewedAt = Date.now();
        this._saveFollows();
      }
    },

    updateStreamerDetails(updated: Partial<FollowedStreamer> & { platform: Platform; id: string }) {
      const key = getStreamerKey(updated.platform, updated.id);
      if (this.streamersMap[key]) {
        this.streamersMap[key] = { ...this.streamersMap[key], ...updated };
        this._saveFollows();
      }
    },

    createFolder(name: string): string {
      const id = `folder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const folder: FollowFolder = { id, name, streamerIds: [], expanded: true };
      this.foldersMap[id] = folder;
      this.listOrder.unshift({ type: "folder", id });
      this._saveFolders();
      this._saveListOrder();
      return id;
    },

    renameFolder(folderId: string, newName: string) {
      if (this.foldersMap[folderId]) {
        this.foldersMap[folderId].name = newName.trim();
        this._saveFolders();
      }
    },

    deleteFolder(folderId: string) {
      const folder = this.foldersMap[folderId];
      if (!folder) return;

      const orderIndex = this.listOrder.findIndex(item => item.type === 'folder' && item.id === folderId);
      if (orderIndex !== -1) {
        // 展开文件夹内容到主列表
        const streamerItems = folder.streamerIds.map(id => ({ type: 'streamer' as const, id }));
        this.listOrder.splice(orderIndex, 1, ...streamerItems);
      }

      delete this.foldersMap[folderId];
      this._saveFolders();
      this._saveListOrder();
    },

    toggleFolderExpanded(folderId: string) {
      if (this.foldersMap[folderId]) {
        this.foldersMap[folderId].expanded = !this.foldersMap[folderId].expanded;
        this._saveFolders();
      }
    },

    moveStreamerToFolder(streamerKey: string, folderId: string) {
      const targetFolder = this.foldersMap[folderId];
      if (!targetFolder) return;

      // 1. 从其他文件夹移除
      Object.values(this.foldersMap).forEach(f => {
        f.streamerIds = f.streamerIds.filter(id => id !== streamerKey);
      });

      // 2. 加入目标文件夹 (去重)
      if (!targetFolder.streamerIds.includes(streamerKey)) {
        targetFolder.streamerIds.push(streamerKey);
      }

      // 3. 从主列表移除
      this.listOrder = this.listOrder.filter(item => !(item.type === 'streamer' && item.id === streamerKey));
      
      this._saveFolders();
      this._saveListOrder();
    },

    removeStreamerFromFolder(streamerKey: string, folderId: string) {
      const folder = this.foldersMap[folderId];
      if (!folder) return;

      folder.streamerIds = folder.streamerIds.filter(id => id !== streamerKey);
      
      // 添加回主列表（紧跟在文件夹后面）
      const folderIndex = this.listOrder.findIndex(item => item.type === 'folder' && item.id === folderId);
      if (folderIndex !== -1) {
        this.listOrder.splice(folderIndex + 1, 0, { type: 'streamer', id: streamerKey });
      }

      this._saveFolders();
      this._saveListOrder();
    },

    updateListOrder(newOrder: FollowListOrderItem[]) {
      this.listOrder = newOrder;
      this._saveListOrder();
    },

    async retryStreamer(platform: Platform, id: string) {
      const streamer = this.streamersMap[getStreamerKey(platform, id)];
      if (!streamer) return;
      
      try {
        let update: Partial<FollowedStreamer> = {
          lastUpdateFailed: false,
          lastError: undefined
        };
        
        if (streamer.platform === Platform.DOUYU) {
          update = { ...update, ...await refreshDouyuFollowedStreamer(streamer) };
        } else if (streamer.platform === Platform.DOUYIN) {
          update = { ...update, ...await refreshDouyinFollowedStreamer(streamer) };
        } else if (streamer.platform === Platform.HUYA || streamer.platform === Platform.BILIBILI) {
          const resp = await getLiveStreamV2({
            platform: streamer.platform.toLowerCase() as any,
            room_id: streamer.id,
            mode: "meta",
          });
          if (resp.status === "error") throw new Error(resp.error || "Unknown error");
          
          const live = resp.status === "live";
          update = {
            ...update,
            liveStatus: live ? "LIVE" : "OFFLINE",
            isLive: live,
            nickname: resp.room?.anchor_name || streamer.nickname,
            roomTitle: resp.room?.title || streamer.roomTitle,
            avatarUrl: resp.room?.avatar || streamer.avatarUrl,
          };
        }

        this.updateStreamerDetails({
          ...update,
          platform: streamer.platform,
          id: streamer.id,
        });
      } catch (e: any) {
        this.updateStreamerDetails({
          platform: streamer.platform,
          id: streamer.id,
          lastUpdateFailed: true,
          lastError: e.message || String(e)
        });
      }
    },

    async refreshAll(priorityIds: string[] = []) {
      const allStreamers = this.followedStreamers;
      
      // Sort: Priority IDs first, then others
      const prioritySet = new Set(priorityIds);
      const priorityItems: FollowedStreamer[] = [];
      const otherItems: FollowedStreamer[] = [];
      
      allStreamers.forEach(s => {
        const key = getStreamerKey(s.platform, s.id);
        if (prioritySet.has(key)) {
          priorityItems.push(s);
        } else {
          otherItems.push(s);
        }
      });

      const items = [...priorityItems, ...otherItems];
      const CONCURRENCY = 3;
      let cursor = 0;

      const worker = async () => {
        while (cursor < items.length) {
          const streamer = items[cursor++];
          try {
            let update: Partial<FollowedStreamer> = {
              lastUpdateFailed: false,
              lastError: undefined
            };
            
            if (streamer.platform === Platform.DOUYU) {
              update = { ...update, ...await refreshDouyuFollowedStreamer(streamer) };
            } else if (streamer.platform === Platform.DOUYIN) {
              update = { ...update, ...await refreshDouyinFollowedStreamer(streamer) };
            } else if (streamer.platform === Platform.HUYA) {
              const resp = await getLiveStreamV2({
                platform: "huya",
                room_id: streamer.id,
                mode: "meta",
              });
              if (resp.status === "error") throw new Error(resp.error || "Unknown error");
              
              const live = resp.status === "live";
              update = {
                ...update,
                liveStatus: live ? "LIVE" : "OFFLINE",
                isLive: live,
                nickname: resp.room?.anchor_name || streamer.nickname,
                roomTitle: resp.room?.title || streamer.roomTitle,
              };
            } else if (streamer.platform === Platform.BILIBILI) {
              const resp = await getLiveStreamV2({
                platform: "bilibili",
                room_id: streamer.id,
                mode: "meta",
              });
              if (resp.status === "error") throw new Error(resp.error || "Unknown error");

              const isLive = resp.status === "live";
              update = {
                ...update,
                liveStatus: isLive ? "LIVE" : "OFFLINE",
                isLive: isLive,
                nickname: resp.room?.anchor_name || streamer.nickname,
                roomTitle: resp.room?.title || streamer.roomTitle,
              };
            }

            this.updateStreamerDetails({
              ...update,
              platform: streamer.platform,
              id: streamer.id,
            });
          } catch (e: any) {
            console.error(`Failed to refresh ${streamer.id}`, e);
            this.updateStreamerDetails({
              platform: streamer.platform,
              id: streamer.id,
              lastUpdateFailed: true,
              lastError: e.message || String(e)
            });
          }
        }
      };

      const workers = Array(Math.min(CONCURRENCY, items.length)).fill(null).map(() => worker());
      await Promise.all(workers);
    },
  },
});