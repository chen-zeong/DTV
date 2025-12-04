import type { Ref } from 'vue';

import { Platform as StreamingPlatform } from '../../platforms/common/types';
import { startBilibiliDanmakuListener, stopBilibiliDanmaku } from '../../platforms/bilibili/playerHelper';
import { startDouyinDanmakuListener, stopDouyinDanmaku } from '../../platforms/douyin/playerHelper';
import { startDouyuDanmakuListener, stopDouyuDanmaku } from '../../platforms/douyu/playerHelper';
import { startHuyaDanmakuListener, stopHuyaDanmaku } from '../../platforms/huya/playerHelper';

import type { DanmuUserSettings } from './constants';
import type { PlayerProps } from './watchers';
import type { DanmakuMessage, DanmuOverlayInstance } from './types';

export interface DanmakuManagerContext {
  danmakuMessages: Ref<DanmakuMessage[]>;
  isDanmuEnabled: Ref<boolean>;
  danmuSettings: DanmuUserSettings;
  isDanmakuListenerActive: Ref<boolean>;
  unlistenDanmakuFn: Ref<(() => void) | null>;
  props: PlayerProps;
}

export const startCurrentDanmakuListener = async (
  ctx: DanmakuManagerContext,
  platform: StreamingPlatform,
  roomId: string,
  danmuOverlay: DanmuOverlayInstance | null,
) => {
  if (!roomId || ctx.isDanmakuListenerActive.value) {
    return;
  }

  ctx.isDanmakuListenerActive.value = true;
  if (!danmuOverlay) {
    console.warn('[Player] Danmu overlay instance missing, incoming danmaku will not render on video but list will update.');
  }

  try {
    const renderOptions = {
      shouldDisplay: () => ctx.isDanmuEnabled.value,
      buildCommentOptions: () => ({
        duration: ctx.danmuSettings.duration,
        mode: ctx.danmuSettings.mode,
        style: {
          color: ctx.danmuSettings.color,
          fontSize: ctx.danmuSettings.fontSize,
          '--danmu-stroke-color': ctx.danmuSettings.strokeColor,
        },
      }),
    };
    let stopFn: (() => void) | null = null;
    if (platform === StreamingPlatform.DOUYU) {
      stopFn = await startDouyuDanmakuListener(roomId, danmuOverlay, ctx.danmakuMessages, renderOptions);
    } else if (platform === StreamingPlatform.DOUYIN) {
      stopFn = await startDouyinDanmakuListener(roomId, danmuOverlay, ctx.danmakuMessages, renderOptions);
    } else if (platform === StreamingPlatform.HUYA) {
      stopFn = await startHuyaDanmakuListener(roomId, danmuOverlay, ctx.danmakuMessages, renderOptions);
    } else if (platform === StreamingPlatform.BILIBILI) {
      stopFn = await startBilibiliDanmakuListener(roomId, danmuOverlay, ctx.danmakuMessages, ctx.props.cookie || undefined, renderOptions);
    }

    if (stopFn) {
      ctx.unlistenDanmakuFn.value = stopFn;
      const successMessage: DanmakuMessage = {
        id: `system-conn-${Date.now()}`,
        nickname: '系统消息',
        content: '弹幕连接成功！',
        isSystem: true,
        type: 'success',
        color: '#28a745',
      };
      ctx.danmakuMessages.value.push(successMessage);
    } else {
      console.warn(`[Player] Danmaku listener for ${platform}/${roomId} did not return a stop function.`);
      ctx.isDanmakuListenerActive.value = false;
    }
  } catch (error) {
    console.error(`[Player] Failed to start danmaku listener for ${platform}/${roomId}:`, error);
    ctx.isDanmakuListenerActive.value = false;

    const errorMessage: DanmakuMessage = {
      id: `system-err-${Date.now()}`,
      nickname: '系统消息',
      content: '弹幕连接失败，请尝试刷新播放器。',
      isSystem: true,
      type: 'error',
      color: '#dc3545',
    };
    ctx.danmakuMessages.value.push(errorMessage);
  }
};

export const stopCurrentDanmakuListener = async (
  ctx: DanmakuManagerContext,
  platform?: StreamingPlatform,
  roomId?: string | null | undefined,
) => {
  if (platform) {
    if (platform === StreamingPlatform.DOUYU) {
      await stopDouyuDanmaku(roomId!, ctx.unlistenDanmakuFn.value);
    } else if (platform === StreamingPlatform.DOUYIN) {
      await stopDouyinDanmaku(ctx.unlistenDanmakuFn.value);
    } else if (platform === StreamingPlatform.HUYA) {
      await stopHuyaDanmaku(ctx.unlistenDanmakuFn.value);
    } else if (platform === StreamingPlatform.BILIBILI) {
      await stopBilibiliDanmaku(ctx.unlistenDanmakuFn.value);
    }
    if (ctx.unlistenDanmakuFn.value) {
      ctx.unlistenDanmakuFn.value = null;
    }
  } else if (ctx.unlistenDanmakuFn.value) {
    console.warn('[Player] stopCurrentDanmakuListener called without platform, but a global unlistenDanmakuFn exists. Calling it now.');
    try {
      ctx.unlistenDanmakuFn.value();
      ctx.unlistenDanmakuFn.value = null;
    } catch (error) {
      console.error('[Player] Error executing fallback unlistenDanmakuFn:', error);
      ctx.unlistenDanmakuFn.value = null;
    }
  }

  ctx.isDanmakuListenerActive.value = false;
};
