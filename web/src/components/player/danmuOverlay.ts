import Danmaku from 'danmaku';
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
    const media = (player as any).video || (player as any).media || undefined;
    const danmaku = new Danmaku({
      container: overlayHost,
      media,
      comments: [],
      engine: 'canvas',
      speed: 144,
    });

    let currentEnabled = isDanmuEnabled;
    let currentSettings: DanmuUserSettings = { ...danmuSettings };
    let currentOpacity = currentEnabled ? sanitizeDanmuOpacity(currentSettings.opacity) : 0;

    const applySpeedFromDuration = (durationMs: number) => {
      const width = overlayHost.offsetWidth || 1;
      const durationSec = Math.max(0.1, durationMs / 1000);
      danmaku.speed = width / durationSec;
    };

    let resizeRaf = 0;
    let lastKnownWidth = 0;
    let lastKnownHeight = 0;
    const performResize = () => {
      const width = overlayHost.offsetWidth;
      const height = overlayHost.offsetHeight;
      if (!width || !height) {
        return;
      }
      if (width === lastKnownWidth && height === lastKnownHeight) {
        return;
      }
      lastKnownWidth = width;
      lastKnownHeight = height;
      danmaku.resize();
      applySpeedFromDuration(currentSettings.duration);
    };
    const scheduleResize = () => {
      if (resizeRaf) {
        return;
      }
      resizeRaf = window.requestAnimationFrame(() => {
        resizeRaf = 0;
        try {
          performResize();
        } catch {
          // ignore
        }
      });
    };

    let resizeObserver: ResizeObserver | null = null;
    const cleanupResizeHooks: Array<() => void> = [];
    try {
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => scheduleResize());
        resizeObserver.observe(overlayHost);
        cleanupResizeHooks.push(() => resizeObserver?.disconnect());
      }
    } catch {
      // ignore
    }
    try {
      window.addEventListener('resize', scheduleResize, { passive: true });
      cleanupResizeHooks.push(() => window.removeEventListener('resize', scheduleResize as any));
    } catch {
      // ignore
    }
    try {
      const onFull = () => scheduleResize();
      player.on?.('fullscreen_change', onFull);
      player.on?.('cssFullscreen_change', onFull);
      cleanupResizeHooks.push(() => {
        player.off?.('fullscreen_change', onFull);
        player.off?.('cssFullscreen_change', onFull);
      });
    } catch {
      // ignore
    }

    const overlay: DanmuOverlayInstance = {
      sendComment: (comment) => {
        try {
          if (!currentEnabled || currentOpacity <= 0) {
            return;
          }

          // 高密度时如果继续塞入会更容易发生遮挡；这里做一个轻量限流（优先保证不重叠/不卡顿）。
          try {
            const internal = (danmaku as any)?._;
            const runningCount = Array.isArray(internal?.runningList) ? internal.runningList.length : 0;
            const fontSize = parseInt(currentSettings.fontSize, 10);
            const safeFontSize = Number.isFinite(fontSize) ? fontSize : 20;
            const approxRowHeight = Math.max(16, safeFontSize + 6);
            const approxRows = Math.max(1, Math.floor((overlayHost.offsetHeight || 0) / approxRowHeight));
            const maxRunning = approxRows * 3;
            if (runningCount > maxRunning) {
              return;
            }
          } catch {
            // ignore density checks
          }

          const fontSize = parseInt(currentSettings.fontSize, 10);
          const safeFontSize = Number.isFinite(fontSize) ? fontSize : 20;
          const fillColor = comment.style?.color || currentSettings.color || '#ffffff';

          danmaku.emit({
            text: comment.txt,
            mode: 'rtl',
            style: {
              font: `900 ${safeFontSize}px sans-serif`,
              fillStyle: fillColor,
              strokeStyle: currentSettings.strokeColor || '#444444',
              lineWidth: 2,
              globalAlpha: currentOpacity,
              textBaseline: 'bottom',
            } as any,
          });
        } catch (error) {
          console.warn('[Player] Failed emitting danmaku comment:', error);
        }
      },
      play: () => {
        currentEnabled = true;
        currentOpacity = sanitizeDanmuOpacity(currentSettings.opacity);
        danmaku.show();
      },
      pause: () => {
        currentEnabled = false;
        currentOpacity = 0;
        danmaku.hide();
      },
      stop: () => {
        try {
          if (resizeRaf) {
            window.cancelAnimationFrame(resizeRaf);
            resizeRaf = 0;
          }
        } catch {
          // ignore
        }
        for (const fn of cleanupResizeHooks) {
          try {
            fn();
          } catch {
            // ignore
          }
        }
        danmaku.destroy();
      },
      start: () => {
        danmaku.show();
      },
      hide: () => {
        danmaku.hide();
      },
      show: () => {
        danmaku.show();
      },
      setOpacity: (opacity: number) => {
        const next = Math.max(0, Math.min(1, opacity));
        currentOpacity = currentEnabled ? next : 0;
        overlayHost.style.setProperty('--danmu-opacity', String(currentOpacity));
      },
      setFontSize: (size: number | string) => {
        const next = typeof size === 'string' ? parseInt(size, 10) : size;
        if (Number.isFinite(next)) {
          currentSettings = { ...currentSettings, fontSize: `${next}px` };
          scheduleResize();
        }
      },
      setAllDuration: (_mode: string, duration: number) => {
        if (Number.isFinite(duration) && duration > 0) {
          currentSettings = { ...currentSettings, duration };
          applySpeedFromDuration(duration);
        }
      },
      setArea: (area) => {
        const end = sanitizeDanmuArea(area?.end ?? currentSettings.area);
        currentSettings = { ...currentSettings, area: end };
        overlayHost.style.height = `${Math.round(end * 100)}%`;
        overlayHost.style.top = '0';
        overlayHost.style.bottom = 'auto';
        overlayHost.style.overflow = 'hidden';
        danmaku.resize();
        applySpeedFromDuration(currentSettings.duration);
      },
    };

    // initial apply
    applyDanmuOverlayPreferences(overlay, danmuSettings, isDanmuEnabled, player.root as HTMLElement);
    syncDanmuEnabledState(overlay, danmuSettings, isDanmuEnabled, player.root as HTMLElement);
    try {
      danmaku.resize();
      applySpeedFromDuration(danmuSettings.duration);
      scheduleResize();
    } catch {
      // ignore
    }

    return overlay;
  } catch (error) {
    console.error('[Player] Failed to initialize danmaku overlay:', error);
    return null;
  }
};
