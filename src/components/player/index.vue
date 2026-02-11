<template>
  <div class="player-page" :class="{ 'web-fs': isInWebFullscreen || isInNativePlayerFullscreen }">
    <button v-if="!isInWebFullscreen" @click="handleClosePlayerClick" class="player-close-btn" title="关闭播放器">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>

    <div class="player-layout">
      <div class="main-content">
        <div v-if="!roomId" class="empty-player">
          <div class="empty-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
               <circle cx="12" cy="12" r="10"></circle>
               <line x1="12" y1="16" x2="12" y2="12"></line>
               <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
          </div>
          <h3>未选择直播间</h3>
          <p>请从首页选择一个直播间开始观看。</p>
        </div>
        <div v-else-if="isLoadingStream" class="loading-player">
          <LoadingDots />
        </div>
        <div v-else-if="isOfflineError" class="offline-player">
          <!-- Display StreamerInfo if room details are available -->
          <StreamerInfo 
            v-if="props.roomId && props.platform"
            :room-id="props.roomId"
            :platform="props.platform"
            :title="playerTitle"
            :anchor-name="playerAnchorName"
            :avatar="playerAvatar"
            :is-live="false"
            :is-followed="props.isFollowed"
            @follow="$emit('follow', $event)"
            @unfollow="$emit('unfollow', $event)"
            @details="handleStreamerDetails"
            class="streamer-info-offline"
          />
          <div class="offline-message">
            <div class="offline-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 16.427A4.002 4.002 0 0 0 12.005 20a4 4 0 0 0-3.995-3.573M12 12V2M8.5 7L7 5.5M15.5 7l1.5-1.5M5.562 10.223l-1.842.511M18.438 10.223l1.842.511M12 2a3.5 3.5 0 0 1 3.5 3.5V12H8.5V5.5A3.5 3.5 0 0 1 12 2z"/>
                <line x1="1" y1="1" x2="23" y2="23" stroke-width="2"></line> 
              </svg>
            </div>
            <h3>😴 获取直播流失败了</h3>
            <p>主播当前未开播，请稍后再来。</p>
            <button @click="retryInitialization" class="retry-btn">再试一次</button>
          </div>
        </div>
        <div v-else-if="streamError && !isOfflineError" class="error-player">
          <div class="error-icon">
             <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          </div>
          <h3>加载失败</h3>
          <p>{{ streamError }}</p>
          <button @click="retryInitialization" class="retry-btn">再试一次</button>
        </div>
        <div v-else class="player-container">
          <StreamerInfo
            v-if="props.roomId"
            :room-id="props.roomId"
            :platform="props.platform"
            :title="playerTitle"
            :anchor-name="playerAnchorName"
            :avatar="playerAvatar"
            :is-followed="props.isFollowed"
            :is-live="playerIsLive"
            @follow="$emit('follow', $event)"
            @unfollow="$emit('unfollow', $event)"
            @details="handleStreamerDetails"
            class="streamer-info"
            v-show="!isInWebFullscreen && !isDanmuCollapsed"
            :class="{'hidden-panel': isInWebFullscreen}"
          />
          <div class="video-container">
            <div ref="playerContainerRef" class="video-player"></div>
          </div>
        </div>
      </div>

      <DanmuList 
        v-if="roomId && !isLoadingStream && !streamError && isDanmuVisible" 
        :room-id="props.roomId"
        :messages="danmakuMessages"
        v-show="!isFullScreen" 
        class="danmu-panel" 
        :class="{'hidden-panel': isFullScreen}"
        ref="danmuListRef"
      >
        <template #actions>
          <div
            v-if="canToggleDanmuPanel && !isDanmuCollapsed && !isFullScreen"
            class="danmu-panel-actions"
          >
            <button
              type="button"
              class="danmu-filter-toggle-btn"
              title="屏蔽关键词"
              @click="toggleDanmuFilterPanel"
            >
              <Funnel :size="18" />
            </button>
            <button
              type="button"
              class="danmu-collapse-btn"
              title="折叠弹幕列表"
              @click="collapseDanmuPanel"
            >
              <PanelRightClose :size="22" />
            </button>
          </div>
        </template>
      </DanmuList>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue';
import Player from 'xgplayer';
import FlvPlugin from 'xgplayer-flv';
import HlsPlugin from 'xgplayer-hls.js';
import { POSITIONS } from 'xgplayer/es/plugin/plugin.js';
import { Funnel, PanelRightClose } from 'lucide-vue-next';
import 'xgplayer/dist/index.min.css';

import './player.css';

