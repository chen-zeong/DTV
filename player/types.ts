import { Platform } from '../../platforms/common/types';

// This interface represents the Rust struct: crate::platforms::common::GetStreamUrlPayload
// It is used as the type for the value of the 'payload' key when invoking 'start_douyin_danmu_listener'
// It might also be useful for other platform-specific player helpers if they use a similar payload structure.
export interface RustGetStreamUrlPayload {
  args: {
    room_id_str: string;
  };
  platform: Platform; // Platform enum from common/types
}

// This is the structure used in danmakuMessages array and for DanmuList component
export interface DanmakuMessage {
  id?: string;         // Added optional id for system messages or other needs
  type?: string;       // e.g., 'chatmsg', 'uenter' from Douyu, or general type for platform messages
  isSystem?: boolean;  // Added optional flag for system messages
  uid?: string;        // User ID, if available
  nickname: string;
  level?: string;       // String for display (e.g., user level) - Made optional
  content: string;     // The actual danmaku text or system message content
  badgeName?: string;
  badgeLevel?: string;  // String for display (e.g., fan badge level)
  color?: string;       // For UI customization of danmaku text
  room_id?: string;     // The room ID this danmaku belongs to (useful for multi-room contexts or debugging)
  // Add any other fields that are common across platforms for display in DanmuList
} 

export interface DanmuOverlayInstance {
  sendComment?: (comment: {
    id?: string;
    txt: string;
    duration?: number;
    start?: number;
    mode?: string;
    style?: Record<string, string>;
  }) => void;
  play?: () => void;
  pause?: () => void;
  stop?: () => void;
  start?: () => void;
  hide?: (mode?: string) => void;
  show?: (mode?: string) => void;
  setOpacity?: (opacity: number) => void;
  setFontSize?: (size: number | string, channelSize?: number) => void;
  setAllDuration?: (mode: string, duration: number) => void;
  setArea?: (area: { start: number; end: number; lines?: number }) => void;
  setPlayRate?: (mode: string, rate: number) => void;
}

export interface DanmuRenderOptions {
  shouldDisplay?: () => boolean;
  buildCommentOptions?: (message: DanmakuMessage) => {
    duration?: number;
    mode?: string;
    style?: Record<string, string>;
  };
}
