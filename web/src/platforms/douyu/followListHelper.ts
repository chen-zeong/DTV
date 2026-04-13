import { invoke } from '@tauri-apps/api/core';
import type { FollowedStreamer, LiveStatus } from '../common/types';

// This interface should match the DouyuFollowInfo struct returned by Rust
interface DouyuFollowRoomInfo {
  room_id: string;      
  room_name?: string | null; 
  nickname?: string | null;
  avatar_url?: string | null;
  video_loop?: number | null; // Rust i64 maps to number in TS
  show_status?: number | null; // Changed to number
}

// Define what this function returns - it's a partial update for FollowedStreamer
// focusing on the fields this function is responsible for.
interface DouyuRefreshUpdate extends Partial<Omit<FollowedStreamer, 'liveStatus'>> {
  liveStatus: LiveStatus; // Use the common LiveStatus type
}

export async function refreshDouyuFollowedStreamer(
  streamer: FollowedStreamer
): Promise<DouyuRefreshUpdate> {
  try {
    const roomInfo = await invoke<DouyuFollowRoomInfo>('fetch_douyu_room_info', {
      roomId: streamer.id,
    });

    if (roomInfo && roomInfo.room_id === streamer.id) {
      let currentLiveStatus: LiveStatus = 'OFFLINE'; // Default to OFFLINE

      const sStatus = typeof roomInfo.show_status === 'number' ? roomInfo.show_status : null;
      const vLoop = typeof roomInfo.video_loop === 'number' ? roomInfo.video_loop : null;

      if (sStatus === 1) {
        if (vLoop === 1) {
          currentLiveStatus = 'REPLAY';
        } else if (vLoop === 0 || vLoop === null) { 
          currentLiveStatus = 'LIVE';
        } else {
          currentLiveStatus = 'OFFLINE'; 
          console.warn(`[DouyuFollowHelper] Room ${roomInfo.room_id}: show_status is 1, but video_loop is unexpected (${vLoop}). Defaulting to OFFLINE.`);
        }
      } else { // Any show_status other than 1 (e.g., 2 or null/missing)
        currentLiveStatus = 'OFFLINE';
      }
      
      console.log(
        `[DouyuFollowHelper] Refresh for ID: ${streamer.id} - Nick: ${roomInfo.nickname ?? 'N/A'}, Title: ${roomInfo.room_name ?? 'N/A'}, show_status: ${sStatus ?? 'N/A'}, video_loop: ${vLoop ?? 'N/A'}, Calculated LiveStatus: ${currentLiveStatus}`
      );

      return {
        liveStatus: currentLiveStatus,
        nickname: roomInfo.nickname ?? streamer.nickname,
        roomTitle: roomInfo.room_name ?? streamer.roomTitle,
        avatarUrl: roomInfo.avatar_url ?? streamer.avatarUrl,
      };
    } else { 
      console.warn(
        `[DouyuFollowHelper] Received data for unexpected room_id or null/undefined data for streamer ${streamer.id}. Expected: ${streamer.id}, Got: ${roomInfo?.room_id}. Full roomInfo:`, 
        roomInfo
      );
      return { liveStatus: 'OFFLINE' }; 
    }
  } catch (e: any) { 
    console.error(
      `[DouyuFollowHelper] Error invoking/processing 'fetch_douyu_room_info' for ${streamer.id}. Error:`, 
      e 
    );
    return { liveStatus: 'UNKNOWN' }; // Or 'OFFLINE' - UNKNOWN signals an error state more clearly
  }
} 