import { Platform as StreamingPlatform } from '../../platforms/common/types';
import type { DanmakuMessage, DanmuOverlayInstance } from './types';
import {
  applyDanmuFontFamilyForOS,
  ICONS,
  loadDanmuPreferences,
  loadStoredVolume,
  persistDanmuPreferences,
  sanitizeDanmuArea,
  sanitizeDanmuOpacity,
  type DanmuUserSettings,
} from './constants';
import {
  DanmuSettingsControl,
  DanmuToggleControl,
  LineControl,
  QualityControl,
  RefreshControl,
  VolumeControl,
} from './plugins';
import { arrangeControlClusters } from './controlLayout';
import { applyDanmuOverlayPreferences, createDanmuOverlay, ensureDanmuOverlayHost, syncDanmuEnabledState } from './danmuOverlay';
import { registerPlayerWatchers, type PlayerProps } from './watchers';
import { startCurrentDanmakuListener as startDanmakuListener, stopCurrentDanmakuListener as stopDanmakuListener } from './danmakuManager';
import { getLineLabel, getLineOptionsForPlatform, persistLinePreference, resolveCurrentLineFor, resolveStoredLine } from './lineOptions';

// Platform-specific player helpers
import { getDouyuStreamConfig, stopDouyuProxy } from '../../platforms/douyu/playerHelper';
import { fetchAndPrepareDouyinStreamConfig } from '../../platforms/douyin/playerHelper';
import { getHuyaStreamConfig } from '../../platforms/huya/playerHelper';
import { getBilibiliStreamConfig } from '../../platforms/bilibili/playerHelper';

import StreamerInfo from '../StreamerInfo/index.vue';
import DanmuList from '../DanmuList/index.vue';
import LoadingDots from '../Common/LoadingDots.vue';

import { invoke } from '@tauri-apps/api/core';
import { useImageProxy } from '../FollowsList/useProxy';

// Ensure image proxy helpers are available in this component
const { ensureProxyStarted, proxify } = useImageProxy();

const props = defineProps<PlayerProps>();

const emit = defineEmits<{
  (e: 'follow', streamer: any): void;
  (e: 'unfollow', roomId: string): void;
  (e: 'close-player'): void;
  (e: 'fullscreen-change', isFullscreen: boolean): void;
  (e: 'request-refresh-details'): void;
  (e: 'request-player-reload'): void;
}>();

const isClosing = ref(false);
const MIN_DANMU_WIDTH = 1100;
const DANMU_COLLAPSED_STORAGE_KEY = 'dtv_player_danmu_collapsed';
const PLAYER_ISLAND_EVENT = 'dtv-player-island-state';
const PLAYER_ISLAND_EXPAND_EVENT = 'dtv-player-island-expand';
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 0);
const updateWindowWidth = () => {
  windowWidth.value = typeof window !== 'undefined' ? window.innerWidth : 0;
};
const showDanmuPanel = computed(() => windowWidth.value >= MIN_DANMU_WIDTH);
const isDanmuCollapsed = ref(
  typeof window !== 'undefined' && window.localStorage.getItem(DANMU_COLLAPSED_STORAGE_KEY) === '1',
);
const canToggleDanmuPanel = computed(() => showDanmuPanel.value && !!props.roomId && !isLoadingStream.value && !streamError.value);
const isDanmuVisible = computed(() => canToggleDanmuPanel.value && !isDanmuCollapsed.value);
const showCompactIsland = computed(() => isDanmuCollapsed.value && canToggleDanmuPanel.value && !isFullScreen.value);

const collapseDanmuPanel = () => {
  isDanmuCollapsed.value = true;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(DANMU_COLLAPSED_STORAGE_KEY, '1');
  }
};

const expandDanmuPanel = () => {
  isDanmuCollapsed.value = false;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(DANMU_COLLAPSED_STORAGE_KEY, '0');
  }
};

const toggleDanmuFilterPanel = () => {
  danmuListRef.value?.toggleFilterPanel?.();
};

const broadcastIslandState = () => {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(PLAYER_ISLAND_EVENT, {
    detail: {
      visible: showCompactIsland.value,
      anchorName: playerAnchorName.value ?? '',
      title: playerTitle.value ?? '',
      avatarUrl: playerAvatar.value ?? null,
      roomId: props.roomId ?? null,
      platform: props.platform ?? null,
    },
  }));
};

