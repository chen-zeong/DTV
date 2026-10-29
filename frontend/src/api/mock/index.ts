import { CATEGORY_TREE, createDanmakuTicker, makeSearchHits, makeStreamers, makeStreamInfo } from "./data";
import type { CategoryGroup, DanmakuMessage, LivePlatform, SearchHit, StreamInfo, Streamer } from "../types";

/**
 * 假后端实现。
 *
 * 行为约定与未来 Go 侧保持一致：
 *  - 所有方法返回 Promise，失败用 reject（后端捕获 Rust/Go 错误后也是 reject）
 *  - subscribeDanmaku 返回"取消订阅"函数（对应后端的 stop_* 命令）
 *  - 这里刻意加了几十毫秒延迟，用来演练 loading / skeleton 状态
 */

const NETWORK_DELAY = 220;

function delay<T>(value: T, ms = NETWORK_DELAY): Promise<T> {
  return new Promise((resolve) => window.setTimeout(() => resolve(value), ms));
}

export const mockApi = {
  listCategories(platform: LivePlatform): Promise<CategoryGroup[]> {
    return delay(CATEGORY_TREE[platform], 120);
  },

  listStreamers(platform: LivePlatform, categoryId: string): Promise<Streamer[]> {
    return delay(makeStreamers(platform, categoryId, 24));
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
