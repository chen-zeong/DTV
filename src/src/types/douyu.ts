export type DouyuCate3 = {
  id: string;
  name: string;
};

export type DouyuCate2 = {
  id: string;
  name: string;
  short_name: string;
  icon?: string;
  cate3List?: DouyuCate3[];
};

export type DouyuCategoryResponse = {
  cate1List: Array<{
    id: string;
    name: string;
    cate2List: DouyuCate2[];
  }>;
};

export type DouyuStreamer = {
  rid: string;
  roomName: string;
  nickname: string;
  roomSrc: string;
  avatar: string;
  hn: string;
  isLive?: boolean;
};

export type DouyuLiveListResponse = {
  error: number;
  msg?: string;
  data?: {
    list: DouyuStreamer[];
    total?: number;
    page_count?: number;
  };
};
