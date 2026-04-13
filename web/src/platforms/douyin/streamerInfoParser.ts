import { invoke } from '@tauri-apps/api/core';
import type { StreamerDetails } from '../common/types';

// This interface should match the Rust struct LiveStreamInfo returned by get_douyin_live_stream_url
interface LiveStreamInfoFromRust {
  title?: string | null;
  anchor_name?: string | null;
  avatar?: string | null;
  stream_url?: string | null; // Not directly used by StreamerDetails for info display, but part of payload
  status?: number | null;     // The status field: 0 for live for Douyin, other values might mean replay/ended.
  error_message?: string | null;
}

interface DouyinStreamerInfoParserProps {
  roomId: string;
  initialTitle?: string | null;
  initialAnchorName?: string | null;
  initialAvatar?: string | null;
}

export async function getDouyinStreamerDetails(
  props: DouyinStreamerInfoParserProps
): Promise<StreamerDetails> {
  try {
    const rustPayload = { args: { room_id_str: props.roomId } };
    const data = await invoke<LiveStreamInfoFromRust>('get_douyin_live_stream_url', { payload: rustPayload });

    if (data.error_message) {
      console.error(
        `[StreamerInfo/douyinParser.ts] Error from get_douyin_live_stream_url for room ${props.roomId}: ${data.error_message}`
      );
      // On error from API, return details with an error indication or use initial props as fallback.
      return {
        roomId: props.roomId,
        platform: 'douyin', // Explicitly set platform as it's not in LiveStreamInfoFromRust
        nickname: props.initialAnchorName || '获取失败',
        roomTitle: props.initialTitle || '直播信息获取失败',
        avatarUrl: props.initialAvatar ?? null,
        isLive: false, // Assume not live on error
        viewerCount: 0, // Placeholder
        categoryName: 'N/A', // Placeholder
        errorMessage: data.error_message, // Pass along the error message
      };
    }


    const isLive = data.status === 2;

    return {
      roomId: props.roomId,
      platform: 'douyin', // Explicitly set platform
      nickname: data.anchor_name || props.initialAnchorName || '抖音主播',
      roomTitle: data.title || props.initialTitle || '精彩直播中',
      avatarUrl: data.avatar ?? props.initialAvatar ?? null,
      isLive: isLive,
      viewerCount: 0,   // Placeholder
      categoryName: 'N/A', // Placeholder
      errorMessage: null, // No error from API
    };

  } catch (error) {
    console.error(
        `[StreamerInfo/douyinParser.ts] Exception invoking get_douyin_live_stream_url for room ${props.roomId}:`,
         error
    );
    // On exception during invoke, return details with an error indication.
    return {
      roomId: props.roomId,
      platform: 'douyin',
      nickname: props.initialAnchorName || '获取异常',
      roomTitle: props.initialTitle || '直播信息获取异常',
      avatarUrl: props.initialAvatar ?? null,
      isLive: false, // Assume not live on exception
      viewerCount: 0,
      categoryName: 'N/A',
      errorMessage: typeof error === 'string' ? error : (error instanceof Error ? error.message : '未知异常'),
    };
  }
} 