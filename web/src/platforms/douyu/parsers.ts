import type { StreamerDetails, StreamPlaybackDetails, CommonCategoryGroup, CommonPlatformCategory } from '../common/types';
import { CommonDanmakuMessage } from '../common/types';
import { v4 as uuidv4 } from 'uuid';
import { DouyuRawCategoriesResponseData, DouyuRawCategoryGroup, DouyuRawGameCategory, DouyuRoomInfo } from './types';

/**
 * Parses raw Douyu room data (DouyuRoomInfo) into the common StreamerDetails format.
 */
export function parseDouyuRoomDataToStreamerDetails(roomId: string, data: DouyuRoomInfo): StreamerDetails {
  if (!data || !data.room_id) {
    console.error('[Douyu Parser] Invalid data provided to parseDouyuRoomDataToStreamerDetails for room:', roomId, data);
    return {
      roomId: roomId,
      platform: 'douyu',
      roomTitle: '数据解析失败',
      nickname: '未知主播',
      avatarUrl: '',
      isLive: false,
      isReplay: false,
      categoryName: '未知分类',
      viewerCount: 0,
    };
  }

  const { room_name, nickname, show_status, videoLoop, avatar_mid, cate_name, online_num } = data;
  
  const showStatusNum = Number(show_status);
  const videoLoopNum = Number(videoLoop);

  const isLive = showStatusNum === 1 && videoLoopNum !== 1;
  const isReplay = showStatusNum === 1 && videoLoopNum === 1;

  return {
    roomId: roomId,
    platform: 'douyu',
    roomTitle: room_name || '未知房间名',
    nickname: nickname || '未知主播',
    avatarUrl: avatar_mid || '',
    isLive: isLive,
    isReplay: isReplay,
    categoryName: cate_name || '游戏分区',
    viewerCount: Number(online_num) || 0,
  };
}

export function parseDouyuDanmakuMessage(rawPayload: any): CommonDanmakuMessage | null {
  if (!rawPayload || !rawPayload.type) {
    // console.warn('[Douyu Parser] Received danmaku payload without type:', rawPayload);
    return null; // Or handle as a generic system message
  }

  let commonType: CommonDanmakuMessage['type'] = 'other';
  let content = rawPayload.content || '';

  switch (rawPayload.type) {
    case 'chatmsg':
      commonType = 'chat';
      break;
    case 'uenter':
      // commonType = 'enter';
      // content = `${rawPayload.nickname || '用户'} 进入直播间`; // Create content for enter messages
      return null; // Filter out 'uenter' messages
    case 'gifttransform': // Example: Douyu gift type
    case 'dgb':
      commonType = 'gift';
      content = `${rawPayload.nickname || '用户'}赠送了${rawPayload.gfid || '礼物'}`;
      // More detailed gift parsing could be done here
      break;
    // Add other Douyu specific type mappings here
    default:
      // console.log('[Douyu Parser] Unhandled Douyu danmaku type:', rawPayload.type, rawPayload);
      // Keep as 'other' or return null if you don't want to display unhandled types
      break;
  }

  // Convert Douyu color (numeric string) to hex if present
  let hexColor: string | undefined = undefined;
  if (rawPayload.color) {
    const numColor = parseInt(rawPayload.color, 10);
    if (!isNaN(numColor) && numColor >= 0 && numColor <= 16777215) {
      hexColor = '#' + numColor.toString(16).padStart(6, '0');
    }
  }

  return {
    id: uuidv4(), // Generate a unique ID for the list key
    platform: 'douyu',
    type: commonType,
    sender: {
      uid: rawPayload.uid,
      nickname: rawPayload.nickname || '未知用户',
      level: rawPayload.level ? parseInt(rawPayload.level, 10) : undefined,
      badgeName: rawPayload.badgeName,
      badgeLevel: rawPayload.badgeLevel ? parseInt(rawPayload.badgeLevel, 10) : undefined,
    },
    content: content,
    timestamp: Date.now(), // Use current time as received time
    color: hexColor,
    rawData: rawPayload, // Include raw data for potential future use or debugging
  };
}

/**
 * Parses a raw Douyu stream URL into the common StreamPlaybackDetails format.
 * Currently, this is a simple wrapper as Douyu typically provides a direct M3U8 or FLV URL.
 * This function can be expanded if Douyu starts providing multiple quality options or more complex data.
 */
export function parseDouyuStreamDataToPlaybackDetails(roomId: string, rawUrl: string): StreamPlaybackDetails {
  if (!rawUrl) {
    console.error('[Douyu Parser] Invalid rawUrl provided to parseDouyuStreamDataToPlaybackDetails for room:', roomId);
    // Consider a more robust error object or a specific error state
    return {
      platform: 'douyu',
      roomId: roomId,
      primaryUrl: '', // Indicate error with empty URL
      format: 'other', 
      qualityOptions: [],
    };
  }

  // Basic determination of format from URL extension.
  // This is a simplification; more robust detection might be needed.
  let format: StreamPlaybackDetails['format'] = 'other';
  if (rawUrl.includes('.m3u8')) {
    format = 'm3u8';
  } else if (rawUrl.includes('.flv')) {
    format = 'flv';
  }
  // Add more formats if necessary

  return {
    platform: 'douyu',
    roomId: roomId,
    primaryUrl: rawUrl,
    format: format,
    // qualityOptions could be populated here if the API provided them
    // For now, we assume the single URL is the one to use.
  };
}

/**
 * Parses raw Douyu categories data into an array of common category groups.
 */
export function parseDouyuCategories(rawData: DouyuRawCategoriesResponseData): CommonCategoryGroup[] {
  if (!rawData || !rawData.category_groups || !Array.isArray(rawData.category_groups)) {
    console.warn('[Douyu Parser] Invalid or empty category_groups in rawData for parseDouyuCategories:', rawData);
    return [];
  }

  return rawData.category_groups.map((group: DouyuRawCategoryGroup) => {
    const commonCategories: CommonPlatformCategory[] = group.list.map((game: DouyuRawGameCategory) => ({
      id: game.cate_id, // Assuming cate_id is the primary identifier
      name: game.game_name,
      platform: 'douyu',
      iconUrl: game.game_icon, // Use game_icon, might need a default if not present
      // parentId: group.tag_id, // Optionally link category to its group ID if needed
      // any other common fields like game_type, short_name etc.
    }));

    return {
      groupName: group.tag_name,
      platform: 'douyu',
      categories: commonCategories,
    };
  });
}

// Add other Douyu specific parsers here 