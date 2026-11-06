import * as Douyin from "../../bindings/dtv/internal/services/douyinservice";

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
 * 抖音后端适配层。
 *
 * 与斗鱼/虎牙的区别：
 *   - 分区表是 Go 侧 embed 的静态数据（抖音没有分区列表接口）；
 *   - 没有"线路"概念，一次请求返回全部清晰度（ORIGIN/FULL_HD1/HD1/SD1/SD2）；
 *   - 没有关键词搜索接口，搜索框只接受直播间号（与旧项目行为一致）。
 */

/** 抖音接口一页固定 15 条（多传也不会变）。 */
const PAGE_SIZE = 15;

function toPromise<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    p.then(resolve, reject);
  });
}

export const douyinApi = {
  listCategories(): Promise<CategoryGroup[]> {
    return toPromise(Douyin.FetchCategories()).then((list) =>
      (list ?? []).map(mapCategoryGroup),
    );
  },

  listStreamers(cateId: string, page = 1): Promise<StreamerPage> {
    return toPromise(Douyin.FetchLiveList(cateId, page, PAGE_SIZE)).then((page_) =>
      mapStreamerPage(page_, "douyin"),
    );
  },

  /**
   * 抖音没有搜索接口：按直播间号/链接直接取房间信息，失败则返回空结果。
   * 这样搜索框仍然可用（输入 933572413882 或直播间链接都能跳）。
   */
  search(keyword: string): Promise<SearchHit[]> {
    const trimmed = keyword.trim();
    if (!trimmed) return Promise.resolve([]);

    return toPromise(Douyin.FetchRoomInfo(trimmed))
      .then((room) => {
        const hit = mapSearchHit({
          id: room.id,
          nickname: room.nickname,
          title: room.title,
          avatar: room.avatar,
          isLive: room.isLive,
        });
        return [hit];
      })
      .catch(() => [] as SearchHit[]);
  },

  getStreamInfo(roomId: string, line?: string | null): Promise<StreamInfo> {
    return toPromise(Douyin.GetStreamInfo(roomId, line ?? "")).then((info) => {
      if (!info) throw new Error(`房间 ${roomId} 未返回信息`);
      return mapStreamInfo(info, "douyin");
    });
  },

  getRoomInfo(roomId: string): Promise<Streamer> {
    return toPromise(Douyin.FetchRoomInfo(roomId)).then((info) => mapStreamer(info, "douyin"));
  },

  getStreamURL(roomId: string, quality = ""): Promise<string> {
    return toPromise(Douyin.GetStreamURL(roomId, quality, ""));
  },

  subscribeDanmaku(roomId: string, onMessage: (msg: DanmakuMessage) => void): () => void {
    return createDanmakuSubscription(
      roomId,
      (id) => toPromise(Douyin.StartDanmaku(id)),
      (id) => toPromise(Douyin.StopDanmaku(id)),
      onMessage,
    );
  },
};
