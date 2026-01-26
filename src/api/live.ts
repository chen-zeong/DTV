import { invoke } from "@tauri-apps/api/core";
import type { GetLiveStreamRequestV2, LiveStreamResponseV2 } from "../types/api/live";

export async function getLiveStreamV2(request: GetLiveStreamRequestV2): Promise<LiveStreamResponseV2> {
  return invoke<LiveStreamResponseV2>("get_live_stream_v2", { request });
}

export async function fetchDouyuCategories(): Promise<any> {
  return invoke("fetch_categories");
}

export async function fetchDouyuThreeCate(tagId: number): Promise<any> {
  return invoke("fetch_three_cate", { tagId });
}

export async function fetchDouyuLiveList(cate2: string, offset: number, limit: number): Promise<any> {
  return invoke("fetch_live_list", { cate2, offset, limit });
}

export async function fetchDouyuLiveListForCate3(cate3Id: string, page: number, limit: number): Promise<any> {
  return invoke("fetch_live_list_for_cate3", { cate3Id, page, limit });
}

export async function fetchDouyinPartitionRooms(partition: string, partitionType: string, offset: number, msToken: string): Promise<any> {
  return invoke("fetch_douyin_partition_rooms", { partition, partitionType, offset, msToken });
}

export async function fetchHuyaLiveList(iGid: string, iPageNo: number, iPageSize: number): Promise<any> {
  return invoke("fetch_huya_live_list", { iGid, iPageNo, iPageSize });
}

export async function fetchBilibiliLiveList(areaId: string, parentAreaId: string, page: number): Promise<string> {
  return invoke<string>("fetch_bilibili_live_list", { areaId, parentAreaId, page });
}
