import { bilibiliApi } from "./bilibili";
import { douyinApi } from "./douyin";
import { douyuApi } from "./douyu";
import { huyaApi } from "./huya";
import { mockApi } from "./mock";
import type {
  Category,
  CategoryGroup,
  DanmakuMessage,
  LivePlatform,
  SearchHit,
  StreamInfo,
  Streamer,
  StreamerPage,
} from "./types";

/**
 * 前端唯一的数据入口。
 *
 * 平台接入进度：
 *   - douyu    → 真实后端（Go internal/platforms/douyu）
 *   - huya     → 真实后端（Go internal/platforms/huya）
 *   - douyin   → 真实后端（Go internal/platforms/douyin）
 *   - bilibili → 真实后端（Go internal/platforms/bilibili）
 *
 * 四个平台都已接真实后端，src/api/mock 仅作为兜底保留
 * （`VITE_DTV_MOCK=1` 构建时强制走假数据，用于脱离 Go 侧调试 UI）。
 *
 * UI 层只依赖 `DtvApi` 这个接口，因此换实现不需要动任何组件。
 */

/** 一个平台适配层需要提供的能力（斗鱼/虎牙都实现了这一组）。 */
interface PlatformAdapter {
  listCategories(): Promise<CategoryGroup[]>;
  listStreamers(categoryId: string, page: number): Promise<StreamerPage>;
  search(keyword: string): Promise<SearchHit[]>;
  getRoomInfo(roomId: string): Promise<Streamer>;
  getStreamInfo(roomId: string, line?: string | null): Promise<StreamInfo>;
  subscribeDanmaku(roomId: string, onMessage: (msg: DanmakuMessage) => void): () => void;

  /* 以下为可选能力：只有斗鱼有三级分区（"赛事直播"之类的子分类） */
  /** 某个二级分区下的三级分类 */
  listSubCategories?(categoryId: string): Promise<Category[]>;
  /** 按三级分区拉列表 */
  listStreamersForCate3?(subCategoryId: string, page: number): Promise<StreamerPage>;
}

/** 已接真实后端的平台。没有登记的平台自动回落到 mock。 */
const adapters: Partial<Record<LivePlatform, PlatformAdapter>> = {
  douyu: douyuApi,
  huya: huyaApi,
  douyin: douyinApi,
  bilibili: bilibiliApi,
};

/** 构建期开关：脱离 Go 侧、只用假数据调试 UI 时置 1。 */
const FORCE_MOCK = import.meta.env.VITE_DTV_MOCK === "1";

function adapterFor(platform: LivePlatform): PlatformAdapter | undefined {
  return FORCE_MOCK ? undefined : adapters[platform];
}

export interface DtvApi {
  listCategories(platform: LivePlatform): Promise<CategoryGroup[]>;

  /**
   * 拉某一页主播列表。
   *
   * 返回 StreamerPage 而不是裸数组，因为列表是无限滚动，
   * 需要 hasMore 才知道"还要不要继续加载"。
   */
  listStreamers(platform: LivePlatform, categoryId: string, page?: number): Promise<StreamerPage>;

  /**
   * 某个二级分区下的三级分类。没有三级分区的平台返回空数组。
   * 目前只有斗鱼有（如"赛事直播"）。
   */
  listSubCategories(platform: LivePlatform, categoryId: string): Promise<Category[]>;

  /** 按三级分区拉列表。平台不支持时退化为按二级分区拉。 */
  listStreamersBySubCategory(
    platform: LivePlatform,
    subCategoryId: string,
    page?: number,
  ): Promise<StreamerPage>;

  search(platform: LivePlatform, keyword: string): Promise<SearchHit[]>;

  /** 轻量房间信息（关注列表刷新在线状态用，不取播放地址） */
  getRoomInfo(platform: LivePlatform, roomId: string): Promise<Streamer>;

  /**
   * 房间信息 + 所有清晰度。
   *
   * `line` 只在支持多线路的平台（斗鱼/虎牙）有意义，传空表示用平台默认线路。
   */
  getStreamInfo(platform: LivePlatform, roomId: string, line?: string | null): Promise<StreamInfo>;

  /** 返回取消订阅函数 */
  subscribeDanmaku(
    platform: LivePlatform,
    roomId: string,
    onMessage: (msg: DanmakuMessage) => void,
  ): () => void;
}

function listStreamers(
  platform: LivePlatform,
  categoryId: string,
  page = 1,
): Promise<StreamerPage> {
  const adapter = adapterFor(platform);
  return adapter
    ? adapter.listStreamers(categoryId, page)
    : mockApi.listStreamers(platform, categoryId, page);
}

/**
 * 按平台分流。已接入的平台走真实后端，其余继续用假数据，
 * 这样首页/播放页可以在多平台之间无缝切换而不会因为"未实现"直接报错。
 */
export const api: DtvApi = {
  listCategories(platform) {
    const adapter = adapterFor(platform);
    return adapter ? adapter.listCategories() : mockApi.listCategories(platform);
  },

  listStreamers,

  listSubCategories(platform, categoryId) {
    const adapter = adapterFor(platform);
    if (adapter?.listSubCategories) {
      // 三级分区是"锦上添花"：取不到就当没有，不要把整页拖成错误态
      return adapter.listSubCategories(categoryId).catch(() => [] as Category[]);
    }
    return mockApi.listSubCategories(platform, categoryId).catch(() => [] as Category[]);
  },

  listStreamersBySubCategory(platform, subCategoryId, page = 1) {
    const adapter = adapterFor(platform);
    if (!adapter?.listStreamersForCate3) {
      return adapter
        ? listStreamers(platform, subCategoryId, page)
        : mockApi.listStreamersBySubCategory(platform, subCategoryId, page);
    }
    return adapter.listStreamersForCate3(subCategoryId, page);
  },

  search(platform, keyword) {
    const adapter = adapterFor(platform);
    return adapter ? adapter.search(keyword) : mockApi.search(platform, keyword);
  },

  getRoomInfo(platform, roomId) {
    const adapter = adapterFor(platform);
    if (adapter) return adapter.getRoomInfo(roomId);
    return mockApi.getStreamInfo(platform, roomId).then((info) => ({
      id: info.roomId,
      platform,
      nickname: info.nickname,
      title: info.title,
      cover: "",
      avatar: info.avatar,
      viewers: 0,
      categoryName: "",
      isLive: info.isLive,
    }));
  },

  getStreamInfo(platform, roomId, line) {
    const adapter = adapterFor(platform);
    return adapter
      ? adapter.getStreamInfo(roomId, line)
      : mockApi.getStreamInfo(platform, roomId);
  },

  subscribeDanmaku(platform, roomId, onMessage) {
    const adapter = adapterFor(platform);
    return adapter
      ? adapter.subscribeDanmaku(roomId, onMessage)
      : mockApi.subscribeDanmaku(platform, roomId, onMessage);
  },
};

export type * from "./types";
export * from "./types";
