import type * as Models from "../../bindings/dtv/internal/platforms/common/models";

import type {
  Category,
  CategoryGroup,
  LineOption,
  LivePlatform,
  SearchHit,
  StreamInfo,
  StreamVariant,
  Streamer,
  StreamerPage,
} from "./types";

/**
 * Wails 绑定类型 → 前端领域模型的统一映射。
 *
 * 为什么要单独一层：
 *   - 绑定生成物的 `platform` 是宽松 `string`，前端要的是 "douyu"|"huya"|… 联合类型；
 *   - 绑定生成物可能多字段/少字段，这里是唯一收敛点；
 *   - 斗鱼和虎牙的适配层共用同一套映射，避免各写一遍（两边曾经就是复制粘贴）。
 */

/**
 * 把上游的图片地址统一成 https。
 *
 * 虎牙的 `sAvatar180` / 搜索结果头像会给 `http://huyaimg.msstatic.com/...`，
 * 而应用在生产环境用 https 资源加载，http 图片会被当作混合内容拦掉。
 */
function httpsURL(raw: string): string {
  if (!raw) return "";
  if (raw.startsWith("http://")) return "https://" + raw.slice("http://".length);
  if (raw.startsWith("//")) return "https:" + raw;
  return raw;
}

export function mapCategory(raw: Models.Category): Category {
  return { id: raw.id, name: raw.name };
}

export function mapCategoryGroup(raw: Models.CategoryGroup): CategoryGroup {
  // 防御重复 cate2Id：后端已经去重，这里再按 id 兜一层，
  // 避免 React 用 category.id 做 key 时出现重复 key 导致 chip 残留/倍增。
  const seen = new Set<string>();
  const categories: Category[] = [];
  for (const item of raw.categories ?? []) {
    const id = String(item.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    categories.push(mapCategory(item));
  }
  return {
    id: raw.id,
    name: raw.name,
    categories,
  };
}

export function mapStreamer(raw: Models.Streamer, platform: LivePlatform): Streamer {
  return {
    id: raw.id,
    platform,
    nickname: raw.nickname,
    title: raw.title,
    cover: httpsURL(raw.cover),
    avatar: httpsURL(raw.avatar),
    viewers: raw.viewers,
    categoryName: raw.categoryName,
    isLive: raw.isLive,
  };
}

export function mapStreamerPage(
  raw: Models.StreamerPage,
  platform: LivePlatform,
): StreamerPage {
  return {
    items: (raw.items ?? []).map((item) => mapStreamer(item, platform)),
    page: raw.page,
    hasMore: raw.hasMore,
    totalPages: raw.totalPages,
  };
}

export function mapVariant(raw: Models.StreamVariant): StreamVariant {
  return {
    id: raw.id,
    label: raw.label,
    url: raw.url,
    // 后端只会给 flv/hls 之一，这里收敛成联合类型
    format: raw.format === "hls" ? "hls" : "flv",
    // 斗鱼同一实际档位可能有多个 CDN 地址；旧后端没有 urls 时退回单地址。
    urls: raw.urls && raw.urls.length > 0 ? raw.urls : [raw.url],
    appliedRate: raw.appliedRate ?? null,
    unconfirmed: raw.unconfirmed ?? false,
  };
}

export function mapLine(raw: Models.LineOption): LineOption {
  return { id: raw.id, label: raw.label };
}

export function mapStreamInfo(raw: Models.StreamInfo, platform: LivePlatform): StreamInfo {
  return {
    roomId: raw.roomId,
    platform,
    title: raw.title,
    nickname: raw.nickname,
    avatar: raw.avatar,
    isLive: raw.isLive,
    variants: (raw.variants ?? []).map(mapVariant),
    lines: (raw.lines ?? []).map(mapLine),
  };
}

export function mapSearchHit(raw: Models.SearchHit): SearchHit {
  return {
    id: raw.id,
    nickname: raw.nickname,
    title: raw.title,
    avatar: httpsURL(raw.avatar),
    isLive: raw.isLive,
  };
}
