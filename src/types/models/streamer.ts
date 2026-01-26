import type { Platform, SupportedPlatform } from "../app/platform";
import type { LiveStatus } from "../app/status";

export interface BaseStreamer {
  platform: Platform;
  id: string; // Platform-specific ID, e.g., roomId
  nickname: string;
  avatarUrl: string | null;
  displayName?: string;
  isLive?: boolean | null;
  liveStatus?: LiveStatus;
  lastUpdated?: number;
  isPinned?: boolean;
}

export interface LiveStreamer extends BaseStreamer {
  roomTitle: string;
  viewerCount?: number;
  categoryName?: string;
  previewImageUrl?: string;
}

export interface FollowedStreamer extends BaseStreamer {
  roomTitle?: string;
  followedAt?: number;
  lastViewedAt?: number;
  currentRoomId?: string;
  lastError?: string;
  lastUpdateFailed?: boolean;
}

export interface StreamerDetails {
  roomId: string;
  platform: SupportedPlatform;
  roomTitle: string;
  nickname: string;
  avatarUrl: string | null;
  isLive: boolean;
  isLooping?: boolean;
  isReplay?: boolean;
  categoryName?: string;
  viewerCount?: number;
  errorMessage?: string | null;
  platformSpecific?: Record<string, any>;
  liveStatus?: LiveStatus;
}

export interface CommonStreamer {
  room_id: string;
  title: string;
  nickname: string;
  avatar: string;
  room_cover: string;
  viewer_count_str: string;
  platform: SupportedPlatform | string;
  web_id?: string;
  actual_room_id?: string;
}

export interface StreamRoomDetails extends LiveStreamer {
  streamUrl?: string;
  danmakuServerInfo?: any;
}
