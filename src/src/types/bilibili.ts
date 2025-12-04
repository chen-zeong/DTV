export type BiliCategory = {
  title: string;
  href: string;
  id: string | number;
  parent_id?: string | number;
  subcategories?: Array<{
    title: string;
    href: string;
    id: string | number;
    parent_id?: string | number;
  }>;
};

export type BiliLiveRoom = {
  room_id: string;
  title: string;
  nickname: string;
  avatar: string;
  room_cover: string;
  viewer_count_str: string;
  platform: string;
};

export type BiliLiveListResponse = {
  error: number;
  msg?: string;
  data?: BiliLiveRoom[];
};
