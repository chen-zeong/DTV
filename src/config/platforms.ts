import bilibiliIcon from "../assets/bilibili.webp";
import douyinIcon from "../assets/douyin.webp";
import douyuIcon from "../assets/douyu.webp";
import huyaIcon from "../assets/huya.webp";
import type { UiPlatform } from "../types/app/platform";

export interface PlatformDetail {
  id: UiPlatform;
  name: string;
  icon: string;
  playerRouteName: string;
  defaultPageSize?: number;
}

export const PLATFORMS: PlatformDetail[] = [
  { 
    id: "douyu", 
    name: "斗鱼", 
    icon: douyuIcon,
    playerRouteName: "StreamRoom" 
  },
  { 
    id: "huya", 
    name: "虎牙", 
    icon: huyaIcon,
    playerRouteName: "StreamRoom",
    defaultPageSize: 120 
  },
  { 
    id: "douyin", 
    name: "抖音", 
    icon: douyinIcon,
    playerRouteName: "StreamRoom" 
  },
  { 
    id: "bilibili", 
    name: "Bilibili", 
    icon: bilibiliIcon,
    playerRouteName: "StreamRoom" 
  },
];

export const PLATFORM_MAP = PLATFORMS.reduce((acc, platform) => {
  acc[platform.id] = platform;
  return acc;
}, {} as Record<UiPlatform, PlatformDetail>);
