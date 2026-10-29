import { mockApi } from "./mock";
import type { CategoryGroup, DanmakuMessage, LivePlatform, SearchHit, StreamInfo, Streamer } from "./types";

/**
 * 前端唯一的数据入口。
 *
 * 现在全部走 src/api/mock（假数据）。接后端时**只改这个文件**：
 *
 *   import { DouyuService, HuyaService, ... } from "../bindings/dtv/internal/services";
 *   export const api: DtvApi = {
 *     listCategories: (p) => adapter[p](...),
 *     ...
 *   };
 *
 * UI 层永远只依赖 `DtvApi` 这个接口，因此换实现不需要动任何组件。
 */
export interface DtvApi {
  listCategories(platform: LivePlatform): Promise<CategoryGroup[]>;
  listStreamers(platform: LivePlatform, categoryId: string): Promise<Streamer[]>;
  search(platform: LivePlatform, keyword: string): Promise<SearchHit[]>;
  getStreamInfo(platform: LivePlatform, roomId: string): Promise<StreamInfo>;
  /** 返回取消订阅函数 */
  subscribeDanmaku(
    platform: LivePlatform,
    roomId: string,
    onMessage: (msg: DanmakuMessage) => void,
  ): () => void;
}

export const api: DtvApi = mockApi;

export type * from "./types";
export * from "./types";
