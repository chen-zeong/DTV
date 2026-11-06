/**
 * 领域模型
 *
 * 相比旧项目（platforms/common/types.ts 里同时存在 Platform 枚举、BaseStreamer、
 * LiveStreamer、FollowedStreamer、StreamRoomDetails、StreamerDetails 六套近乎重复的
 * 接口），这里只保留"UI 真正需要"的最小集合，平台差异用 platform 字段区分。
 *
 * 后端接上之后，这里是唯一需要和 Go 侧 struct 对齐的地方。
 */

export const LIVE_PLATFORMS = ["douyu", "huya", "douyin", "bilibili"] as const;

export type LivePlatform = (typeof LIVE_PLATFORMS)[number];

/** 侧栏平台 tab 用的联合类型（比 LivePlatform 多一个"自定义"） */
export type PlatformTab = LivePlatform | "custom";

export const PLATFORM_LABEL: Record<LivePlatform, string> = {
  douyu: "斗鱼",
  huya: "虎牙",
  douyin: "抖音",
  bilibili: "B站",
};

export const PLATFORM_LOGO: Record<LivePlatform, string> = {
  douyu: "/platforms/douyu.webp",
  huya: "/platforms/huya.webp",
  douyin: "/platforms/douyin.webp",
  bilibili: "/platforms/bilibili.webp",
};

/** 平台 tab 的顺序（自定义分区存在时才把 custom 插到最前面） */
export const PLATFORM_TAB_ORDER: LivePlatform[] = ["douyu", "huya", "douyin", "bilibili"];

/** 一级分区 */
export interface Category {
  id: string;
  name: string;
}

/** 分区分组（"热门游戏" / "网游竞技" …） */
export interface CategoryGroup {
  id: string;
  name: string;
  categories: Category[];
}

/** 主播/直播间卡片的数据 */
export interface Streamer {
  /** 平台内唯一 ID（房间号） */
  id: string;
  platform: LivePlatform;
  nickname: string;
  title: string;
  /** 房间封面（骨架阶段是本地生成的渐变图） */
  cover: string;
  avatar: string;
  /** 人气值，UI 侧格式化显示 */
  viewers: number;
  categoryName: string;
  isLive: boolean;
}

/**
 * 一页主播列表 + 分页信息。
 *
 * 列表是无限滚动，光有数组无法判断"还有没有下一页"，
 * 所以后端把上游的总页数归一化成 hasMore 一起返回。
 */
export interface StreamerPage {
  items: Streamer[];
  /** 本页页码，从 1 开始 */
  page: number;
  hasMore: boolean;
  /** 上游给的总页数；0 表示未提供 */
  totalPages?: number;
}

/** 直播间详情（进入播放页后拿到的信息） */
export interface StreamInfo {
  roomId: string;
  platform: LivePlatform;
  title: string;
  nickname: string;
  avatar: string;
  isLive: boolean;
  /** 可切换的清晰度，按从高到低排列 */
  variants: StreamVariant[];
  /** 可切换的线路，单线路时为空数组（不显示线路选择） */
  lines: LineOption[];
}

export interface StreamVariant {
  /** 稳定 key，用于持久化用户选择（斗鱼是 rate 数字，如 "0" / "4"） */
  id: string;
  /** 显示名：原画 / 蓝光4M / 超清 / 高清（斗鱼下发的档位名） */
  label: string;
  url: string;
  format: "flv" | "hls";
  /** 同一实际档位在多个 CDN 上的地址（斗鱼），第一个与 url 相同 */
  urls?: string[];
  /** 服务端确认的实际档位；null/undefined 表示未确认 */
  appliedRate?: number | null;
  /** 请求档位但服务端未给出可确认的实际档位 */
  unconfirmed?: boolean;
}

export interface LineOption {
  /** 斗鱼 ws-h5/tct-h5…；虎牙 tx/al/hs */
  id: string;
  label: string;
}

/** 弹幕消息（四平台归一化后的形状） */
export interface DanmakuMessage {
  id: string;
  nickname: string;
  content: string;
  /** 用户等级，0 表示未知（不显示等级前缀） */
  level: number;
  /** 指定文字颜色；未指定时由 UI 按昵称哈希取色 */
  color?: string;
  kind: DanmakuKind;
  /** 收到时间戳（ms） */
  at: number;
}

export type DanmakuKind = "chat" | "gift" | "system" | "enter";

/** 搜索结果的轻量条目 */
export interface SearchHit {
  id: string;
  nickname: string;
  title: string;
  avatar: string;
  isLive: boolean;
}

/* ---------------------------------------------------------------- B 站登录 */

/** 扫码登录的二维码（对应 Go 侧 common.QRLoginCode） */
export interface QRLoginCode {
  /** 二维码里要编码的内容 */
  url: string;
  /** 轮询用的 key，不展示给用户 */
  key: string;
  /** 有效期（秒），0 表示上游未说明 */
  expiresIn: number;
}

/** 扫码状态取值（与 Go 侧 common.QRStatus* 一致） */
export type QRLoginStatus = "pending" | "scanned" | "expired" | "success" | "error";

/** 一次扫码状态查询结果（对应 Go 侧 common.QRLoginResult） */
export interface QRLoginResult {
  status: QRLoginStatus;
  message: string;
  /** 仅 status=success 时有值 */
  cookie?: string;
  userName?: string;
  avatar?: string;
}

/** 当前 B 站账号信息（对应 Go 侧 common.BilibiliProfile） */
export interface BilibiliProfile {
  loggedIn: boolean;
  userName?: string;
  avatar?: string;
}

/** 当前斗鱼账号信息（对应 Go 侧 common.DouyuProfile） */
export interface DouyuProfile {
  loggedIn: boolean;
  userName?: string;
  avatar?: string;
}
