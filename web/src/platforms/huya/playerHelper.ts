import { invoke } from '@tauri-apps/api/core';
import { listen, type Event as TauriEvent } from '@tauri-apps/api/event';
import type { Ref } from '../common/ref';
import type { DanmakuMessage, DanmuOverlayInstance, DanmuRenderOptions } from '../../components/player/types';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/utils/logger';

export interface HuyaUnifiedEntry { quality: string; bitRate: number; url: string; }

let huyaProxyActive = false;

export async function getHuyaStreamConfig(
  roomId: string,
  quality: string = '原画',
  line?: string | null,
): Promise<{
  streamUrl: string;
  streamType: string | undefined;
  title?: string | null;
  anchorName?: string | null;
  avatar?: string | null;
  isLive?: boolean | null;
}> {
  logger.debug('[HuyaPlayerHelper] getHuyaStreamConfig', { roomId, quality, line });
  try {
    const result = await invoke<any>('get_huya_unified_cmd', { roomId: roomId, quality, line: line ?? null });
    logger.debug('[HuyaPlayerHelper] getHuyaStreamConfig result', result);
    
    if (result && result.flv_tx_urls && Array.isArray(result.flv_tx_urls)) {
      const upstreamStreamUrl = pickHuyaUrlByQuality(result.flv_tx_urls, quality) || result.flv_tx_urls[0]?.url;
      if (!upstreamStreamUrl) throw new Error('主播未开播或无法获取直播流');

      const sanitizedUpstream = enforceHttps(upstreamStreamUrl);
      const streamType = inferStreamType(sanitizedUpstream);

      // 对齐 pure_live：虎牙播放需要稳定的 UA/Referer/Origin；WebView 无法给 FLV 请求加自定义 Header，走本地 proxy 注入。
      let finalStreamUrl = sanitizedUpstream;
      try {
        await invoke('set_stream_url_cmd', { url: sanitizedUpstream });
        const proxyUrl = await invoke<string>('start_proxy');
        if (proxyUrl) {
          finalStreamUrl = proxyUrl;
          huyaProxyActive = true;
        }
      } catch {
        // proxy 非关键：失败则回退直连（避免阻断播放），但可能更容易断流
        huyaProxyActive = false;
      }

      return {
        streamUrl: finalStreamUrl,
        streamType,
        title: result?.title ?? null,
        anchorName: result?.nick ?? null,
        avatar: result?.avatar ?? null,
        isLive: typeof result?.is_live === 'boolean' ? result.is_live : null,
      };
    } else {
      // 数据异常或为空，一般意味着未开播或房间详情获取失败
      throw new Error('主播未开播或获取虎牙房间详情失败');
    }
  } catch (error: any) {
    logger.error('[HuyaPlayerHelper] getHuyaStreamConfig error:', error);
    // 若后端明确返回未开播文案，直接透传；否则统一按未开播处理
    const msg = (error?.message || '').trim();
    if (msg.includes('未开播')) {
      throw new Error(msg);
    }
    throw new Error('主播未开播或无法获取直播流');
  }
}

export async function stopHuyaProxy(): Promise<void> {
  if (!huyaProxyActive) return;
  try {
    await invoke('stop_proxy');
  } catch {
    // ignore
  } finally {
    huyaProxyActive = false;
  }
}

// 统一的 Rust 弹幕事件负载（与 Douyin/Douyu 保持一致）
interface UnifiedRustDanmakuPayload {
  room_id: string;
  user: string;
  content: string;
  user_level: number;
  fans_club_level: number;
}
let currentHuyaRoomId: string | null = null;