const playerContainerRef = ref<HTMLDivElement | null>(null);
const danmuListRef = ref<{ toggleFilterPanel?: () => void } | null>(null);
const playerInstance = shallowRef<Player | null>(null);
const refreshControlPlugin = shallowRef<RefreshControl | null>(null);
const qualityControlPlugin = shallowRef<QualityControl | null>(null);
const lineControlPlugin = shallowRef<LineControl | null>(null);
const danmuTogglePlugin = shallowRef<DanmuToggleControl | null>(null);
const danmuSettingsPlugin = shallowRef<DanmuSettingsControl | null>(null);
const volumeControlPlugin = shallowRef<VolumeControl | null>(null);
const danmuInstance = shallowRef<DanmuOverlayInstance | null>(null);
const danmakuMessages = ref<DanmakuMessage[]>([]);
const isDanmakuListenerActive = ref(false); // Tracks if a danmaku listener is supposed to be running
const unlistenDanmakuFn = ref<(() => void) | null>(null);

const isLoadingStream = ref(true);
const streamError = ref<string | null>(null);
const isOfflineError = ref(false); // Added to track '主播未开播' state

// Reactive state for streamer info, initialized by props, potentially updated by internal fetches (for Douyin)
const playerTitle = ref(props.title);
const playerAnchorName = ref(props.anchorName);
const playerAvatar = ref(props.avatar);
const playerIsLive = ref(props.isLive);

const isInNativePlayerFullscreen = ref(false); // New: Tracks Artplayer element's native fullscreen
const isInWebFullscreen = ref(false);
const isFullScreen = ref(false); // True if EITHER native player OR web fullscreen is active

const isDanmuEnabled = ref(true);
const danmuSettings = reactive<DanmuUserSettings>({
  color: '#ffffff',
  strokeColor: '#444444',
  fontSize: '20px',
  duration: 10000,
  area: 0.5,
  mode: 'scroll',
  opacity: 1,
});

const storedDanmuPreferences = loadDanmuPreferences();
if (storedDanmuPreferences) {
  isDanmuEnabled.value = storedDanmuPreferences.enabled;
  Object.assign(danmuSettings, storedDanmuPreferences.settings);
}

// OS specific states
const osName = ref<string>('');

// 画质切换相关
const qualityOptions = ['原画', '高清', '标清'] as const;

const resolveStoredQuality = (platform?: StreamingPlatform | null): string => {
  if (!platform) {
    return '原画';
  }
  if (typeof window === 'undefined') {
    return '原画';
  }
  try {
    const saved = window.localStorage.getItem(`${platform}_preferred_quality`);
    if (saved && qualityOptions.includes(saved as (typeof qualityOptions)[number])) {
      return saved;
    }
  } catch (error) {
    console.warn('[Player] Failed to read stored quality preference:', error);
  }
  return '原画';
};

const currentQuality = ref<string>(resolveStoredQuality(props.platform));
const isQualitySwitching = ref(false);
const isRefreshingStream = ref(false);
const isLineSwitching = ref(false);

const currentLine = ref<string | null>(resolveStoredLine(props.platform));
const lineOptions = computed(() => getLineOptionsForPlatform(props.platform));
const getCurrentLineLabel = (key?: string | null) => getLineLabel(lineOptions.value, key);

const handleStreamerDetails = (payload: { title: string; nickname: string; avatarUrl: string | null; isLive: boolean | null }) => {
  if (payload.title) {
    playerTitle.value = payload.title;
  }
  if (payload.nickname) {
    playerAnchorName.value = payload.nickname;
  }
  playerAvatar.value = payload.avatarUrl ?? playerAvatar.value ?? null;
  if (typeof payload.isLive === 'boolean') {
    playerIsLive.value = payload.isLive;
  }
};

function resetFullscreenState() {
  isInNativePlayerFullscreen.value = false;
  isInWebFullscreen.value = false;
  isFullScreen.value = false;
  try {
    document.documentElement.classList.remove('web-fs-active');
  } catch (error) {
    console.warn('[Player] Failed to reset web fullscreen flag:', error);
  }
}

function updateFullscreenFlag() {
  if (isClosing.value) {
    return;
  }
  isFullScreen.value = isInNativePlayerFullscreen.value || isInWebFullscreen.value;
  emit('fullscreen-change', isFullScreen.value);
}

function destroyPlayerInstance() {
  const player = playerInstance.value;
  if (player) {
    try {
      player.destroy();
    } catch (error) {
      console.error('[Player] Error destroying xgplayer instance:', error);
    }
    const overlayHost = player.root?.querySelector('.player-danmu-overlay') as HTMLElement | null;
    overlayHost?.remove();
  }
  playerInstance.value = null;

  const danmu = danmuInstance.value;
  if (danmu) {
    try {
      danmu.stop?.();
    } catch (error) {
      console.error('[Player] Error stopping danmu overlay:', error);
    }
    danmuInstance.value = null;
  }

  refreshControlPlugin.value = null;
  qualityControlPlugin.value = null;
  lineControlPlugin.value = null;
  danmuTogglePlugin.value = null;
  danmuSettingsPlugin.value = null;
  volumeControlPlugin.value = null;

  resetFullscreenState();
}

