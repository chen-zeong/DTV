import { invoke } from '@tauri-apps/api/core';
import type { DouyuRoomInfo, DouyuRawCategoriesResponseData } from './types';

export async function fetchDouyuRoomInfo(roomId: string): Promise<DouyuRoomInfo> {
  if (!roomId) {
    console.warn('fetchDouyuRoomInfo: roomId is not provided.');
    return Promise.reject('Room ID is required.');
  }
  try {
    const response = await invoke<any>('fetch_douyu_room_info', { roomId });

    if (response && typeof response === 'object') {
      // Standard Douyu API practice: check for an error code in the response.
      // The actual key for error might be 'error' or 'code'. Adjust if necessary.
      if (('error' in response && response.error !== 0) || ('code' in response && response.code !== 0)) {
        const errorCode = response.error !== undefined ? response.error : response.code;
        const errorMessage = `Douyu API returned an error for room ${roomId}: (code ${errorCode}) ${response.msg || response.message || 'Unknown API error'}`;
        console.error(errorMessage, response);
        throw new Error(errorMessage);
      }

      // The actual room data is often nested, commonly under a 'data' or 'room' key.
      // Inspect the actual API response of `https://www.douyu.com/betard/{roomId}` to confirm.
      let actualRoomData: DouyuRoomInfo | undefined = undefined;

      if ('data' in response && typeof response.data === 'object' && response.data !== null) {
        actualRoomData = response.data as DouyuRoomInfo;
      } else if ('room' in response && typeof response.room === 'object' && response.room !== null) { // Another common key
        actualRoomData = response.room as DouyuRoomInfo;
      } else if ('room_id' in response) { // Fallback: maybe the top level IS the room info
        actualRoomData = response as DouyuRoomInfo;
      } else {
        // If none of the above, the structure is unexpected.
        const errorMessage = `Could not find room data in Douyu API response for room ${roomId}. Expected 'data' or 'room' key, or direct room object.`;
        console.error(errorMessage, response);
        throw new Error(errorMessage);
      }
      
      // After potentially extracting, validate if we have the necessary fields (e.g., room_id)
      // The parser function will do more thorough checks, but a basic one here is good.
      if (actualRoomData && typeof actualRoomData.room_id !== 'undefined') {
        return actualRoomData;
      } else {
        const errorMessage = `Extracted room data is invalid or missing room_id for room ${roomId}.`;
        console.error(errorMessage, 'Extracted:', actualRoomData, 'Full Response:', response);
        throw new Error(errorMessage);
      }

    } else {
      const errorMessage = `Unexpected or non-object response from fetch_douyu_room_info for room ${roomId}.`;
      console.error(errorMessage, response);
      throw new Error(errorMessage);
    }
  } catch (error) {
    // This catches errors from invoke itself (e.g., Rust command panicked) or errors thrown above.
    console.error(`Error in fetchDouyuRoomInfo for room ${roomId}:`, error);
    // Ensure the error is an Error object for consistent handling upstream
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(String(error || 'Unknown error in fetchDouyuRoomInfo'));
  }
}

export async function startDouyuDanmakuListener(roomId: string): Promise<void> {
  if (!roomId) {
    console.warn('startDouyuDanmakuListener: roomId is not provided.');
    return Promise.reject('Room ID is required for Danmaku listener.');
  }
  try {
    await invoke<void>('start_danmaku_listener', { roomId });
  } catch (error) {
    console.error(`Error starting Douyu danmaku listener for ${roomId}:`, error);
    throw error; // Re-throw to be handled by the caller
  }
}


export async function fetchDouyuStreamUrlRaw(roomId: string): Promise<string> {
  if (!roomId) {
    console.warn('[Douyu API] fetchDouyuStreamUrlRaw: roomId is not provided.');
    return Promise.reject('Room ID is required to fetch stream URL.');
  }
  try {
    // Assuming get_stream_url_cmd returns a simple string URL
    const url = await invoke<string>('get_stream_url_cmd', { roomId }); 
    if (!url) {
      console.error(`[Douyu API] fetchDouyuStreamUrlRaw: Received empty URL for room ${roomId}`);
      return Promise.reject('Empty stream URL received');
    }
    return url;
  } catch (error) {
    console.error(`[Douyu API] Error fetching Douyu stream URL for ${roomId}:`, error);
    throw error;
  }
}

/**
 * Fetches raw category data from the Douyu platform.
 */
export async function fetchDouyuCategoriesRaw(): Promise<DouyuRawCategoriesResponseData> {
  try {
    const rawData = await invoke<DouyuRawCategoriesResponseData>('fetch_douyu_categories_cmd');
    if (typeof rawData !== 'object' || rawData === null) {
        console.error('[Douyu API] fetchDouyuCategoriesRaw: Received non-object data:', rawData);
        throw new Error('Invalid category data received from backend');
    }
    return rawData; // This should be DouyuRawCategoriesResponseData (containing category_groups)
  } catch (error) {
    console.error('[Douyu API] Error fetching Douyu categories raw:', error);
    if (typeof error === 'string') {
        throw new Error(error);
    }
    throw error; 
  }
}

// Douyu specific API calls will go here
export {}; 