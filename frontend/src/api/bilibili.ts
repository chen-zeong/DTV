import * as Bilibili from "../../bindings/dtv/internal/services/bilibiliservice";

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
 * B 站后端适配层。
 *
 * 与其它平台的差别：
 *   - 分区 id 是"父分区_子分区"（如 2_86 = 网游/英雄联盟），因为查列表要两个参数；
 *   - 房间有短号与真实 room_id 两种，Go 侧统一换算，前端给短号或整条链接都行；
 *   - 一页固定 40 条（上游不支持 page_size）；
 *   - 只提供 HLS 档位（实测直连可拉，FLV 需要 Referer 反而不可用）。
 */

/** B 站接口一页固定 40 条。 */
const PAGE_SIZE = 40;

function toPromise<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    p.then(resolve, reject);
  });
}

export const bilibiliApi = {
  listCategories(): Promise<CategoryGroup[]> {
    return toPromise(Bilibili.FetchCategories()).then((list) =>
      (list ?? []).map(mapCategoryGroup),
    );
  },

  listStreamers(cateId: string, page = 1): Promise<StreamerPage> {
    return toPromise(Bilibili.FetchLiveList(cateId, page, PAGE_SIZE)).then((page_) =>
      mapStreamerPage(page_, "bilibili"),
    );
  },

  search(keyword: string): Promise<SearchHit[]> {
    const trimmed = keyword.trim();
    if (!trimmed) return Promise.resolve([]);

    return toPromise(Bilibili.SearchRoom(trimmed))
      .then((hits) => (hits ?? []).map(mapSearchHit))
      .catch(() => [] as SearchHit[]);
  },

  getStreamInfo(roomId: string, line?: string | null): Promise<StreamInfo> {
    return toPromise(Bilibili.GetStreamInfo(roomId, line ?? "")).then((info) => {
      if (!info) throw new Error(`房间 ${roomId} 未返回信息`);
      return mapStreamInfo(info, "bilibili");
    });
  },

  getRoomInfo(roomId: string): Promise<Streamer> {
    return toPromise(Bilibili.FetchRoomInfo(roomId)).then((info) => mapStreamer(info, "bilibili"));
  },

  getStreamURL(roomId: string, quality = ""): Promise<string> {
    return toPromise(Bilibili.GetStreamURL(roomId, quality, ""));
  },

  subscribeDanmaku(roomId: string, onMessage: (msg: DanmakuMessage) => void): () => void {
    return createDanmakuSubscription(
      roomId,
      (id) => toPromise(Bilibili.StartDanmaku(id)),
      (id) => toPromise(Bilibili.StopDanmaku(id)),
      onMessage,
    );
  },
};
