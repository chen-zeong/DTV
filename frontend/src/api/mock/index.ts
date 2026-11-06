import {
  CATEGORY_TREE,
  SUB_CATEGORY_TREE,
  createDanmakuTicker,
  makeSearchHits,
  makeStreamers,
  makeStreamInfo,
} from "./data";
import type {
  Category,
  CategoryGroup,
  DanmakuMessage,
  LivePlatform,
  SearchHit,
  StreamInfo,
  StreamerPage,
} from "../types";

/**
 * 假后端实现。
 *
 * 用途有两个：
 *  1. 平台适配层没覆盖到的平台自动回落（保证 UI 在"未实现"时不报错）
 *  2. `VITE_DTV_MOCK=1` 时强制全量走假数据，用来脱离 Go 侧调试界面
 *
 * 行为约定与 Go 侧保持一致：
 *  - 所有方法返回 Promise，失败用 reject（后端捕获 Go 错误后也是 reject）
 *  - subscribeDanmaku 返回"取消订阅"函数（对应后端的 stop_* 命令）
 *  - 列表按页返回，够 3 页，用来演练无限滚动
 *  - 这里刻意加了几十毫秒延迟，用来演练 loading / skeleton 状态
 */

const NETWORK_DELAY = 220;

/** 每页条数，与斗鱼后端默认页大小一致 */
const PAGE_SIZE = 30;

/** 假数据造几页就到底了 */
const MOCK_TOTAL_PAGES = 3;

function delay<T>(value: T, ms = NETWORK_DELAY): Promise<T> {
  return new Promise((resolve) => window.setTimeout(() => resolve(value), ms));
}

function pageOf(
  platform: LivePlatform,
  categoryId: string,
  page: number,
  totalPages = MOCK_TOTAL_PAGES,
): StreamerPage {
  const offset = (page - 1) * PAGE_SIZE;
  return {
    items: makeStreamers(platform, categoryId, PAGE_SIZE, offset),
    page,
    hasMore: page < totalPages,
    totalPages,
  };
}

export const mockApi = {
  listCategories(platform: LivePlatform): Promise<CategoryGroup[]> {
    return delay(CATEGORY_TREE[platform], 120);
  },

  listStreamers(platform: LivePlatform, categoryId: string, page = 1): Promise<StreamerPage> {
    return delay(pageOf(platform, categoryId, page));
  },

  /** 三级分区（只有斗鱼有） */
  listSubCategories(platform: LivePlatform, categoryId: string): Promise<Category[]> {
    return delay(SUB_CATEGORY_TREE[platform]?.[categoryId] ?? [], 90);
  },

  /** 按三级分区拉列表：假数据直接复用二级分区的生成器 */
  listStreamersBySubCategory(
    platform: LivePlatform,
    subCategoryId: string,
    page = 1,
  ): Promise<StreamerPage> {
    return delay(pageOf(platform, subCategoryId, page, 2));
  },

  search(platform: LivePlatform, keyword: string): Promise<SearchHit[]> {
    return delay(makeSearchHits(platform, keyword), 180);
  },

  getStreamInfo(platform: LivePlatform, roomId: string): Promise<StreamInfo> {
    return delay(makeStreamInfo(platform, roomId), 160);
  },

  subscribeDanmaku(
    platform: LivePlatform,
    roomId: string,
    onMessage: (msg: DanmakuMessage) => void,
  ): () => void {
    return createDanmakuTicker(`${platform}:${roomId}`, onMessage);
  },
};
