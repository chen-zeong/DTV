import * as Huya from "../../bindings/dtv/internal/services/huyaservice";

import { createDanmakuSubscription } from "./douyu";
import {
  mapCategoryGroup,
  mapSearchHit,
  mapStreamInfo,
  mapStreamer,
  mapStreamerPage,
} from "./mappers";
import type { CategoryGroup, DanmakuMessage, SearchHit, StreamInfo, Streamer, StreamerPage } from "./types";

/**
 * 虎牙后端适配层。
 *
 * 与斗鱼的区别：
 *   - 分区是 Go 侧 embed 的静态表（没有网络请求）；
 *   - 没有"三级分类"这一层，只有一个 gid 维度；
 *   - 取流需要 WUP token 签名，一次请求会拿到全部清晰度与线路。
 */

/** 虎牙会忽略页大小、固定按 120 条返回，这里传 20 只是给上游一个意图。 */
const PAGE_SIZE = 20;

function toPromise<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    p.then(resolve, reject);
  });
}

export const huyaApi = {
  listCategories(): Promise<CategoryGroup[]> {
    // 分区是 Go 侧 embed 的静态表，结构与斗鱼一致，复用同一套映射
    return toPromise(Huya.FetchCategories()).then((list) =>
      (list ?? []).map(mapCategoryGroup),
    );
  },

  listStreamers(gid: string, page = 1): Promise<StreamerPage> {
    return toPromise(Huya.FetchLiveList(gid, page, PAGE_SIZE)).then((page_) =>
      mapStreamerPage(page_, "huya"),
    );
  },

  search(keyword: string): Promise<SearchHit[]> {
    return toPromise(Huya.SearchAnchor(keyword)).then((hits) => (hits ?? []).map(mapSearchHit));
  },

  getStreamInfo(roomId: string, line?: string | null): Promise<StreamInfo> {
    return toPromise(Huya.GetStreamInfo(roomId, line ?? "")).then((info) => {
      if (!info) throw new Error(`房间 ${roomId} 未返回信息`);
      return mapStreamInfo(info, "huya");
    });
  },

  getRoomInfo(roomId: string): Promise<Streamer> {
    return toPromise(Huya.FetchRoomInfo(roomId)).then((info) => mapStreamer(info, "huya"));
  },

  getStreamURL(roomId: string, quality = "", line = ""): Promise<string> {
    return toPromise(Huya.GetStreamURL(roomId, quality, line));
  },

  subscribeDanmaku(roomId: string, onMessage: (msg: DanmakuMessage) => void): () => void {
    return createDanmakuSubscription(
      roomId,
      (id) => toPromise(Huya.StartDanmaku(id)),
      (id) => toPromise(Huya.StopDanmaku(id)),
      onMessage,
    );
  },
};