async function mountXgPlayer(
  streamUrl: string,
  platformCode: StreamingPlatform,
  roomId: string,
  streamType?: string | null,
) {
  await nextTick();

  if (!playerContainerRef.value) {
    streamError.value = '播放器容器初始化失败。';
    return;
  }

  playerContainerRef.value.innerHTML = '';

  const playbackType = streamType === 'hls' ? 'hls' : 'flv';
  const isHlsPlayback = playbackType === 'hls';

  const playerOptions: Record<string, any> = {
    el: playerContainerRef.value,
    url: streamUrl,
    isLive: true,
    autoplay: true,
    playsinline: true,
    lang: 'zh-cn',
    width: '100%',
    height: '100%',
    videoFillMode: 'contain',
    closeVideoClick: true,
    closeVideoTouch: true,
    keyShortcut: true,
    volume: false as unknown as number,
    pip: {
      position: POSITIONS.CONTROLS_RIGHT,
      index: 3,
      showIcon: true,
    },
    cssFullscreen: {
      index: 2,
    },
    playbackRate: false,
    controls: {
      mode: 'normal',
    },
    icons: {
      play: ICONS.play,
      pause: ICONS.pause,
      fullscreen: ICONS.maximize2,
      exitFullscreen: ICONS.minimize2,
      cssFullscreen: ICONS.fullscreen,
      exitCssFullscreen: ICONS.minimize2,
      pipIcon: ICONS.pictureInPicture2,
      pipIconExit: ICONS.pictureInPicture2,
    },
  };

  if (isHlsPlayback) {
    const hlsFetchOptions: RequestInit = {
      referrer: 'https://live.bilibili.com/',
      referrerPolicy: 'no-referrer-when-downgrade',
      credentials: 'omit',
      mode: 'cors',
    };

    playerOptions.plugins = [HlsPlugin];
    playerOptions.useHlsPlugin = true;
    playerOptions.hls = {
      isLive: true,
      retryCount: 3,
      retryDelay: 2000,
      enableWorker: true,
      withCredentials: false,
      lowLatencyMode: false,
      fetchOptions: hlsFetchOptions,
      xhrSetup: (xhr: XMLHttpRequest) => {
        try {
          xhr.withCredentials = false;
          xhr.setRequestHeader('Referer', 'https://live.bilibili.com/');
          xhr.setRequestHeader('Origin', 'https://live.bilibili.com');
        } catch (headerError) {
          console.warn('[Player] Failed to attach Bilibili HLS headers:', headerError);
        }
      },
    };
  } else {
    playerOptions.plugins = [FlvPlugin];
    playerOptions.flv = {
      isLive: true,
      cors: true,
      autoCleanupSourceBuffer: true,
      enableWorker: true,
      stashInitialSize: 128,
      lazyLoad: true,
      lazyLoadMaxDuration: 30,
      deferLoadAfterSourceOpen: true,
    };
  }

  const player = new Player(playerOptions);

  playerInstance.value = player;
  const storedPlayerVolume = loadStoredVolume();
  if (storedPlayerVolume !== null) {
    player.volume = storedPlayerVolume;
    player.muted = storedPlayerVolume === 0 ? true : player.muted;
  }

  const lineOptionsForPlatform = lineOptions.value.map((option) => ({ ...option }));

  refreshControlPlugin.value = player.registerPlugin(RefreshControl, {
    position: POSITIONS.CONTROLS_LEFT,
    index: 2,
    onClick: () => {
      void reloadCurrentStream('refresh');
    },
  }) as RefreshControl;

  volumeControlPlugin.value = player.registerPlugin(VolumeControl, {
    position: POSITIONS.CONTROLS_LEFT,
    index: 3,
  }) as VolumeControl;

  danmuTogglePlugin.value = player.registerPlugin(DanmuToggleControl, {
    position: POSITIONS.CONTROLS_RIGHT,
    index: 4,
    getState: () => isDanmuEnabled.value,
    onToggle: (enabled: boolean) => {
      isDanmuEnabled.value = enabled;
    },
  }) as DanmuToggleControl;

  danmuSettingsPlugin.value = player.registerPlugin(DanmuSettingsControl, {
    position: POSITIONS.CONTROLS_RIGHT,
    index: 4.2,
    getSettings: () => ({
      color: danmuSettings.color,
      strokeColor: danmuSettings.strokeColor,
      fontSize: danmuSettings.fontSize,
      duration: danmuSettings.duration,
      area: danmuSettings.area,
      mode: danmuSettings.mode,
      opacity: danmuSettings.opacity,
    }),
    onChange: (partial: Partial<DanmuUserSettings>) => {
      if (partial.color) {
        danmuSettings.color = partial.color;
      }
      if (partial.strokeColor) {
        danmuSettings.strokeColor = partial.strokeColor;
      }
      if (partial.fontSize) {
        danmuSettings.fontSize = partial.fontSize;
      }
      if (typeof partial.duration === 'number') {
        danmuSettings.duration = partial.duration;
      }
      if (typeof partial.area === 'number') {
        danmuSettings.area = sanitizeDanmuArea(partial.area);
      }
      if (partial.mode) {
        danmuSettings.mode = partial.mode;
      }
      if (typeof partial.opacity === 'number') {
        danmuSettings.opacity = sanitizeDanmuOpacity(partial.opacity);
      }
    },
  }) as DanmuSettingsControl;

  qualityControlPlugin.value = player.registerPlugin(QualityControl, {
    position: POSITIONS.CONTROLS_RIGHT,
    index: 5,
    options: [...qualityOptions],
    getCurrent: () => currentQuality.value,
    onSelect: async (option: string) => {
      if (option === currentQuality.value) {
        return;
      }
      await switchQuality(option);
    },
  }) as QualityControl;
  qualityControlPlugin.value?.setOptions([...qualityOptions]);
  qualityControlPlugin.value?.updateLabel(currentQuality.value);

  lineControlPlugin.value = player.registerPlugin(LineControl, {
    position: POSITIONS.CONTROLS_RIGHT,
    index: 5.2,
    disable: lineOptionsForPlatform.length === 0,
    options: lineOptionsForPlatform,
    getCurrentKey: () => currentLine.value ?? '',
    getCurrentLabel: () => getCurrentLineLabel(currentLine.value),
    onSelect: async (optionKey: string) => {
      if (optionKey === currentLine.value) {
        return;
      }
      await switchLine(optionKey);
    },
  }) as LineControl;
  lineControlPlugin.value?.setOptions(lineOptionsForPlatform);
  lineControlPlugin.value?.updateLabel(getCurrentLineLabel(currentLine.value));

  arrangeControlClusters(player);

  let overlayInstance = createDanmuOverlay(player, danmuSettings, isDanmuEnabled.value);
  danmuInstance.value = overlayInstance;

  player.on('ready', async () => {
    arrangeControlClusters(player);
    ensureDanmuOverlayHost(player);
    overlayInstance = overlayInstance ?? createDanmuOverlay(player, danmuSettings, isDanmuEnabled.value);
    danmuInstance.value = overlayInstance;
    try {
      if (roomId) {
        await startCurrentDanmakuListener(platformCode, roomId, overlayInstance);
      }
    } catch (error) {
      console.error('[Player] Failed starting danmaku listener after ready:', error);
    }
    overlayInstance?.play?.();
    updateFullscreenFlag();
  });

  player.on('play', () => {
    overlayInstance?.play?.();
  });

  player.on('pause', () => {
    overlayInstance?.pause?.();
  });

  player.on('destroy', () => {
    overlayInstance?.stop?.();
    overlayInstance = null;
    danmuInstance.value = null;
  });

  player.on('error', (error: any) => {
    console.error('[Player] xgplayer error:', error);
    streamError.value = `播放器错误: ${error?.message || error}`;
  });

  player.on('enterFullscreen', () => {
    isInNativePlayerFullscreen.value = true;
    ensureDanmuOverlayHost(player);
    overlayInstance = overlayInstance ?? createDanmuOverlay(player, danmuSettings, isDanmuEnabled.value);
    danmuInstance.value = overlayInstance;
    overlayInstance?.play?.();
    updateFullscreenFlag();
  });

  player.on('exitFullscreen', () => {
    isInNativePlayerFullscreen.value = false;
    ensureDanmuOverlayHost(player);
    overlayInstance = overlayInstance ?? createDanmuOverlay(player, danmuSettings, isDanmuEnabled.value);
    danmuInstance.value = overlayInstance;
    updateFullscreenFlag();
  });

  player.on('enterFullscreenWeb', () => {
    isInWebFullscreen.value = true;
    try {
      document.documentElement.classList.add('web-fs-active');
    } catch (error) {
      console.warn('[Player] Failed to set web fullscreen flag:', error);
    }
    ensureDanmuOverlayHost(player);
    overlayInstance = overlayInstance ?? createDanmuOverlay(player, danmuSettings, isDanmuEnabled.value);
    danmuInstance.value = overlayInstance;
    overlayInstance?.play?.();
    arrangeControlClusters(player);
    updateFullscreenFlag();
  });

  player.on('exitFullscreenWeb', () => {
    isInWebFullscreen.value = false;
    try {
      if (!isClosing.value) {
        document.documentElement.classList.remove('web-fs-active');
      }
    } catch (error) {
      console.warn('[Player] Failed to clear web fullscreen flag:', error);
    }
    ensureDanmuOverlayHost(player);
    overlayInstance = overlayInstance ?? createDanmuOverlay(player, danmuSettings, isDanmuEnabled.value);
    danmuInstance.value = overlayInstance;
    arrangeControlClusters(player);
    updateFullscreenFlag();
  });

  player.on('cssFullscreen_change', (isCssFullscreen: boolean) => {
    isInWebFullscreen.value = isCssFullscreen;
    try {
      if (isCssFullscreen) {
        document.documentElement.classList.add('web-fs-active');
      } else if (!isClosing.value) {
        document.documentElement.classList.remove('web-fs-active');
      }
    } catch (error) {
      console.warn('[Player] Failed toggling css fullscreen flag:', error);
    }
    ensureDanmuOverlayHost(player);
    overlayInstance = overlayInstance ?? createDanmuOverlay(player, danmuSettings, isDanmuEnabled.value);
    danmuInstance.value = overlayInstance;
    if (isCssFullscreen) {
      overlayInstance?.play?.();
    }
    arrangeControlClusters(player);
    updateFullscreenFlag();
  });
}

