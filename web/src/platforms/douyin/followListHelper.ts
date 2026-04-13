import { invoke } from '@tauri-apps/api/core';
import type { FollowedStreamer, LiveStreamInfo, LiveStatus } from '../common/types';

export async function refreshDouyinFollowedStreamer(
  streamer: FollowedStreamer
): Promise<Partial<FollowedStreamer>> {
  try {
    // The payload for 'get_douyin_live_stream_url' expects { payload: { args: { room_id_str: string } } }
    const payloadData = { args: { room_id_str: streamer.id } };
    const data = await invoke<LiveStreamInfo>('fetch_douyin_streamer_info', {
      payload: payloadData,
    });

    // Check if data is valid and there are no errors from the backend
    if (data && !data.error_message) {
      const isLive = data.status === 2;
      const liveStatus: LiveStatus = isLive ? 'LIVE' : 'OFFLINE';
      const nextId = data.web_rid || streamer.id;

      if (data.web_rid && data.web_rid !== streamer.id) {
        console.info(`[DouyinFollowHelper] Migrating stored ID ${streamer.id} -> ${data.web_rid}`);
      }

      return {
        id: nextId,
        isLive,
        liveStatus,
        nickname: data.anchor_name || streamer.nickname,
        roomTitle: data.title || streamer.roomTitle,
        avatarUrl: data.avatar || streamer.avatarUrl,
      };
    } else {
      if (data && data.error_message) {
        console.warn(
          `[DouyinFollowHelper] Error fetching Douyin room ${streamer.id}: ${data.error_message}`
        );
      } else {
        console.warn(
          `[DouyinFollowHelper] Received no/invalid data for Douyin room ${streamer.id}`,
          data
        );
      }
      return { isLive: false, liveStatus: 'OFFLINE' }; // Ensure these are set on error too
    }
  } catch (e) {
    console.error(
      `[DouyinFollowHelper] Failed to refresh Douyin streamer ${streamer.id}:`,
      e
    );
    return { isLive: false, liveStatus: 'OFFLINE' }; // Ensure these are set on error too
  }
} 
