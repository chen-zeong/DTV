export type DouyinCategory = {
  title: string;
  href: string;
  subcategories: Array<{ title: string; href: string }>;
};

export type DouyinLiveRoom = {
  room_id: string;
  title: string;
  nickname: string;
  avatar: string;
  room_cover: string;
  viewer_count_str: string;
  platform: string;
  web_id?: string;
};
