export interface CommonStreamer {
  room_id: string;
  title: string;
  nickname: string;
  avatar: string;
  room_cover: string;
  viewer_count_str: string;
  platform: 'huya' | 'douyin' | 'douyu' | 'bilibili' | string;
  web_id?: string;
  actual_room_id?: string;
}

export interface HuyaLiveListResponse {
  tCacheInfo?: {
    iSourceType?: number;
    iUpdateTime?: number;
    iCurrentTime?: number;
    iDiffTime?: number;
  };
  vList?: any[];
}
