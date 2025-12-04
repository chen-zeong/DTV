export type HuyaCategory = {
  title: string;
  href: string;
  subcategories: Array<{
    title: string;
    href: string;
    id: string;
  }>;
};

export type HuyaStreamer = {
  room_id: string;
  title: string;
  nickname: string;
  avatar: string;
  room_cover: string;
  viewer_count_str: string;
  platform: string;
};

export type HuyaLiveListResponse = {
  error: number;
  msg?: string;
  data?: HuyaStreamer[];
};
