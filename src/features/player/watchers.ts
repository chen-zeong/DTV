import { watch, type ComputedRef, type Ref, type ShallowRef } from "vue";

import { sanitizeDanmuArea, sanitizeDanmuOpacity } from "./constants";
import type { DanmuUserSettings } from "./constants";
import type {
  DanmuSettingsControl,
  DanmuToggleControl,
  LineControl,
  QualityControl,
  RefreshControl,
  LineOption,
} from "./plugins";
import { Platform as StreamingPlatform } from "../../types/app/platform";
import type { DanmakuMessage, DanmuOverlayInstance } from "../../types/models/danmaku";

export interface PlayerProps {
  roomId: string | null;
  platform: StreamingPlatform;
  isFollowed?: boolean;
  streamUrl?: string | null;
  title?: string | null;
  anchorName?: string | null;
  avatar?: string | null;
  isLive?: boolean | null;
  initialError?: string | null;
  cookie?: string | null;
}

export interface PlayerWatcherContext {
  refreshControlPlugin: ShallowRef<RefreshControl | null>;
  isRefreshingStream: Ref<boolean>;
  qualityControlPlugin: ShallowRef<QualityControl | null>;
  isQualitySwitching: Ref<boolean>;
  lineControlPlugin: ShallowRef<LineControl | null>;
  isLineSwitching: Ref<boolean>;
  lineOptions: ComputedRef<LineOption[]>;
  currentLine: Ref<string | null>;
  getLineLabel: (key?: string | null) => string;
  persistLinePreference: (
    platform?: StreamingPlatform | null,
    lineKey?: string | null,
  ) => void;
  props: PlayerProps;
  resolveStoredLine: (platform?: StreamingPlatform | null) => string | null;
  isDanmuEnabled: Ref<boolean>;
  danmuTogglePlugin: ShallowRef<DanmuToggleControl | null>;
  danmuInstance: ShallowRef<DanmuOverlayInstance | null>;
  danmuSettingsPlugin: ShallowRef<DanmuSettingsControl | null>;
  danmuSettings: DanmuUserSettings;
  applyDanmuOverlayPreferences: (
    instance: DanmuOverlayInstance | null,
    settings: DanmuUserSettings,
    isEnabled: boolean,
    playerRoot?: HTMLElement | null,
  ) => void;
  syncDanmuEnabledState: (
    instance: DanmuOverlayInstance | null,
    settings: DanmuUserSettings,
    isEnabled: boolean,
    playerRoot?: HTMLElement | null,
  ) => void;
  persistCurrentDanmuPreferences: () => void;
  currentQuality: Ref<string>;
  initializeQualityPreference: () => void;
  initializePlayerAndStream: (
    roomId: string,
    platform: StreamingPlatform,
    streamUrl?: string | null,
    isRefresh?: boolean,
    oldRoomIdForCleanup?: string | null,
    oldPlatformForCleanup?: StreamingPlatform | null,
  ) => Promise<void>;
  stopCurrentDanmakuListener: (
    platform?: StreamingPlatform,
    roomId?: string | null | undefined,
  ) => Promise<void>;
  stopProxy: () => Promise<void>;
  destroyPlayerInstance: () => void;
  isLoadingStream: Ref<boolean>;
  danmakuMessages: Ref<DanmakuMessage[]>;
  streamError: Ref<string | null>;
  isOfflineError: Ref<boolean>;
  playerTitle: Ref<string | null | undefined>;
  playerAnchorName: Ref<string | null | undefined>;
  playerAvatar: Ref<string | null | undefined>;
  playerIsLive: Ref<boolean | null | undefined>;
  playerRoot: () => HTMLElement | null | undefined;
}

