import type { SupportedPlatform } from "../app/platform";

export type LiveStatusV2 = "live" | "offline" | "error";
export type StreamTypeV2 = "flv" | "hls" | "unknown";
export type LiveStreamModeV2 = "playback" | "meta";

export interface StreamVariant {
  url: string;
  format?: string | null;
  desc?: string | null;
  qn?: number | null;
  protocol?: string | null;
}

export interface GetLiveStreamRequestV2 {
  platform: SupportedPlatform;
  room_id: string;
  quality?: string | null;
  line?: string | null;
  cookie?: string | null;
  debug?: boolean | null;
  mode?: LiveStreamModeV2 | null;
}

export interface RoomMetaV2 {
  platform: SupportedPlatform;
  room_id: string;
  normalized_room_id?: string | null;
  web_rid?: string | null;
  title?: string | null;
  anchor_name?: string | null;
  avatar?: string | null;
}

export interface PlaybackV2 {
  url: string;
  stream_type: StreamTypeV2;
  upstream_url?: string | null;
  variants?: StreamVariant[] | null;
}

export interface LiveStreamResponseV2 {
  status: LiveStatusV2;
  room: RoomMetaV2;
  playback?: PlaybackV2 | null;
  error?: string | null;
}

export interface StreamQuality {
  quality: string;
  description: string;
  url: string;
}

export interface StreamPlaybackDetails {
  platform: SupportedPlatform;
  roomId: string;
  primaryUrl: string;
  format?: "m3u8" | "flv" | "mp4" | "other";
  qualityOptions?: StreamQuality[];
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