function handleClosePlayerClick() {
  isClosing.value = true;
  emit('close-player');
}


async function initializePlayerAndStream(
  pRoomId: string, 
  pPlatform: StreamingPlatform,
  _pStreamUrlProp?: string | null, 
  isRefresh: boolean = false,
  oldRoomIdForCleanup?: string | null,
  oldPlatformForCleanup?: StreamingPlatform | null
) {
  isLoadingStream.value = true;
  streamError.value = null;
  isOfflineError.value = false;

  // Detect OS and adjust danmu font family per platform
  osName.value = await applyDanmuFontFamilyForOS();

  if (!isRefresh) {
    danmakuMessages.value = [];
  }

  if (props.initialError && props.initialError.includes('主播未开播')) {
    streamError.value = props.initialError;
    isOfflineError.value = true;
    playerTitle.value = props.title;
    playerAnchorName.value = props.anchorName;
    playerAvatar.value = props.avatar;
    playerIsLive.value = false;
    destroyPlayerInstance();
    isLoadingStream.value = false;
    return;
  }

  if (oldRoomIdForCleanup && oldPlatformForCleanup !== undefined && oldPlatformForCleanup !== null) {
    await stopCurrentDanmakuListener(oldPlatformForCleanup, oldRoomIdForCleanup);
    if (oldPlatformForCleanup === StreamingPlatform.DOUYU) {
      await stopDouyuProxy();
    }
  } else {
    await stopCurrentDanmakuListener();
  }

  destroyPlayerInstance();

  const effectiveLine = resolveCurrentLineFor(pPlatform, currentLine.value);

  try {
    let streamConfig: { streamUrl: string; streamType: string | undefined };

    if (pPlatform === StreamingPlatform.DOUYU) {
      if (playerIsLive.value === false) {
        streamError.value = streamError.value || '主播未开播。';
        isOfflineError.value = true;
        isLoadingStream.value = false;
        return;
      }
      streamConfig = await getDouyuStreamConfig(pRoomId, currentQuality.value, effectiveLine);
    } else if (pPlatform === StreamingPlatform.DOUYIN) {
      const douyinConfig = await fetchAndPrepareDouyinStreamConfig(pRoomId, currentQuality.value);
      playerTitle.value = douyinConfig.title;
      playerAnchorName.value = douyinConfig.anchorName;
      playerAvatar.value = douyinConfig.avatar;
      playerIsLive.value = douyinConfig.isLive;

      if (douyinConfig.initialError || !douyinConfig.isLive || !douyinConfig.streamUrl) {
        streamError.value = douyinConfig.initialError || '主播未开播或无法获取直播流。';
        isOfflineError.value = true;
        playerIsLive.value = false;
        isLoadingStream.value = false;
        console.warn(`[Player] Douyin config error or not live: ${streamError.value}`);
        return;
      }

      streamConfig = { streamUrl: douyinConfig.streamUrl, streamType: douyinConfig.streamType };
    } else if (pPlatform === StreamingPlatform.HUYA) {
      streamConfig = await getHuyaStreamConfig(pRoomId, currentQuality.value, effectiveLine);
    } else if (pPlatform === StreamingPlatform.BILIBILI) {
      streamConfig = await getBilibiliStreamConfig(pRoomId, currentQuality.value, props.cookie || undefined);
    } else {
      throw new Error(`不支持的平台: ${pPlatform}`);
    }

    isLoadingStream.value = false;
    await mountXgPlayer(streamConfig.streamUrl, pPlatform, pRoomId, streamConfig.streamType);
  } catch (error: any) {
    console.error(`[Player] Error initializing stream for ${pPlatform} room ${pRoomId}:`, error);
    destroyPlayerInstance();

    const errorMessage = error?.message || '加载直播流失败，请稍后再试。';

    if (errorMessage.includes('主播未开播')) {
      streamError.value = errorMessage;
      isOfflineError.value = true;

      try {
        if (pPlatform === StreamingPlatform.HUYA) {
          const result: any = await invoke('get_huya_unified_cmd', { roomId: pRoomId, quality: currentQuality.value, line: effectiveLine ?? null });
          await ensureProxyStarted();
          playerTitle.value = result?.title ?? props.title;
          playerAnchorName.value = result?.nick ?? props.anchorName;
          playerAvatar.value = proxify((result?.avatar ?? props.avatar ?? '') as string);
        } else if (pPlatform === StreamingPlatform.BILIBILI) {
          const payload = { args: { room_id_str: pRoomId } };
          const savedCookie = (typeof localStorage !== 'undefined') ? (localStorage.getItem('bilibili_cookie') || null) : null;
          const res: any = await invoke('fetch_bilibili_streamer_info', { payload, cookie: savedCookie });
          await ensureProxyStarted();
          playerTitle.value = res?.title ?? props.title;
          playerAnchorName.value = res?.anchor_name ?? props.anchorName;
          playerAvatar.value = proxify((res?.avatar ?? props.avatar ?? '') as string);
        }
      } catch (infoError) {
        console.warn('[Player] Failed to fetch basic streamer info for offline page:', infoError);
      }
    } else {
      streamError.value = errorMessage;
      isOfflineError.value = false;
    }

    isLoadingStream.value = false;
  }
}
const danmakuManagerContext = {
  danmakuMessages,
  isDanmuEnabled,
  danmuSettings,
  isDanmakuListenerActive,
  unlistenDanmakuFn,
  props,
};

