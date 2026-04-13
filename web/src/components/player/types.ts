import type { Platform } from "@/platforms/common/types";

export interface RustGetStreamUrlPayload {
  args: {
    room_id_str: string;
  };
  platform: Platform;
}

export interface DanmakuMessage {
  id?: string;
  type?: string;
  isSystem?: boolean;
  uid?: string;
  nickname: string;
  level?: string;
  content: string;
  badgeName?: string;
  badgeLevel?: string;
  color?: string;
  room_id?: string;
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
  shouldDisplay?: (message?: DanmakuMessage) => boolean;
  shouldAppendToList?: (message?: DanmakuMessage) => boolean;
  buildCommentOptions?: (message: DanmakuMessage) => {
    duration?: number;
    mode?: string;
    style?: Record<string, string>;
  };
}

