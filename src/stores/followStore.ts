import { defineStore } from 'pinia';
import type { FollowedStreamer, Platform } from '../platforms/common/types';

// 文件夹类型
export interface FollowFolder {
  id: string;
  name: string;
  streamerIds: string[]; // 格式: "platform:id"
  expanded?: boolean; // 是否展开，默认 true
}

// 关注列表项类型：可以是文件夹或主播
export type FollowListItem = 
  | { type: 'folder'; data: FollowFolder }
  | { type: 'streamer'; data: FollowedStreamer };

type FollowStreamerItem = Extract<FollowListItem, { type: 'streamer' }>;

interface FollowState {
  followedStreamers: FollowedStreamer[];
  folders: FollowFolder[];
  listOrder: FollowListItem[]; // 混合列表，包含文件夹和主播的顺序
  _snapshot?: {
    followedStreamers: FollowedStreamer[];
    folders: FollowFolder[];
    listOrder: FollowListItem[];
  } | null;
}

export const useFollowStore = defineStore('follow', {
  state: (): FollowState => ({
    followedStreamers: [], // Initialize with an empty array or load from localStorage
    folders: [],
    listOrder: [], // 混合列表顺序
    _snapshot: null,
  }),
  getters: {
    isFollowed: (state: FollowState) => (platform: Platform, id: string): boolean => {
      return state.followedStreamers.some((s: FollowedStreamer) => s.platform === platform && s.id === id);
    },
    getFollowedStreamers: (state: FollowState): FollowedStreamer[] => {
      return state.followedStreamers;
    }
  },
  actions: {
    // 事务：用于拖拽等需要一致性保障的操作
    beginTransaction() {
      this._snapshot = {
        followedStreamers: JSON.parse(JSON.stringify(this.followedStreamers)),
        folders: JSON.parse(JSON.stringify(this.folders)),
        listOrder: JSON.parse(JSON.stringify(this.listOrder)),
      };
    },
    commitTransaction() {
      this._snapshot = null;
      this._saveFollows();
      this._saveFolders();
      this._saveListOrder();
    },
    rollbackTransaction() {
      if (!this._snapshot) return;
      this.followedStreamers = this._snapshot.followedStreamers;
      this.folders = this._snapshot.folders;
      this.listOrder = this._snapshot.listOrder;
      this._snapshot = null;
      this._saveFollows();
      this._saveFolders();
      this._saveListOrder();
    },
    // Action to load followed streamers, e.g., from localStorage
    loadFollowedStreamers() {
      const storedFollows = localStorage.getItem('followedStreamers');
      if (storedFollows) {
        try {
          this.followedStreamers = JSON.parse(storedFollows) as FollowedStreamer[];
        } catch (e) {
          console.error('Error parsing followedStreamers from localStorage', e);
          this.followedStreamers = [];
        }
      }
      
      // 加载文件夹数据
      const storedFolders = localStorage.getItem('followFolders');
      if (storedFolders) {
        try {
          this.folders = JSON.parse(storedFolders) as FollowFolder[];
        } catch (e) {
          console.error('Error parsing followFolders from localStorage', e);
          this.folders = [];
        }
      }
      
      // 加载列表顺序
      const storedOrder = localStorage.getItem('followListOrder');
      if (storedOrder) {
        try {
          this.listOrder = JSON.parse(storedOrder) as FollowListItem[];
        } catch (e) {
          console.error('Error parsing followListOrder from localStorage', e);
          this.initializeListOrder();
        }
      } else {
        this.initializeListOrder();
      }
    },
    
    // 初始化列表顺序：将所有主播项加入列表（公开方法）
    initializeListOrder() {
      if (this.followedStreamers.length === 0) {
        this.listOrder = [];
        return;
      }
      this.listOrder = this.followedStreamers.map(s => ({
        type: 'streamer' as const,
        data: s,
      }));
      this._saveListOrder();
    },
    
    // Action to save followed streamers
    _saveFollows() {
      try {
        localStorage.setItem('followedStreamers', JSON.stringify(this.followedStreamers));
      } catch (e) {
        console.error('Error saving followedStreamers to localStorage', e);
      }
    },
    
    // 保存文件夹数据
    _saveFolders() {
      try {
        localStorage.setItem('followFolders', JSON.stringify(this.folders));
      } catch (e) {
        console.error('Error saving followFolders to localStorage', e);
      }
    },
    
    // 保存列表顺序
    _saveListOrder() {
      try {
        localStorage.setItem('followListOrder', JSON.stringify(this.listOrder));
      } catch (e) {
        console.error('Error saving followListOrder to localStorage', e);
      }
    },
    followStreamer(streamer: FollowedStreamer) {
      if (!this.isFollowed(streamer.platform, streamer.id)) {
        this.followedStreamers.push(streamer);
        // 添加到列表末尾
        this.listOrder.push({ type: 'streamer', data: streamer });
        this._saveFollows();
        this._saveListOrder();
      }
    },
    unfollowStreamer(platform: Platform, id: string) {
      const index = this.followedStreamers.findIndex((s: FollowedStreamer) => s.platform === platform && s.id === id);
      if (index !== -1) {
        this.followedStreamers.splice(index, 1);
        // 从列表顺序中移除
        const key = `${platform}:${id}`;
        this.listOrder = this.listOrder.filter(item => {
          if (item.type === 'streamer') {
            return `${item.data.platform}:${item.data.id}` !== key;
          }
          // 如果是文件夹，也要从中移除
          if (item.type === 'folder') {
            item.data.streamerIds = item.data.streamerIds.filter(sid => sid !== key);
          }
          return true;
        });
        // 清理所有文件夹中的引用
        this.folders.forEach(folder => {
          folder.streamerIds = folder.streamerIds.filter(sid => sid !== key);
        });
        this._saveFollows();
        this._saveFolders();
        this._saveListOrder();
      }
    },
    // Action to update the order of followed streamers (e.g., after drag-and-drop)
    // 注意：这个方法是为了向后兼容，新的实现应该使用 updateListOrder
    updateOrder(newList: FollowedStreamer[]) {
      this.followedStreamers = newList;
      // 如果列表顺序中只有主播项，则更新它
      if (this.listOrder.every(item => item.type === 'streamer')) {
        this.listOrder = newList.map(s => ({ type: 'streamer' as const, data: s }));
        this._saveListOrder();
      }
      this._saveFollows();
    },
    // You might also need an action to update details of a followed streamer (e.g., live status)
    updateStreamerDetails(updatedStreamer: Partial<FollowedStreamer> & { platform: Platform; id: string }) {
      const index = this.followedStreamers.findIndex((s: FollowedStreamer) => s.platform === updatedStreamer.platform && s.id === updatedStreamer.id);
      if (index !== -1) {
        this.followedStreamers[index] = { ...this.followedStreamers[index], ...updatedStreamer };
        this._saveFollows();
      }
    },
    // Replace a followed streamer's ID (used for Douyin webRid -> room_id migration)
    replaceStreamerId(platform: Platform, oldId: string, newId: string) {
      const index = this.followedStreamers.findIndex((s: FollowedStreamer) => s.platform === platform && s.id === oldId);
      if (index !== -1) {
        this.followedStreamers[index] = { ...this.followedStreamers[index], id: newId } as FollowedStreamer;
        this._saveFollows();
        
        // 更新列表顺序中的引用
        const oldKey = `${platform}:${oldId}`;
        const newKey = `${platform}:${newId}`;
        this.listOrder = this.listOrder.map(item => {
          if (item.type === 'folder') {
            const folder = { ...item.data };
            const idx = folder.streamerIds.indexOf(oldKey);
            if (idx !== -1) {
              folder.streamerIds = [...folder.streamerIds];
              folder.streamerIds[idx] = newKey;
            }
            return { type: 'folder' as const, data: folder };
          }
          return item;
        });
        this._saveListOrder();
      }
    },
    
    // 文件夹相关操作
    createFolder(name: string): string {
      const id = `folder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const folder: FollowFolder = {
        id,
        name,
        streamerIds: [],
        expanded: true,
      };
      this.folders.unshift(folder);
      // 添加到列表顶部
      this.listOrder.unshift({ type: 'folder', data: folder });
      this._saveFolders();
      this._saveListOrder();
      return id;
    },
    
    renameFolder(folderId: string, newName: string) {
      const folder = this.folders.find(f => f.id === folderId);
      if (!folder) return;
      
      // 验证新名称
      const trimmedName = newName.trim();
      if (!trimmedName) {
        console.warn('Folder name cannot be empty');
        return;
      }
      
      // 更新文件夹名称
      folder.name = trimmedName;
      
      // 更新列表顺序中的引用（确保引用的是同一个对象）
      const itemIndex = this.listOrder.findIndex(item => item.type === 'folder' && item.data.id === folderId);
      if (itemIndex !== -1) {
        const item = this.listOrder[itemIndex];
        if (item.type === 'folder') {
          // 直接更新引用对象的属性，这样 Vue 响应式系统能够检测到变化
          item.data.name = trimmedName;
        }
      }
      
      this._saveFolders();
      this._saveListOrder();
    },
    
    deleteFolder(folderId: string) {
      const folder = this.folders.find(f => f.id === folderId);
      if (!folder) return;
      
      // 将文件夹中的主播移回主列表
      const folderIndex = this.listOrder.findIndex(item => item.type === 'folder' && item.data.id === folderId);
      if (folderIndex !== -1) {
        // 在文件夹位置插入其包含的主播项
        const streamerItems: FollowStreamerItem[] = folder.streamerIds
          .map(key => {
            const [platform, id] = key.split(':');
            const streamer = this.followedStreamers.find(s => s.platform === platform as Platform && s.id === id);
            return streamer ? ({ type: 'streamer' as const, data: streamer } as FollowStreamerItem) : null;
          })
          .filter((item): item is FollowStreamerItem => item !== null);
        
        this.listOrder.splice(folderIndex, 1, ...streamerItems);
      }
      
      // 删除文件夹
      this.folders = this.folders.filter(f => f.id !== folderId);
      this._saveFolders();
      this._saveListOrder();
    },
    
    toggleFolderExpanded(folderId: string) {
      const folder = this.folders.find(f => f.id === folderId);
      if (folder) {
        folder.expanded = !folder.expanded;
        this._saveFolders();
      }
    },
    
    // 将主播移入文件夹
    moveStreamerToFolder(streamerKey: string, folderId: string) {
      // 规范化 key（平台转大写字符串，id 原样）
      const [rawPlatform, rawId] = streamerKey.split(':');
      const normKey = `${String(rawPlatform || '').toUpperCase()}:${rawId}`;
      const targetFolder = this.folders.find(f => f.id === folderId);
      if (!targetFolder) return;

      // 全局唯一：先从其它文件夹中移除该主播，避免交叉管理导致的覆盖/消失
      this.folders.forEach(f => {
        if (f.id !== folderId) {
          f.streamerIds = f.streamerIds.filter(id => {
            const [p, i] = (id || '').split(':');
            const nk = `${String(p || '').toUpperCase()}:${i}`;
            return nk !== normKey;
          });
        }
      });

      // 目标文件夹合并去重（集合语义）
      const nextIdsSet = new Set<string>();
      for (const id of targetFolder.streamerIds) {
        const [p, i] = (id || '').split(':');
        const canon = `${String(p || '').toUpperCase()}:${i}`;
        nextIdsSet.add(canon);
      }
      nextIdsSet.add(normKey);
      targetFolder.streamerIds = Array.from(nextIdsSet);
      // 从主列表中移除该项
      this.listOrder = this.listOrder.filter(item => {
        if (item.type === 'streamer') {
          const key = `${String(item.data.platform).toUpperCase()}:${item.data.id}`;
          return key !== normKey;
        }
        return true;
      });
      this._saveFolders();
      this._saveListOrder();
    },
    
    // 将主播从文件夹移出
    removeStreamerFromFolder(streamerKey: string, folderId: string) {
      const [rawPlatform, rawId] = streamerKey.split(':');
      const normKey = `${String(rawPlatform || '').toUpperCase()}:${rawId}`;
      const folder = this.folders.find(f => f.id === folderId);
      if (!folder) return;
      
      folder.streamerIds = folder.streamerIds.filter(id => {
        const [p, i] = (id || '').split(':');
        const nk = `${String(p || '').toUpperCase()}:${i}`;
        return nk !== normKey;
      });
      // 将主播添加回主列表（在文件夹后面）
      const folderIndex = this.listOrder.findIndex(item => item.type === 'folder' && item.data.id === folderId);
      if (folderIndex !== -1) {
        const platformUpper = String(rawPlatform || '').toUpperCase();
        const id = rawId;
        const streamer = this.followedStreamers.find(s => String(s.platform).toUpperCase() === platformUpper && s.id === id);
        if (streamer) {
          // 若已存在于主列表则不重复插入
          const existsInList = this.listOrder.some(item => item.type === 'streamer' && String(item.data.platform).toUpperCase() === String(streamer.platform).toUpperCase() && item.data.id === streamer.id);
          if (!existsInList) {
            this.listOrder.splice(folderIndex + 1, 0, { type: 'streamer', data: streamer });
          }
        }
      }
      this._saveFolders();
      this._saveListOrder();
    },
    
    // 更新列表顺序（包括文件夹和主播）
    updateListOrder(newOrder: FollowListItem[]) {
      this.listOrder = newOrder;
      this._saveListOrder();
    },
  },
});
