import { STORAGE_KEYS } from "@/lib/storage";
import {
  applyIncrementalLanSyncImport,
  parseLanSyncPayload,
  summarizeLanSyncEntries,
  type LanSyncImportResult,
  type LanSyncSummary,
  type PortableEntries,
} from "@/lib/lanSync";

/**
 * DTV 配置文件的导入 / 导出。
 *
 * 格式与老 Tauri 版完全一致：
 *
 * ```json
 * {
 *   "kind": "dtv-config",
 *   "version": 1,
 *   "exportedAt": "2026-11-01T12:00:00.000Z",
 *   "source": { "client": "desktop", "appVersion": "4.0.0" },
 *   "entries": { "theme_preference": "dark", ... }
 * }
 * ```
 *
 * 导入时同时接受：
 *   - 老版 `dtv-config`（本文件导出的格式）
 *   - 4.0 局域网同步的 `dtv-lan-sync`
 *
 * 关注 / 分组 / 订阅 / 弹幕设置复用局域网同步的“只增不减”合并逻辑；
 * 主题、Cookie、清晰度、线路等单值偏好按文件内容覆盖。
 */

export const DTV_CONFIG_KIND = "dtv-config" as const;
export const DTV_CONFIG_VERSION = 1 as const;

export interface ConfigSource {
  client: string;
  appVersion: string | null;
}

export interface PortableConfigPayload {
  kind: typeof DTV_CONFIG_KIND;
  version: typeof DTV_CONFIG_VERSION;
  exportedAt: string;
  source: ConfigSource;
  entries: PortableEntries;
}

/** 与老版 configTransfer.ts 相同的可迁移键 */
const EXACT_EXPORTABLE_KEYS = new Set<string>([
  STORAGE_KEYS.bilibiliCookie,
  STORAGE_KEYS.subscriptions,
  STORAGE_KEYS.danmuPrefs,
  STORAGE_KEYS.danmuKeywords,
  STORAGE_KEYS.danmuPanelCollapsed,
  STORAGE_KEYS.playerVolume,
  STORAGE_KEYS.follows,
  STORAGE_KEYS.followFolders,
  STORAGE_KEYS.followOrder,
  STORAGE_KEYS.theme,
]);