export const registerPlayerWatchers = (ctx: PlayerWatcherContext) => {
  const {
    refreshControlPlugin,
    isRefreshingStream,
    qualityControlPlugin,
    isQualitySwitching,
    lineControlPlugin,
    isLineSwitching,
    lineOptions,
    currentLine,
    getLineLabel,
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
    stopProxy,
    destroyPlayerInstance,
    isLoadingStream,
    danmakuMessages,
    streamError,
    isOfflineError,
    playerTitle,
    playerAnchorName,
    playerAvatar,
    playerIsLive,
    playerRoot,
  } = ctx;

  watch(isRefreshingStream, (isLoading) => {
    refreshControlPlugin.value?.setLoading(isLoading);
  });

  watch(refreshControlPlugin, (plugin) => {
    plugin?.setLoading(isRefreshingStream.value);
  });

  watch(isQualitySwitching, (isSwitching) => {
    qualityControlPlugin.value?.setSwitching(isSwitching);
  });

  watch(qualityControlPlugin, (plugin) => {
    plugin?.setSwitching(isQualitySwitching.value);
  });

  watch(isLineSwitching, (isSwitching) => {
    lineControlPlugin.value?.setSwitching(isSwitching);
  });

  watch(lineControlPlugin, (plugin) => {
    if (!plugin) {
      return;
    }
    plugin.setOptions(lineOptions.value);
    plugin.updateLabel(getLineLabel(currentLine.value));
    plugin.setSwitching(isLineSwitching.value);
  });

  watch(
    () => props.platform,
    (platform, previous) => {
      if (platform !== previous) {
        currentLine.value = resolveStoredLine(platform);
        isLineSwitching.value = false;
      }
    },
  );

  watch(
    lineOptions,
    (options) => {
      if (!options.length) {
        currentLine.value = null;
      } else if (!options.some((option) => option.key === currentLine.value)) {
        currentLine.value = options[0]?.key ?? null;
      }
      lineControlPlugin.value?.setOptions(options);
      lineControlPlugin.value?.updateLabel(getLineLabel(currentLine.value));
    },
    { immediate: true },
  );

  watch(currentLine, (line) => {
    if (line) {
      persistLinePreference(props.platform, line);
    }
    lineControlPlugin.value?.updateLabel(getLineLabel(line));
  });

  watch(isDanmuEnabled, (enabled) => {
    danmuTogglePlugin.value?.setState(enabled);
    syncDanmuEnabledState(
      danmuInstance.value,
      danmuSettings,
      enabled,
      playerRoot(),
    );
    persistCurrentDanmuPreferences();
  });

  watch(danmuTogglePlugin, (plugin) => {
    plugin?.setState(isDanmuEnabled.value);
  });

  watch(danmuSettingsPlugin, (plugin) => {
    if (!plugin) {
      return;
    }
    plugin.setSettings({
      color: danmuSettings.color,
      strokeColor: danmuSettings.strokeColor,
      fontSize: danmuSettings.fontSize,
      duration: danmuSettings.duration,
      area: sanitizeDanmuArea(danmuSettings.area),
      mode: danmuSettings.mode,
      opacity: sanitizeDanmuOpacity(danmuSettings.opacity),
    });
  });

  watch(
    () => danmuSettings.color,
    (color) => {
      danmuSettingsPlugin.value?.setSettings({ color });
      persistCurrentDanmuPreferences();
    },
  );

  watch(
    () => danmuSettings.strokeColor,
    (strokeColor) => {
      danmuSettingsPlugin.value?.setSettings({ strokeColor });
      applyDanmuOverlayPreferences(
        danmuInstance.value,
        danmuSettings,
        isDanmuEnabled.value,
        playerRoot(),
      );
      persistCurrentDanmuPreferences();
    },
  );

  watch(
    () => danmuSettings.fontSize,
    (fontSize) => {
      danmuSettingsPlugin.value?.setSettings({ fontSize });
      applyDanmuOverlayPreferences(
        danmuInstance.value,
        danmuSettings,
        isDanmuEnabled.value,
        playerRoot(),
      );
      persistCurrentDanmuPreferences();
    },
  );

  watch(
    () => danmuSettings.duration,
    (duration) => {
      danmuSettingsPlugin.value?.setSettings({ duration });
      applyDanmuOverlayPreferences(
        danmuInstance.value,
        danmuSettings,
        isDanmuEnabled.value,
        playerRoot(),
      );
      persistCurrentDanmuPreferences();
    },
  );

  watch(
    () => danmuSettings.area,
    (area) => {
      const normalizedArea = sanitizeDanmuArea(area);
      if (normalizedArea !== area) {
        danmuSettings.area = normalizedArea;
        return;
      }
      danmuSettingsPlugin.value?.setSettings({ area: normalizedArea });
      applyDanmuOverlayPreferences(
        danmuInstance.value,
        danmuSettings,
        isDanmuEnabled.value,
        playerRoot(),
      );
      persistCurrentDanmuPreferences();
    },
  );

  watch(
    () => danmuSettings.opacity,
    (opacity) => {
      const normalizedOpacity = sanitizeDanmuOpacity(opacity);
      if (normalizedOpacity !== opacity) {
        danmuSettings.opacity = normalizedOpacity;
        return;
      }
      danmuSettingsPlugin.value?.setSettings({ opacity: normalizedOpacity });
      applyDanmuOverlayPreferences(
        danmuInstance.value,
        danmuSettings,
        isDanmuEnabled.value,
        playerRoot(),
      );
      persistCurrentDanmuPreferences();
    },
  );

  watch(danmuInstance, (instance) => {
    applyDanmuOverlayPreferences(
      instance,
      danmuSettings,
      isDanmuEnabled.value,
      playerRoot(),
    );
    syncDanmuEnabledState(
      instance,
      danmuSettings,
      isDanmuEnabled.value,
      playerRoot(),
    );
  });

  watch(currentQuality, (quality) => {
    qualityControlPlugin.value?.updateLabel(quality);
  });

  watch(
    [
      () => props.roomId,
      () => props.platform,
      () => props.streamUrl,
      () => props.avatar,
      () => props.title,
      () => props.anchorName,
      () => props.isLive,
    ],
    async (
      [
        newRoomId,
        newPlatform,
        newStreamUrl,
        newAvatar,
        newTitle,
        newAnchorName,
        newIsLive,
      ],
      [oldRoomId, oldPlatform, oldStreamUrl],
    ) => {
      if (newPlatform === StreamingPlatform.DOUYU) {
        playerTitle.value = newTitle;
        playerAnchorName.value = newAnchorName;
        playerAvatar.value = newAvatar;
        if (newIsLive !== undefined) {
          playerIsLive.value = newIsLive;
        }
      }

      if (newRoomId && newPlatform) {
        if (
          !(props.initialError && props.initialError.includes("主播未开播"))
        ) {
          isOfflineError.value = false;
        }

        const isInitialCall =
          oldRoomId === undefined && oldPlatform === undefined;
        const hasSwitchedStream =
          newRoomId !== oldRoomId || newPlatform !== oldPlatform;
        const douyinStreamUrlChanged =
          newPlatform === StreamingPlatform.DOUYIN &&
          newStreamUrl !== oldStreamUrl;

        const needsReInit =
          hasSwitchedStream || isInitialCall || douyinStreamUrlChanged;

        if (needsReInit) {
          initializeQualityPreference();
          initializePlayerAndStream(
            newRoomId,
            newPlatform,
            newStreamUrl,
            false,
            oldRoomId,
            oldPlatform,
          );
        }
      } else if (!newRoomId) {
        if (oldRoomId && oldPlatform !== null && oldPlatform !== undefined) {
          await stopCurrentDanmakuListener(oldPlatform, oldRoomId);
          await stopProxy();
        } else {
          await stopCurrentDanmakuListener();
        }

        destroyPlayerInstance();

        isLoadingStream.value = false;
        danmakuMessages.value = [];
        streamError.value = null;
        isOfflineError.value = false;
      }
      if (!props.roomId || props.platform == null) {
        if (props.initialError) {
          if (props.initialError.includes("主播未开播")) {
            streamError.value = props.initialError;
            isOfflineError.value = true;
          } else {
            streamError.value = props.initialError;
            isOfflineError.value = false;
          }
        }
        isLoadingStream.value = false;
      }
    },
    { immediate: true },
  );
};
