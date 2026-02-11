import { invoke } from '@tauri-apps/api/core';
import { listen, type Event as TauriEvent } from '@tauri-apps/api/event';
import type { LiveStreamInfo, StreamVariant } from '../common/types';
import type { Ref } from 'vue';
import type { DanmakuMessage, DanmuOverlayInstance, DanmuRenderOptions } from '../../components/player/types';
import { v4 as uuidv4 } from 'uuid';

export async function getBilibiliStreamConfig(
  roomId: string,
  quality: string = '原画',
  cookie?: string,
): Promise<{ streamUrl: string, streamType: string | undefined }> {
  if (!roomId) {
    throw new Error('房间ID未提供');
  }
  const payloadData = { args: { room_id_str: roomId } };
  // 若未显式传入 cookie，则尝试从 localStorage 读取，以确保最高画质可用
  const effectiveCookie = cookie ?? (typeof localStorage !== 'undefined' ? (localStorage.getItem('bilibili_cookie') || undefined) : undefined);
  const result = await invoke<LiveStreamInfo>('get_bilibili_live_stream_url_with_quality', {
    payload: payloadData,
    quality,
    cookie: effectiveCookie || null,
  });

  // 若后端返回错误，统一按“未开播”处理（除非明确包含未开播字样）
  if (result.error_message) {
    const msg = result.error_message.trim();
    if (msg.includes('未开播')) {
      throw new Error(msg);
    }
    // 其他错误也按未开播处理，以便显示离线页面
    throw new Error('主播未开播或无法获取直播流');
  }

  // 根据返回的状态判断是否在线（B 站约定 status === 1 为在线）
  if (typeof result.status !== 'undefined' && result.status !== 1) {
    throw new Error('主播未开播');
  }

  // 无播放地址也按未开播处理
  if (!result.stream_url) {
    throw new Error('主播未开播或无法获取直播流');
  }

  // 调试输出：真实上游地址与所有可用地址
  if (result.upstream_url) {
    console.info('[Bilibili] 上游真实地址（可用于 VLC 测试）:', result.upstream_url);
  }
  if (result.available_streams && Array.isArray(result.available_streams)) {
    console.info(`[Bilibili] 可用播放地址（共 ${result.available_streams.length} 条）:`);
    (result.available_streams as StreamVariant[]).forEach((v, idx) => {
      const meta = [v.format, v.desc, v.qn?.toString(), v.protocol].filter(Boolean).join(' | ');
      console.info(`  [${idx + 1}] ${v.url}${meta ? `  <<< ${meta}` : ''}`);
    });
  }

  let streamType: string | undefined;
  const streamUrlLower = result.stream_url.toLowerCase();

  if (
    streamUrlLower.startsWith('http://127.0.0.1') ||
    streamUrlLower.includes('/live.flv') ||
    streamUrlLower.includes('.flv')
  ) {
    streamType = 'flv';
  } else if (streamUrlLower.includes('.m3u8')) {
    streamType = 'hls';
  }

  if (!streamType && result.available_streams && Array.isArray(result.available_streams)) {
    const matchedVariant = (result.available_streams as StreamVariant[]).find((variant) => {
      if (!variant?.url) {
        return false;
      }
      const formatLower = variant.format?.toLowerCase() ?? '';
      const protocolLower = variant.protocol?.toLowerCase() ?? '';
      const isSameAsPrimary =
        variant.url === result.stream_url || variant.url === result.upstream_url;
      const isHlsCandidate =
        formatLower === 'ts' ||
        formatLower === 'fmp4' ||
        formatLower === 'mp4' ||
        formatLower === 'm4s' ||
        protocolLower.includes('hls');
      return isSameAsPrimary && isHlsCandidate;
    });
    if (matchedVariant) {
      streamType = 'hls';
    }
  }

  if (!streamType && result.upstream_url) {
    const upstreamLower = result.upstream_url.toLowerCase();
    if (upstreamLower.includes('.m3u8')) {
      streamType = 'hls';
    } else if (
      upstreamLower.startsWith('http://127.0.0.1') ||
      upstreamLower.includes('/live.flv') ||
      upstreamLower.includes('.flv')
    ) {
      streamType = 'flv';
    }
  }

  if (!streamType) {
    streamType = 'flv';
  }

  return { streamUrl: result.stream_url, streamType };
}

// 统一的 Rust 弹幕事件负载（与 Douyin/Douyu/Huya 保持一致）
interface UnifiedRustDanmakuPayload {
  room_id: string;
  user: string;
  content: string;
  user_level: number;
  fans_club_level: number;
}

export async function startBilibiliDanmakuListener(
  roomId: string,
  danmuOverlay: DanmuOverlayInstance | null,
  danmakuMessagesRef: Ref<DanmakuMessage[]>,
  cookie?: string,
  renderOptions?: DanmuRenderOptions,
): Promise<() => void> {
  // 启动后端 B 站弹幕监听（cookie 可选）；若未传，则从 localStorage 兜底读取
  const effectiveCookie = cookie ?? (typeof localStorage !== 'undefined' ? (localStorage.getItem('bilibili_cookie') || undefined) : undefined);
  await invoke('start_bilibili_danmaku_listener', {
    payload: { args: { room_id_str: roomId } },
    cookie: effectiveCookie || null,
  });

  const eventName = 'danmaku-message';
  const unlisten = await listen<UnifiedRustDanmakuPayload>(eventName, (event: TauriEvent<UnifiedRustDanmakuPayload>) => {
    if (!event.payload || event.payload.room_id !== roomId) return;

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
        console.warn('[BilibiliPlayerHelper] Failed emitting danmu.js comment:', emitError);
      }
    }

    const shouldAppend = renderOptions?.shouldAppendToList ? renderOptions.shouldAppendToList(frontendDanmaku) : true;
    if (shouldAppend) {
      danmakuMessagesRef.value.push(frontendDanmaku);
      if (danmakuMessagesRef.value.length > 200) {
        danmakuMessagesRef.value.splice(0, danmakuMessagesRef.value.length - 200);
      }
    }
  });
  return unlisten;
}

export async function stopBilibiliDanmaku(currentUnlistenFn: (() => void) | null): Promise<void> {
  if (currentUnlistenFn) {
    try { currentUnlistenFn(); } catch {}
  }
  try {
    await invoke('stop_bilibili_danmaku_listener');
  } catch {}
}
