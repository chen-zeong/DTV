export type DanmakuMessage = {
  id: string;
  nickname: string;
  content: string;
  level?: string;
  badgeLevel?: string;
  roomId?: string;
  color?: string;
};

export type DanmakuListener = (msg: DanmakuMessage) => void;
