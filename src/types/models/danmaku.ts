import type { SupportedPlatform, Platform } from "../app/platform";

export interface CommonDanmakuMessage {
  id?: string;
  platform: SupportedPlatform;
  type: "chat" | "gift" | "system" | "enter" | "other";
  sender: {
    uid?: string;
    nickname: string;
    level?: number | string;
    badgeName?: string;
    badgeLevel?: number;
  };
  content: string;
  timestamp?: number;
  color?: string;
  rawData?: any;
}

export interface DanmakuMessage {
  id: string;
  nickname: string;
  content: string;
  level?: string;
  badgeLevel?: string;
  room_id?: string;
  color?: string;
  isSystem?: boolean;
  type?: "error" | "success" | "info" | string;
}

export interface DanmuOverlayInstance {
  sendComment(comment: {
    id: string;
    txt: string;
    duration: number;
    mode: "scroll" | "top" | "bottom";
    style: Record<string, any>;
  }): void;
  play(): void;
  pause(): void;
  stop(): void;
  show?(mode: string): void;
  hide?(mode: string): void;
  setOpacity?(opacity: number): void;
  setFontSize?(size: number): void;
  setArea?(area: { start: number; end: number }): void;
  setAllDuration?(mode: string, duration: number): void;
}

export interface DanmuRenderOptions {
  shouldDisplay?: () => boolean;
  buildCommentOptions?: (msg: DanmakuMessage) => {
    duration?: number;
    mode?: "scroll" | "top" | "bottom";
    style?: Record<string, any>;
  };
}

export interface RustGetStreamUrlPayload {
  args: {
    room_id_str: string;
  };
  platform: Platform;
}