const startCurrentDanmakuListener = async (platform: StreamingPlatform, roomId: string, danmuOverlay: DanmuOverlayInstance | null) => {
  await startDanmakuListener(danmakuManagerContext, platform, roomId, danmuOverlay);
};

const stopCurrentDanmakuListener = async (platform?: StreamingPlatform, roomId?: string | null | undefined) => {
  await stopDanmakuListener(danmakuManagerContext, platform, roomId);
};

const retryInitialization = async () => {
  await reloadCurrentStream('refresh');
};

// 画质切换函数
const switchQuality = async (quality: string) => {
  if (isQualitySwitching.value) {
    return;
  }
  if (!qualityOptions.includes(quality as (typeof qualityOptions)[number])) {
    return;
  }
  if (!props.roomId || props.platform == null) {
    emit('request-player-reload');
    return;
  }
  if (quality === currentQuality.value) {
    return;
  }

  isQualitySwitching.value = true;
  const previousQuality = currentQuality.value;

  try {
    currentQuality.value = quality;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(`${props.platform}_preferred_quality`, quality);
    }
    await reloadCurrentStream('quality');
    console.log(`[Player] 画质切换完成: ${quality}`);
  } catch (error) {
    console.error('[Player] 画质切换失败:', error);
    currentQuality.value = previousQuality;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(`${props.platform}_preferred_quality`, previousQuality);
    }
  } finally {
    isQualitySwitching.value = false;
  }
};

