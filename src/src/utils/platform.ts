import { Platform } from "@/types/platform";

export const platformSlugMap: Record<Platform, string> = {
  [Platform.DOUYU]: "douyu",
  [Platform.HUYA]: "huya",
  [Platform.BILIBILI]: "bilibili",
  [Platform.DOUYIN]: "douyin",
};

export const platformLabelMap: Record<Platform, string> = {
  [Platform.DOUYU]: "斗鱼",
  [Platform.HUYA]: "虎牙",
  [Platform.BILIBILI]: "哔哩",
  [Platform.DOUYIN]: "抖音",
};
