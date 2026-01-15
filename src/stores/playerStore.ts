import { defineStore } from "pinia";
import { ref } from "vue";
import type { Platform } from "../platforms/common/types";

export interface StreamerInfoState {
  roomId: string;
  platform: Platform;
  title: string;
  anchorName: string;
  avatar: string;
  isLive: boolean;
}

export const usePlayerStore = defineStore("player", () => {
  const currentStreamer = ref<StreamerInfoState | null>(null);

  const setStreamerInfo = (info: StreamerInfoState) => {
    currentStreamer.value = info;
  };

  const clearStreamerInfo = () => {
    currentStreamer.value = null;
  };

  const updateLiveStatus = (isLive: boolean) => {
    if (currentStreamer.value) {
      currentStreamer.value.isLive = isLive;
    }
  };

  return {
    currentStreamer,
    setStreamerInfo,
    clearStreamerInfo,
    updateLiveStatus,
  };
});
