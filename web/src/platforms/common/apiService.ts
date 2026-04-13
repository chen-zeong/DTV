import { invoke } from '@tauri-apps/api/core'; // Added import for invoke
import * as douyuApi from '../douyu/api';
import * as douyuParsers from '../douyu/parsers'; // Import Douyu parsers
import { Platform } from './types'; // Import Platform enum
import type { SupportedPlatform, StreamerDetails, StreamPlaybackDetails, CommonCategoryGroup, CommonPlatformCategory } from './types'; // Import SupportedPlatform, StreamerDetails, and StreamPlaybackDetails, and CommonCategoryGroup, and CommonPlatformCategory

let currentPlatform: SupportedPlatform = 'douyu'; 

export function setCurrentPlatform(platform: SupportedPlatform) {
  currentPlatform = platform;
}

export function getCurrentPlatform(): SupportedPlatform {
  return currentPlatform;
}


export async function fetchRoomInfo(roomId: string): Promise<StreamerDetails> {
  switch (currentPlatform) {
    case 'douyu':
      const douyuData = await douyuApi.fetchDouyuRoomInfo(roomId);
      return douyuParsers.parseDouyuRoomDataToStreamerDetails(roomId, douyuData);
    default:
      console.error(`Platform ${currentPlatform} not supported for fetchRoomInfo`);
      return Promise.reject(`Platform ${currentPlatform} not supported`);
  }
}

export async function startDanmakuListener(roomId: string): Promise<void> {
  switch (currentPlatform) {
    case 'douyu':
      return douyuApi.startDouyuDanmakuListener(roomId);
    default:
      console.error(`Platform ${currentPlatform} not supported for startDanmakuListener`);
      return Promise.reject(`Platform ${currentPlatform} not supported`);
  }
}

// --- Categories --- //
export async function fetchCategories(): Promise<CommonCategoryGroup[]> {
  switch (currentPlatform) {
    case 'douyu':
      const groups = await invoke<CommonCategoryGroup[]>('fetch_categories');
      return groups;
    default:
      console.error(`Platform ${currentPlatform} not supported for fetchCategories`);
      return Promise.reject(`Platform ${currentPlatform} not supported`);
  }
}

export async function fetchSubCategories(parentId: string): Promise<CommonPlatformCategory[]> {
  if (!parentId) {
    console.warn('[apiService] fetchSubCategories called with no parentId');
    return Promise.resolve([]);
  }
  switch (currentPlatform) {
    case 'douyu':
      const subCategories = await invoke<CommonPlatformCategory[]>('fetch_three_cate', { tagId: parentId });
      return subCategories;
    default:
      console.error(`Platform ${currentPlatform} not supported for fetchSubCategories`);
      return Promise.reject(`Platform ${currentPlatform} not supported`);
  }
}

// --- Stream Playback Details --- //
export async function fetchStreamPlaybackDetails(roomId: string, platform?: Platform): Promise<StreamPlaybackDetails> {
  const targetPlatform = platform || currentPlatform; // Use provided platform or fallback to global
  switch (targetPlatform) {
    case Platform.DOUYU: // Use Platform enum
      const rawUrl = await douyuApi.fetchDouyuStreamUrlRaw(roomId);
      return douyuParsers.parseDouyuStreamDataToPlaybackDetails(roomId, rawUrl);
    case Platform.DOUYIN:
      return Promise.reject('Douyin stream details should be provided directly, not fetched via this common service.');
    default:
      console.error(`Platform ${targetPlatform} not supported for fetchStreamPlaybackDetails`);
      return Promise.reject(`Platform ${targetPlatform} not supported`);
  }
}