const switchLine = async (lineKey: string) => {
  if (isLineSwitching.value) {
    return;
  }
  const options = lineOptions.value;
  if (!options.length) {
    return;
  }
  if (!options.some((option) => option.key === lineKey)) {
    return;
  }
  if (!props.roomId || props.platform == null) {
    emit('request-player-reload');
    return;
  }
  if (currentLine.value === lineKey) {
    return;
  }

  isLineSwitching.value = true;
  const previousLine = currentLine.value;

  try {
    currentLine.value = lineKey;
    persistLinePreference(props.platform, lineKey);
    await reloadCurrentStream('line');
    console.log(`[Player] 线路切换完成: ${lineKey}`);
  } catch (error) {
    console.error('[Player] 线路切换失败:', error);
    currentLine.value = previousLine ?? null;
    if (previousLine) {
      persistLinePreference(props.platform, previousLine);
    }
  } finally {
    isLineSwitching.value = false;
  }
};

// 初始化画质偏好
const initializeQualityPreference = () => {
  currentQuality.value = resolveStoredQuality(props.platform);
};

async function reloadCurrentStream(trigger: 'refresh' | 'quality' | 'line' = 'refresh') {
  if (isLoadingStream.value) {
    return;
  }
  if (!props.roomId || props.platform == null) {
    emit('request-player-reload');
    return;
  }
  const isRefreshAction = trigger === 'refresh';
  if (isRefreshAction) {
    isRefreshingStream.value = true;
  }
  try {
    await initializePlayerAndStream(
      props.roomId,
      props.platform,
      props.streamUrl ?? null,
      true,
      props.roomId,
      props.platform,
    );
  } finally {
    if (isRefreshAction) {
      isRefreshingStream.value = false;
    }
  }
  if (trigger === 'quality') {
    qualityControlPlugin.value?.updateLabel(currentQuality.value);
  }
  if (trigger === 'line') {
    lineControlPlugin.value?.updateLabel(getCurrentLineLabel(currentLine.value));
  }
}

