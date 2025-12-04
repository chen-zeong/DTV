export type SupportedPlatform = "douyu" | "bilibili" | "douyin" | "huya";

export enum Platform {
  DOUYU = "DOUYU",
  DOUYIN = "DOUYIN",
  HUYA = "HUYA",
  BILIBILI = "BILIBILI",
}

export type LiveStatus = "LIVE" | "REPLAY" | "OFFLINE" | "UNKNOWN";

export interface BaseStreamer {
  platform: Platform;
  id: string;
  nickname: string;
  avatarUrl: string;
  displayName?: string;
  isLive?: boolean | null;
  liveStatus?: LiveStatus;
  lastUpdated?: number;
  isPinned?: boolean;
}

export interface FollowedStreamer extends BaseStreamer {
  roomTitle?: string;
  followedAt?: number;
  currentRoomId?: string;
}

export interface StreamVariant {
  url: string;
  format?: string | null;
  desc?: string | null;
  qn?: number | null;
  protocol?: string | null;
}

export interface LiveStreamInfo {
  title?: string | null;
  anchor_name?: string | null;
  avatar?: string | null;
  stream_url?: string | null;
  status?: number | null;
  error_message?: string | null;
  upstream_url?: string | null;
  available_streams?: StreamVariant[] | null;
  normalized_room_id?: string | null;
  web_rid?: string | null;
}