const PORTABLE_PLATFORMS = ["DOUYU", "DOUYIN", "HUYA", "BILIBILI"] as const;
const EXPORTABLE_KEY_PATTERNS = [
  new RegExp(`^(${PORTABLE_PLATFORMS.join("|")})_preferred_quality$`),
  new RegExp(`^(${PORTABLE_PLATFORMS.join("|")})_preferred_line$`),
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isExportableStorageKey(key: string): boolean {
  if (EXACT_EXPORTABLE_KEYS.has(key)) return true;
  return EXPORTABLE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function sortEntries(entries: PortableEntries): PortableEntries {
  const sorted: PortableEntries = {};
  for (const key of Object.keys(entries).sort((a, b) => a.localeCompare(b))) {
    sorted[key] = entries[key];
  }
  return sorted;
}

function safeParseArray(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 订阅分区转成老版 `CustomCategoryEntry` 形状。
 *
 * 老版斗鱼分区用 `douyuId`，其它平台用 `cate2Href`；新版内部统一用
 * `cate2Id`。这里保留新版字段并补上老字段，两边都能读。
 */
function toLegacySubscriptions(raw: string): string {
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const item of safeParseArray(raw)) {
    if (!isRecord(item)) continue;
    const platform = String(item.platform ?? "").trim().toLowerCase();
    if (!["douyu", "douyin", "huya", "bilibili"].includes(platform)) continue;

    const keyId = String(item.key ?? "").split(":")[1] ?? "";
    const cate2Id = String(item.cate2Id ?? item.douyuId ?? keyId).trim();
    if (!cate2Id) continue;

    const key = `${platform}:${cate2Id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cate2Name = String(item.cate2Name ?? "") || cate2Id;
    const entry: Record<string, unknown> = {
      key,
      platform,
      cate2Name,
      cate2Id,
    };
    if (item.cate1Name) entry.cate1Name = String(item.cate1Name);
    if (platform === "douyu") {
      entry.douyuId = cate2Id;
    } else {
      entry.cate2Href = String(item.cate2Href ?? cate2Id);
      if (item.cate1Href) entry.cate1Href = String(item.cate1Href);
    }
    out.push(entry);
  }

  return JSON.stringify(out);
}

// ---------------------------------------------------------------- 导出

export function collectPortableConfigEntries(storage: Storage): PortableEntries {
  const entries: PortableEntries = {};
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !isExportableStorageKey(key)) continue;
    const value = storage.getItem(key);
    if (typeof value === "string") entries[key] = value;
  }

  // 订阅分区从新版内部形状转换回老版字段。
  const subscriptionsKey = STORAGE_KEYS.subscriptions;
  if (typeof entries[subscriptionsKey] === "string") {
    entries[subscriptionsKey] = toLegacySubscriptions(entries[subscriptionsKey]);
  }

  return sortEntries(entries);
}

export function createPortableConfigPayload(
  storage: Storage,
  source: Partial<ConfigSource> = {},
): PortableConfigPayload {
  return {
    kind: DTV_CONFIG_KIND,
    version: DTV_CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    source: {
      client: source.client || "desktop",
      appVersion: source.appVersion ?? null,
    },
    entries: collectPortableConfigEntries(storage),
  };
}

/** 导出前展示“都带了什么”，复用局域网同步的摘要结构 */
export function summarizePortableConfig(entries: PortableEntries): LanSyncSummary {
  return summarizeLanSyncEntries(entries);
}

// ---------------------------------------------------------------- 导入

interface DtvConfigFile {
  kind: typeof DTV_CONFIG_KIND;
  version: typeof DTV_CONFIG_VERSION;
  exportedAt: string;
  source: ConfigSource;
  entries: PortableEntries;
}

function parseDtvConfigFile(parsed: Record<string, unknown>): DtvConfigFile {
  if (parsed.kind !== DTV_CONFIG_KIND) {
    throw new Error("这不是 DTV 配置文件");
  }
  if (parsed.version !== DTV_CONFIG_VERSION) {
    throw new Error(`不支持的配置文件版本：${String(parsed.version)}`);
  }
  if (!isRecord(parsed.entries)) {
    throw new Error("配置文件缺少 entries 字段");
  }

  const entries: PortableEntries = {};
  for (const [key, value] of Object.entries(parsed.entries)) {
    if (!isExportableStorageKey(key) || typeof value !== "string") continue;
    entries[key] = value;
  }
  if (Object.keys(entries).length === 0) {
    throw new Error("配置文件里没有可导入的数据");
  }

  const source = isRecord(parsed.source) ? parsed.source : {};
  return {
    kind: DTV_CONFIG_KIND,
    version: DTV_CONFIG_VERSION,
    exportedAt:
      typeof parsed.exportedAt === "string" && !Number.isNaN(Date.parse(parsed.exportedAt))
        ? parsed.exportedAt
        : new Date().toISOString(),
    source: {
      client: typeof source.client === "string" && source.client.trim() ? source.client : "desktop",
      appVersion: typeof source.appVersion === "string" ? source.appVersion : null,
    },
    entries: sortEntries(entries),
  };
}

/**
 * 解析配置文件文本。
 *
 * 同时接受 `dtv-config` 和 `dtv-lan-sync`（含没有 kind 的老式 entries 文件）。
 */
export function parsePortableConfig(raw: string): PortableConfigPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("文件不是有效的 JSON");
  }
  if (!isRecord(parsed)) {
    throw new Error("配置文件格式不正确");
  }

  if (parsed.kind === "dtv-lan-sync" || (!parsed.kind && isRecord(parsed.entries))) {
    const payload = parseLanSyncPayload(parsed);
    const entries = sortEntries(payload.entries);
    if (Object.keys(entries).length === 0) {
      throw new Error("配置文件里没有可导入的数据");
    }
    return {
      kind: DTV_CONFIG_KIND,
      version: DTV_CONFIG_VERSION,
      exportedAt: payload.exportedAt,
      source: {
        client: payload.source.client,
        appVersion: payload.source.appVersion,
      },
      entries,
    };
  }

  return parseDtvConfigFile(parsed);
}

/**
 * 这些键按“只增不减”合并；其余可迁移键（主题、Cookie、清晰度、线路、
 * 弹幕列表折叠状态等）在导入时直接采用文件里的值，和老版配置导入一致。
 */
const MERGED_KEYS = new Set<string>([
  STORAGE_KEYS.follows,
  STORAGE_KEYS.followFolders,
  STORAGE_KEYS.followOrder,
  STORAGE_KEYS.subscriptions,
  STORAGE_KEYS.danmuPrefs,
  STORAGE_KEYS.danmuKeywords,
]);

export interface ConfigImportResult extends LanSyncImportResult {
  /** 直接覆盖应用的偏好键数量（主题 / Cookie / 清晰度 / 线路等） */
  appliedPreferences: number;
}

/** 增量合并关注/订阅/弹幕设置，并覆盖主题、Cookie、播放器偏好等单值配置 */
export function importPortableConfig(
  storage: Storage,
  payload: PortableConfigPayload,
): ConfigImportResult {
  const merged: PortableEntries = {};
  let appliedPreferences = 0;
  for (const [key, value] of Object.entries(payload.entries)) {
    if (MERGED_KEYS.has(key)) {
      merged[key] = value;
      continue;
    }
    if (!isExportableStorageKey(key)) continue;
    try {
      storage.setItem(key, value);
      appliedPreferences += 1;
    } catch {
      /* 配额满 / 隐私模式：跳过这一项 */
    }
  }
  return {
    ...applyIncrementalLanSyncImport(storage, merged),
    appliedPreferences,
  };
}

// ---------------------------------------------------------------- 文件名

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function buildPortableConfigFileName(now = new Date()): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `dtv-config-${date}-${time}.json`;
}