const getDanmuSettingsSnapshot = (): DanmuUserSettings => ({
  color: danmuSettings.color,
  strokeColor: danmuSettings.strokeColor,
  fontSize: danmuSettings.fontSize,
  duration: danmuSettings.duration,
  area: sanitizeDanmuArea(danmuSettings.area),
  mode: danmuSettings.mode,
  opacity: sanitizeDanmuOpacity(danmuSettings.opacity),
});

const persistCurrentDanmuPreferences = () => {
  persistDanmuPreferences({
    enabled: isDanmuEnabled.value,
    settings: getDanmuSettingsSnapshot(),
  });
};

registerPlayerWatchers({
  refreshControlPlugin,
  isRefreshingStream,
  qualityControlPlugin,
  isQualitySwitching,
  lineControlPlugin,
  isLineSwitching,
  lineOptions,
  currentLine,
  getLineLabel: getCurrentLineLabel,
  persistLinePreference,
  props,
  resolveStoredLine,
  isDanmuEnabled,
  danmuTogglePlugin,
  danmuInstance,
  danmuSettingsPlugin,
  danmuSettings,
  applyDanmuOverlayPreferences,
  syncDanmuEnabledState,
  persistCurrentDanmuPreferences,
  currentQuality,
  initializeQualityPreference,
  initializePlayerAndStream,
  stopCurrentDanmakuListener,
  stopDouyuProxy,
  destroyPlayerInstance,
  isLoadingStream,
  danmakuMessages,
  streamError,
  isOfflineError,
  playerTitle,
  playerAnchorName,
  playerAvatar,
  playerIsLive,
  playerRoot: () => playerInstance.value?.root as HTMLElement | null,
});

watch(showDanmuPanel, (available) => {
  if (!available) {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DANMU_COLLAPSED_STORAGE_KEY, isDanmuCollapsed.value ? '1' : '0');
    }
  }
});

watch(
  [showCompactIsland, playerAnchorName, playerTitle, playerAvatar],
  () => {
    broadcastIslandState();
  },
  { immediate: true },
);

onMounted(async () => {
  updateWindowWidth();
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateWindowWidth, { passive: true });
  }
  // 初始化画质偏好
  initializeQualityPreference();
  
  if (!props.roomId || props.platform == null) {
    if (props.initialError) {
      if (props.initialError.includes('主播未开播')) {
          streamError.value = props.initialError;
          isOfflineError.value = true;
      } else {
          streamError.value = props.initialError;
          isOfflineError.value = false; // Ensure it's not marked as offline for other errors
      }
    }
    isLoadingStream.value = false;
  }

  persistCurrentDanmuPreferences();

  if (typeof window !== 'undefined') {
    window.addEventListener(PLAYER_ISLAND_EXPAND_EVENT, expandDanmuPanel);
  }
});

onUnmounted(async () => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateWindowWidth);
  }
  const platformToStop: StreamingPlatform = props.platform;
  const roomIdToStop: string | null = props.roomId;
  await stopCurrentDanmakuListener(platformToStop, roomIdToStop);

  if (props.platform === StreamingPlatform.DOUYU) {
    await stopDouyuProxy();
  }

  destroyPlayerInstance();
  danmakuMessages.value = []; 

  if (typeof window !== 'undefined') {
    window.removeEventListener(PLAYER_ISLAND_EXPAND_EVENT, expandDanmuPanel);
    window.dispatchEvent(new CustomEvent(PLAYER_ISLAND_EVENT, {
      detail: { visible: false, anchorName: '', title: '', avatarUrl: null, roomId: null, platform: null },
    }));
  }
});

</script>
