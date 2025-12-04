import DanmuJs from 'danmu.js';
import type Player from 'xgplayer';

import { sanitizeDanmuArea, sanitizeDanmuOpacity } from './constants';
import type { DanmuOverlayInstance } from './types';
import type { DanmuUserSettings } from './constants';

export const ensureDanmuOverlayHost = (player: Player): HTMLElement | null => {
  const root = player.root as HTMLElement | undefined;
  if (!root) {
    return null;
  }

  let host = root.querySelector('.player-danmu-overlay') as HTMLElement | null;
  if (!host) {
    host = document.createElement('div');
    host.className = 'player-danmu-overlay';
  }

  const videoContainer = root.querySelector('xg-video-container');
  if (videoContainer && host.parentElement !== videoContainer) {
    videoContainer.appendChild(host);
  } else if (!videoContainer && host.parentElement !== root) {
    root.appendChild(host);
  } else if (!host.parentElement) {
    root.appendChild(host);
  }

  return host;
};

export const applyDanmuOverlayPreferences = (
  overlay: DanmuOverlayInstance | null,
  danmuSettings: DanmuUserSettings,
  isDanmuEnabled: boolean,
  playerRoot?: HTMLElement | null,
) => {
  if (!overlay) {
    return;
  }
  const host = playerRoot?.querySelector('.player-danmu-overlay') as HTMLElement | null;
  const fontSizeValue = parseInt(danmuSettings.fontSize, 10);
  if (!Number.isNaN(fontSizeValue)) {
    try {
      overlay.setFontSize?.(fontSizeValue);
    } catch (error) {
      console.warn('[Player] Failed to apply danmu font size:', error);
    }
  }
  try {
    const areaValue = sanitizeDanmuArea(danmuSettings.area);
    overlay.setArea?.({ start: 0, end: areaValue });
  } catch (error) {
    console.warn('[Player] Failed to apply danmu area:', error);
  }
  try {
    overlay.setAllDuration?.('scroll', danmuSettings.duration);
    overlay.setAllDuration?.('top', danmuSettings.duration);
    overlay.setAllDuration?.('bottom', danmuSettings.duration);
  } catch (error) {
    // Non-critical for players that do not support bulk duration updates
  }
  try {
    const normalizedOpacity = sanitizeDanmuOpacity(danmuSettings.opacity);
    const nextOpacity = isDanmuEnabled ? normalizedOpacity : 0;
    overlay.setOpacity?.(nextOpacity);
    host?.style.setProperty('--danmu-opacity', String(nextOpacity));
  } catch (error) {
    // Non-critical
  }
  try {
    host?.style.setProperty('--danmu-stroke-color', danmuSettings.strokeColor);
  } catch (error) {
    console.warn('[Player] Failed to apply danmu stroke color:', error);
  }
};

export const syncDanmuEnabledState = (
  overlay: DanmuOverlayInstance | null,
  danmuSettings: DanmuUserSettings,
  isDanmuEnabled: boolean,
  playerRoot?: HTMLElement | null,
) => {
  if (!overlay) {
    return;
  }
  const normalizedOpacity = sanitizeDanmuOpacity(danmuSettings.opacity);
  const targetOpacity = isDanmuEnabled ? normalizedOpacity : 0;
  try {
    if (isDanmuEnabled) {
      overlay.play?.();
      overlay.show?.('scroll');
      overlay.show?.('top');
      overlay.show?.('bottom');
    } else {
      overlay.pause?.();
    }
    overlay.setOpacity?.(targetOpacity);
    const host = playerRoot?.querySelector('.player-danmu-overlay') as HTMLElement | null;
    host?.style.setProperty('--danmu-opacity', String(targetOpacity));
  } catch (error) {
    console.warn('[Player] Failed updating danmu enabled state:', error);
  }
};

export const createDanmuOverlay = (
  player: Player | null,
  danmuSettings: DanmuUserSettings,
  isDanmuEnabled: boolean,
): DanmuOverlayInstance | null => {
  if (!player) {
    return null;
  }

  const overlayHost = ensureDanmuOverlayHost(player);
  if (!overlayHost) {
    return null;
  }

  overlayHost.innerHTML = '';
  overlayHost.style.setProperty('--danmu-stroke-color', danmuSettings.strokeColor);
  overlayHost.style.setProperty('--danmu-opacity', String(isDanmuEnabled ? sanitizeDanmuOpacity(danmuSettings.opacity) : 0));

  try {
    const overlay = new DanmuJs({
      container: overlayHost,
      player: player.video || player.media || undefined,
      comments: [],
      mouseControl: false,
      defaultOff: false,
      channelSize: 36,
      containerStyle: {
        pointerEvents: 'none',
      },
    });

    overlay.start?.();
    applyDanmuOverlayPreferences(overlay, danmuSettings, isDanmuEnabled, player.root as HTMLElement);
    syncDanmuEnabledState(overlay, danmuSettings, isDanmuEnabled, player.root as HTMLElement);
    return overlay;
  } catch (error) {
    console.error('[Player] Failed to initialize danmu.js overlay:', error);
    return null;
  }
};
