import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { Platform } from "../types/app/platform";

export interface StreamerInfoState {
  roomId: string;
  platform: Platform;
  title: string;
  anchorName: string;
  avatar: string;
  isLive: boolean;
  isMuted?: boolean; // 新增：静音状态
}

export const usePlayerStore = defineStore("player", () => {
  // 使用 数组 存储多个活跃的直播间，以支持排序
  const activeStreamers = ref<StreamerInfoState[]>([]);
  
  // 最后一个激活的直播间 Key
  const lastActiveKey = ref<string | null>(null);
  
  // 分屏模式：4 | 6 | 9，默认为 4
  const gridMode = ref<number>(4);
  
  const getPlayerKey = (platform: string, roomId: string) => 
    `${platform.toUpperCase()}:${roomId}`;

  const currentStreamer = computed(() => {
    if (!lastActiveKey.value) return null;
    return activeStreamers.value.find(s => getPlayerKey(s.platform, s.roomId) === lastActiveKey.value) || null;
  });

  const isActive = computed(() => (platform: string, roomId: string) => {
    const key = getPlayerKey(platform, roomId);
    return activeStreamers.value.some(s => getPlayerKey(s.platform, s.roomId) === key);
  });

  const _saveToStorage = () => {
    localStorage.setItem("active_streamers_list", JSON.stringify(activeStreamers.value));
    localStorage.setItem("last_active_key", lastActiveKey.value || "");
    localStorage.setItem("player_grid_mode", String(gridMode.value));
  };

  const setGridMode = (mode: number) => {
    gridMode.value = mode;
    _saveToStorage();
  };

  const setStreamerInfo = (info: StreamerInfoState) => {
    const key = getPlayerKey(info.platform, info.roomId);
    const index = activeStreamers.value.findIndex(s => getPlayerKey(s.platform, s.roomId) === key);
    
    // 保留现有的静音状态
    const isMuted = index !== -1 ? activeStreamers.value[index].isMuted : false;
    const newInfo = { ...info, isMuted };

    if (index !== -1) {
      activeStreamers.value[index] = newInfo;
    } else {
      activeStreamers.value.push(newInfo);
    }
    
    lastActiveKey.value = key;
    _saveToStorage();
  };

  const removeStreamer = (platform: string, roomId: string) => {
    const key = getPlayerKey(platform, roomId);
    activeStreamers.value = activeStreamers.value.filter(s => getPlayerKey(s.platform, s.roomId) !== key);
    
    if (lastActiveKey.value === key) {
      lastActiveKey.value = activeStreamers.value.length > 0 
        ? getPlayerKey(activeStreamers.value[activeStreamers.value.length - 1].platform, activeStreamers.value[activeStreamers.value.length - 1].roomId) 
        : null;
    }
    _saveToStorage();
  };

  const updateActiveOrder = (newList: StreamerInfoState[]) => {
    activeStreamers.value = newList;
    _saveToStorage();
  };

  const clearAllStreamers = () => {
    activeStreamers.value = [];
    lastActiveKey.value = null;
    _saveToStorage();
  };

  const updateLiveStatus = (platform: string, roomId: string, isLive: boolean) => {
    const key = getPlayerKey(platform, roomId);
    const index = activeStreamers.value.findIndex(s => getPlayerKey(s.platform, s.roomId) === key);
    if (index !== -1) {
      activeStreamers.value[index].isLive = isLive;
      _saveToStorage();
    }
  };

  const toggleMute = (platform: string, roomId: string) => {
    const key = getPlayerKey(platform, roomId);
    const index = activeStreamers.value.findIndex(s => getPlayerKey(s.platform, s.roomId) === key);
    if (index !== -1) {
      activeStreamers.value[index].isMuted = !activeStreamers.value[index].isMuted;
      _saveToStorage();
    }
  };

  // 初始化从存储中恢复
  const restoreFromStorage = () => {
    try {
      const stored = localStorage.getItem("active_streamers_list");
      const lastKey = localStorage.getItem("last_active_key");
      const storedMode = localStorage.getItem("player_grid_mode");
      
      if (stored) {
        activeStreamers.value = JSON.parse(stored);
      }
      if (lastKey) {
        lastActiveKey.value = lastKey;
      }
      if (storedMode) {
        const mode = parseInt(storedMode, 10);
        if ([4, 6, 9].includes(mode)) {
          gridMode.value = mode;
        }
      }
    } catch (e) {
      console.error("[PlayerStore] Failed to restore state", e);
    }
  };

  restoreFromStorage();

  return {
    activeStreamers,
    currentStreamer,
    gridMode, // Export
    isActive, // 新增导出
    setStreamerInfo,
    removeStreamer,
    updateActiveOrder,
    clearAllStreamers,
    updateLiveStatus,
    toggleMute,
    setGridMode, // Export
  };
});
