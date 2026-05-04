import { invoke } from '@tauri-apps/api/core';
import { listen, type Event as TauriEvent } from '@tauri-apps/api/event';
import type { Ref } from '../common/ref';
import { Platform } from '../common/types';
import type { DanmakuMessage, DanmuOverlayInstance, DanmuRenderOptions, RustGetStreamUrlPayload } from '../../components/player/types';
import type { LiveStreamInfo } from '../common/types';
import { v4 as uuidv4 } from 'uuid';


export interface DouyinRustDanmakuPayload {
  room_id?: string; 
  user: string;      // Nickname from Rust's DanmakuFrontendPayload
  content: string;
  user_level: number; // from Rust's i64
  fans_club_level: number; // from Rust's i32
}

export async function fetchAndPrepareDouyinStreamConfig(roomId: string, quality: string = '原画'): Promise<{ 
  streamUrl: string | null;
  streamType: string | undefined; 
  title?: string | null; 
  anchorName?: string | null; 
  avatar?: string | null; 
  isLive: boolean; 
  normalizedRoomId?: string | null;
  webRid?: string | null;
  initialError: string | null; // Made non-optional, will always be string or null
}> {
  if (!roomId) {
    return {
      streamUrl: null,
      streamType: undefined,
      title: null,
      anchorName: null,
      avatar: null,
      isLive: false,
      normalizedRoomId: null,
      webRid: null,
      initialError: '房间ID未提供'
    };
  }

  const payloadData = { args: { room_id_str: roomId } };
  const backendQuality = normalizeDouyinQuality(quality);
  const MAX_ATTEMPTS = 2; // 最多重试一次

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // 使用画质参数调用抖音画质切换API
      const result = await invoke<LiveStreamInfo>('get_douyin_live_stream_url_with_quality', {
        payload: payloadData,
        quality: backendQuality,
      });

      const errorMsg = (result.error_message || '').trim();
      if (errorMsg) {
        console.error(`[DouyinPlayerHelper] Error from backend for room ${roomId}: ${errorMsg}`);
        const definitelyOffline = errorMsg.includes('未开播') || errorMsg.includes('不存在') || result.status !== 2;
        if (definitelyOffline || attempt >= MAX_ATTEMPTS) {
          return {
            streamUrl: null,
            streamType: undefined,
            title: result.title,
            anchorName: result.anchor_name,
            avatar: result.avatar,
            isLive: result.status === 2,
            normalizedRoomId: result.normalized_room_id ?? null,
            webRid: result.web_rid ?? null,
            initialError: errorMsg,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 450));
        continue;
      }

      const streamAvailable = result.status === 2 && !!result.stream_url;
      const rawStreamUrl = result.stream_url ?? null;

      // 未开播：不重试
      if (result.status !== 2) {
        return {
          streamUrl: null,
          streamType: undefined,
          title: result.title,
          anchorName: result.anchor_name,
          avatar: result.avatar,
          isLive: false,
          normalizedRoomId: result.normalized_room_id ?? null,
          webRid: result.web_rid ?? null,
          initialError: '主播未开播。',
        };
      }

      // 在线但没拿到流：允许重试一次
      if (!streamAvailable || !rawStreamUrl) {
        if (attempt >= MAX_ATTEMPTS) {
          return {
            streamUrl: null,
            streamType: undefined,
            title: result.title,
            anchorName: result.anchor_name,
            avatar: result.avatar,
            isLive: false,
            normalizedRoomId: result.normalized_room_id ?? null,
            webRid: result.web_rid ?? null,
            initialError: '主播在线，但获取直播流失败。',
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 450));
        continue;
      }

      const sanitizedStreamUrl = enforceHttps(rawStreamUrl);
      let streamType: string | undefined = undefined;

      if (rawStreamUrl.startsWith('http://127.0.0.1') && rawStreamUrl.endsWith('/live.flv')) {
        streamType = 'flv';
      } else if (rawStreamUrl.includes('pull-hls') || rawStreamUrl.endsWith('.m3u8')) {
        console.warn(`[DouyinPlayerHelper] Received HLS-like stream URL (${rawStreamUrl}), but expected flv. Overriding to flv.`);
        streamType = 'flv';
      } else if (rawStreamUrl.includes('pull-flv') || rawStreamUrl.includes('.flv')) {
        streamType = 'flv';
      } else {
        console.warn(`[DouyinPlayerHelper] Could not determine stream type for URL: ${rawStreamUrl}. Defaulting to flv.`);
        streamType = 'flv';
      }

      return {
        streamUrl: sanitizedStreamUrl,
        streamType,
        title: result.title,
        anchorName: result.anchor_name,
        avatar: result.avatar,
        isLive: true,
        normalizedRoomId: result.normalized_room_id ?? null,
        webRid: result.web_rid ?? null,
        initialError: null,
      };
    } catch (e: any) {
      console.error(`[DouyinPlayerHelper] Exception while fetching Douyin stream details for ${roomId} (attempt ${attempt}/${MAX_ATTEMPTS}):`, e);
      if (attempt >= MAX_ATTEMPTS) {
        return {
          streamUrl: null,
          streamType: undefined,
          title: null,
          anchorName: null,
          avatar: null,
          isLive: false,
          normalizedRoomId: null,
          webRid: null,
          initialError: e?.message || '获取直播信息失败: 未知错误',
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
  }

  return {
    streamUrl: null,
    streamType: undefined,
    title: null,
    anchorName: null,
    avatar: null,
    isLive: false,
    normalizedRoomId: null,
    webRid: null,
    initialError: '主播未开播或无法获取直播流',
  };
}

function normalizeDouyinQuality(input: string): string {
  const upper = input.trim().toUpperCase();
  if (upper === 'OD' || upper === '原画') return 'OD';
  if (upper === 'BD' || upper === '标清') return 'BD';
  if (upper === 'UHD' || upper === '高清') return 'UHD';
  return 'OD';
}

export async function startDouyinDanmakuListener(
  roomId: string,
  danmuOverlay: DanmuOverlayInstance | null, // For emitting danmaku to overlay
  danmakuMessagesRef: Ref<DanmakuMessage[]>, // For updating DanmuList
  renderOptions?: DanmuRenderOptions
): Promise<() => void> {
  
  const rustPayload: RustGetStreamUrlPayload = { 
    args: { room_id_str: roomId }, 
    platform: Platform.DOUYIN, 
  };
  await invoke('start_douyin_danmu_listener', { payload: rustPayload });
  
  const eventName = 'danmaku-message';

  const unlisten = await listen<DouyinRustDanmakuPayload>(eventName, (event: TauriEvent<DouyinRustDanmakuPayload>) => {
    if (event.payload) {
      const rustP = event.payload;
      const frontendDanmaku: DanmakuMessage = {
        id: uuidv4(),
        nickname: rustP.user || '未知用户',
        content: rustP.content || '',
        level: String(rustP.user_level || 0),
        badgeLevel: rustP.fans_club_level > 0 ? String(rustP.fans_club_level) : undefined,
        room_id: rustP.room_id || roomId, // Ensure room_id is present
      };

      const shouldDisplay = renderOptions?.shouldDisplay ? renderOptions.shouldDisplay(frontendDanmaku) : true;

      if (shouldDisplay && danmuOverlay?.sendComment) {
        try {
          const commentOptions = renderOptions?.buildCommentOptions?.(frontendDanmaku) ?? {};
          const styleFromOptions = commentOptions.style ?? {};
          const preferredColor = styleFromOptions.color || frontendDanmaku.color || '#FFFFFF';
          danmuOverlay.sendComment({
            id: frontendDanmaku.id,
            txt: frontendDanmaku.content,
            duration: commentOptions.duration ?? 12000,
            mode: commentOptions.mode ?? 'scroll',
            style: {
              ...styleFromOptions,
              color: preferredColor,
            },
          });
        } catch (emitError) {
          console.warn('[DouyinPlayerHelper] Failed emitting danmu.js comment:', emitError);
        }
      }
      const shouldAppend = renderOptions?.shouldAppendToList ? renderOptions.shouldAppendToList(frontendDanmaku) : true;
      if (shouldAppend) {
        danmakuMessagesRef.value.push(frontendDanmaku);
        if (danmakuMessagesRef.value.length > 200) { // Manage danmaku array size
          danmakuMessagesRef.value.splice(0, danmakuMessagesRef.value.length - 200);
        }
      }
    }
  });
  return unlisten;
}

export async function stopDouyinDanmaku(currentUnlistenFn: (() => void) | null): Promise<void> {
  if (currentUnlistenFn) {
    currentUnlistenFn();
  }
  try {
    await invoke('stop_douyin_danmu_listener');
  } catch (error) {
    console.error('[DouyinPlayerHelper] Error stopping Douyin danmaku listener:', error);
  }
}

function enforceHttps(url: string): string {
  if (!url) {
    return url;
  }
  if (url.startsWith('https://')) {
    return url;
  }
  if (url.startsWith('http://')) {
    return `https://${url.slice('http://'.length)}`;
  }
  return url;
}