export async function startHuyaDanmakuListener(
  roomId: string,
  danmuOverlay: DanmuOverlayInstance | null,
  danmakuMessagesRef: Ref<DanmakuMessage[]>,
  renderOptions?: DanmuRenderOptions
): Promise<() => void> {
  logger.debug('[HuyaPlayerHelper] Starting Huya danmaku listener', { roomId });
  currentHuyaRoomId = roomId;
  
  try {
    // 调用后端虎牙弹幕监听命令
    await invoke('start_huya_danmaku_listener', { payload: { args: { room_id_str: roomId } } });
    logger.debug('[HuyaPlayerHelper] Backend Huya danmaku listener started');
  } catch (error) {
    logger.error('[HuyaPlayerHelper] Failed to start backend Huya danmaku listener:', error);
    throw error;
  }

  // 监听弹幕事件
  const eventName = 'danmaku-message';
  
  const unlisten = await listen<UnifiedRustDanmakuPayload>(eventName, (event: TauriEvent<UnifiedRustDanmakuPayload>) => {
    logger.debug('[HuyaPlayerHelper] Received danmaku event', event.payload);
    
    // 只处理当前房间的弹幕（后端 payload 字段为 room_id/user/content/...）
    if (!event.payload || event.payload.room_id !== roomId) {
      return;
    }

    const frontendDanmaku: DanmakuMessage = {
      id: uuidv4(),
      nickname: event.payload.user || '未知用户',
      content: event.payload.content,
      level: String(event.payload.user_level ?? 0),
      badgeLevel: event.payload.fans_club_level != null ? String(event.payload.fans_club_level) : undefined,
      room_id: roomId,
    };

    const shouldDisplay = renderOptions?.shouldDisplay ? renderOptions.shouldDisplay(frontendDanmaku) : true;

    if (shouldDisplay && danmuOverlay?.sendComment) {
      try {
        const commentOptions = renderOptions?.buildCommentOptions?.(frontendDanmaku) ?? {};
        const styleFromOptions = commentOptions.style ?? {};
        const preferredColor = styleFromOptions.color || (frontendDanmaku as any).color || '#FFFFFF';
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
        logger.warn('[HuyaPlayerHelper] Failed emitting danmu.js comment:', emitError);
      }
    }

    // 添加到弹幕消息列表
    const shouldAppend = renderOptions?.shouldAppendToList ? renderOptions.shouldAppendToList(frontendDanmaku) : true;
    if (shouldAppend) {
      danmakuMessagesRef.value.push(frontendDanmaku);
      if (danmakuMessagesRef.value.length > 200) {
        danmakuMessagesRef.value.splice(0, danmakuMessagesRef.value.length - 200);
      }
    }
  });

  logger.debug('[HuyaPlayerHelper] Event listener registered', { eventName });
  
  return unlisten;
}

export async function stopHuyaDanmaku(currentUnlistenFn: (() => void) | null): Promise<void> {
  if (currentUnlistenFn) {
    try { 
      currentUnlistenFn(); 
      logger.debug('[HuyaPlayerHelper] Event listener unregistered');
    } catch (e) { 
      logger.warn('[HuyaPlayerHelper] stopHuyaDanmaku cleanup error:', e); 
    }
  }
  
  // 停止后端虎牙弹幕监听
  try {
    const roomIdToStop = currentHuyaRoomId || '';
    await invoke('stop_huya_danmaku_listener', { roomId: roomIdToStop });
  } catch (e) {
    logger.warn('[HuyaPlayerHelper] stopHuyaDanmaku: backend stop encountered error (ignored):', e);
  }
  currentHuyaRoomId = null;
  logger.debug('[HuyaPlayerHelper] Huya danmaku stopped');
}

function pickHuyaUrlByQuality(entries: HuyaUnifiedEntry[], quality: string): string | undefined {
  const target = entries.find((e) => e.quality === quality);
  return target?.url;
}

function enforceHttps(url: string): string {
  if (!url) return url;
  if (url.startsWith('http://')) {
    return url.replace('http://', 'https://');
  }
  return url;
}

function inferStreamType(url: string): string | undefined {
  if (!url) return undefined;
  if (url.includes('.flv')) {
    return 'flv';
  }
  if (url.includes('.m3u8')) {
    return 'hls';
  }
  return undefined;
}
