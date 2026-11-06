import type { LivePlatform } from "@/api";
import { normalizeImageSource } from "@/lib/imageProxy";
import { STORAGE_KEYS } from "@/lib/storage";
import { normalizeSubscriptionId } from "@/lib/subscriptionId";

/**
 * 局域网同步的前端数据层。
 *
 * Go 侧负责 HTTP / UDP 传输，这里负责：
 *   1. 从 localStorage 收集一份可移植快照；
 *   2. 校验对方返回的 manifest / payload；
 *   3. 按“只增不减”的规则合并，避免导入直接覆盖本机数据。
 *
 * 当前 localStorage 键名与老 Tauri 项目一致：
 *   followedStreamers / followFolders / followListOrder / dtv_custom_categories_v1
 * 值同时兼容老形状（avatarUrl / streamerIds / {type,data}）和新形状。
 */

export const LAN_SYNC_KIND = "dtv-lan-sync" as const;
export const LAN_SYNC_VERSION = 1 as const;

export const LAN_SYNC_KEYS = [
  STORAGE_KEYS.follows,
  STORAGE_KEYS.followFolders,
  STORAGE_KEYS.followOrder,
  STORAGE_KEYS.subscriptions,
  STORAGE_KEYS.danmuPrefs,
  STORAGE_KEYS.danmuKeywords,
] as const;

export type PortableEntries = Record<string, string>;

export interface LanSyncSource {
  client: string;
  appVersion: string | null;
}

export interface LanSyncPayload {
  kind: typeof LAN_SYNC_KIND;
  version: typeof LAN_SYNC_VERSION;
  exportedAt: string;
  source: LanSyncSource;
  entries: PortableEntries;
}

export interface LanSyncSummary {
  follows: number;
  followFolders: number;
  followOrder: number;
  subscriptions: number;
  danmuKeywords: number;
  totalBytes: number;
}

export interface LanSyncManifest {
  kind: typeof LAN_SYNC_KIND;
  version: typeof LAN_SYNC_VERSION;
  exportedAt: string;
  source: LanSyncSource;
  summary: LanSyncSummary;
}

export interface LanSyncPeer {
  name: string;
  host: string;
  port: number;
  token: string;
  baseUrl: string;
  version: number;
}

export interface LanSyncImportResult {
  addedFollows: number;
  addedFolderCount: number;
  addedFolderItems: number;
  addedSubscriptions: number;
  addedDanmuKeywords: number;
  appliedDanmuPreferences: boolean;
}

interface FollowRecord {
  id: string;
  platform: LivePlatform;
  nickname: string;
  title: string;
  avatar: string;
  viewers: number;
  isLive: boolean;
  followedAt: number;
}

interface FolderRecord {
  id: string;
  name: string;
  collapsed: boolean;
  keys: string[];
}

interface SubscriptionRecord {
  key: string;
  platform: LivePlatform;
  cate1Id: string;
  cate1Name: string;
  cate2Id: string;
  cate2Name: string;
  createdAt: number;
}

const PLATFORM_SET = new Set<string>(["douyu", "huya", "douyin", "bilibili"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeParseArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function safeParseObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizePlatform(raw: unknown): LivePlatform | null {
  const value = String(raw ?? "").trim().toLowerCase();
  return PLATFORM_SET.has(value) ? (value as LivePlatform) : null;
}

function normalizeKey(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  const idx = value.indexOf(":");
  if (idx <= 0) return null;
  const platform = normalizePlatform(value.slice(0, idx));
  const id = value.slice(idx + 1).trim();
  if (!platform || !id) return null;
  return `${platform}:${id}`;
}

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeFollowRecord(raw: unknown): FollowRecord | null {
  if (!isRecord(raw)) return null;
  const platform = normalizePlatform(raw.platform);
  const id = String(raw.id ?? raw.currentRoomId ?? "").trim();
  if (!platform || !id) return null;
  return {
    id,
    platform,
    nickname: toStringValue(raw.nickname) || id,
    title: toStringValue(raw.title) || toStringValue(raw.roomTitle),
    avatar: normalizeImageSource(toStringValue(raw.avatar) || toStringValue(raw.avatarUrl)),
    viewers: toNumber(raw.viewers),
    isLive: raw.isLive === true || raw.liveStatus === "LIVE" || raw.showStatus === 1,
    followedAt: toNumber(raw.followedAt),
  };
}

function normalizeFolder(raw: unknown): FolderRecord | null {
  if (!isRecord(raw)) return null;
  const name = String(raw.name ?? "").trim();
  if (!name) return null;

  const id = String(raw.id ?? "").trim() || createId("folder");
  const rawKeys = Array.isArray(raw.keys)
    ? raw.keys
    : Array.isArray(raw.streamerIds)
      ? raw.streamerIds
      : [];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const rawKey of rawKeys) {
    const key = normalizeKey(rawKey);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }

  return {
    id,
    name,
    collapsed: typeof raw.collapsed === "boolean" ? raw.collapsed : raw.expanded === false,
    keys,
  };
}

function normalizeOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    let key: string | null = null;
    if (typeof item === "string") {
      key = normalizeKey(item);
    } else if (isRecord(item) && item.type === "streamer" && isRecord(item.data)) {
      key = normalizeKey(`${String(item.data.platform ?? "")}:${String(item.data.id ?? "")}`);
    }
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function normalizeSubscription(raw: unknown): SubscriptionRecord | null {
  if (!isRecord(raw)) return null;
  const platform = normalizePlatform(raw.platform);
  if (!platform) return null;

  // 新版字段优先；老版自定义分区可能只有 key / douyuId / cate2Href。
  const keyText = String(raw.key ?? "");
  const keyId = keyText.includes(":") ? keyText.slice(keyText.indexOf(":") + 1) : "";
  const rawId = String(raw.cate2Id ?? raw.douyuId ?? raw.cate2Href ?? keyId).trim();
  const candidate = normalizeSubscriptionId(platform, rawId);
  if (!candidate) return null;

  return {
    key: `${platform}:${candidate}`,
    platform,
    cate1Id: toStringValue(raw.cate1Id),
    cate1Name: toStringValue(raw.cate1Name),
    cate2Id: candidate,
    cate2Name: toStringValue(raw.cate2Name) || candidate,
    createdAt: toNumber(raw.createdAt),
  };
}

function normalizeDanmuKeywords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const value = item.trim().slice(0, 40);
    if (!value) continue;
    const dedupe = value.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push(value);
    if (out.length >= 40) break;
  }
  return out;
}

function createId(prefix: string): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueId(existing: Set<string>, seed: string | undefined, prefix: string): string {
  const raw = String(seed ?? "").trim();
  if (raw && !existing.has(raw)) return raw;
  for (let i = 0; i < 8; i += 1) {
    const next = createId(prefix);
    if (!existing.has(next)) return next;
  }
  return `${raw || prefix}_${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------- 导出

export function collectLanSyncEntries(storage: Storage): PortableEntries {
  const entries: PortableEntries = {};
  for (const key of LAN_SYNC_KEYS) {
    const value = storage.getItem(key);
    if (typeof value === "string") entries[key] = value;
  }
  return entries;
}

export function createLanSyncPayload(
  storage: Storage,
  source: Partial<LanSyncSource> = {},
): LanSyncPayload {
  return {
    kind: LAN_SYNC_KIND,
    version: LAN_SYNC_VERSION,
    exportedAt: new Date().toISOString(),
    source: {
      client: source.client || "desktop",
      appVersion: source.appVersion ?? null,
    },
    entries: collectLanSyncEntries(storage),
  };
}

/** 计算本地快照摘要（分享成功后展示“都同步了什么”）。 */
export function summarizeLanSyncEntries(entries: PortableEntries): LanSyncSummary {
  let totalBytes = 0;
  for (const [key, value] of Object.entries(entries)) {
    totalBytes += key.length + value.length;
  }
  return {
    follows: safeParseArray<unknown>(entries[STORAGE_KEYS.follows]).length,
    followFolders: safeParseArray<unknown>(entries[STORAGE_KEYS.followFolders]).length,
    followOrder: safeParseArray<unknown>(entries[STORAGE_KEYS.followOrder]).length,
    subscriptions: safeParseArray<unknown>(entries[STORAGE_KEYS.subscriptions]).length,
    danmuKeywords: safeParseArray<unknown>(entries[STORAGE_KEYS.danmuKeywords]).length,
    totalBytes,
  };
}

// ---------------------------------------------------------------- 校验

export function parseLanSyncManifest(raw: unknown): LanSyncManifest {
  if (!isRecord(raw)) throw new Error("清单格式不正确");
  if (raw.kind && raw.kind !== LAN_SYNC_KIND) throw new Error("对方不是 DTV 同步数据");
  if (typeof raw.version === "number" && raw.version !== LAN_SYNC_VERSION) {
    throw new Error(`不支持的同步版本：${raw.version}`);
  }
  const source = isRecord(raw.source) ? raw.source : {};
  const summary = isRecord(raw.summary) ? raw.summary : {};
  return {
    kind: LAN_SYNC_KIND,
    version: LAN_SYNC_VERSION,
    exportedAt: toStringValue(raw.exportedAt) || new Date().toISOString(),
    source: {
      client: toStringValue(source.client) || "desktop",
      appVersion: typeof source.appVersion === "string" ? source.appVersion : null,
    },
    summary: {
      follows: toNumber(summary.follows ?? summary.followedStreamers),
      followFolders: toNumber(summary.followFolders),
      followOrder: toNumber(summary.followOrder ?? summary.followListOrder),
      subscriptions: toNumber(summary.subscriptions ?? summary.customCategories),
      danmuKeywords: toNumber(summary.danmuKeywords),
      totalBytes: toNumber(summary.totalBytes),
    },
  };
}

export function parseLanSyncPayload(raw: unknown): LanSyncPayload {
  if (!isRecord(raw)) throw new Error("同步数据格式不正确");
  if (raw.kind && raw.kind !== LAN_SYNC_KIND) throw new Error("对方不是 DTV 同步数据");
  if (typeof raw.version === "number" && raw.version !== LAN_SYNC_VERSION) {
    throw new Error(`不支持的同步版本：${raw.version}`);
  }
  if (!isRecord(raw.entries)) throw new Error("同步数据缺少 entries");

  const allowed = new Set<string>(LAN_SYNC_KEYS);
  const entries: PortableEntries = {};
  for (const [key, value] of Object.entries(raw.entries)) {
    if (!allowed.has(key) || typeof value !== "string") continue;
    entries[key] = value;
  }

  const source = isRecord(raw.source) ? raw.source : {};
  return {
    kind: LAN_SYNC_KIND,
    version: LAN_SYNC_VERSION,
    exportedAt: toStringValue(raw.exportedAt) || new Date().toISOString(),
    source: {
      client: toStringValue(source.client) || "desktop",
      appVersion: typeof source.appVersion === "string" ? source.appVersion : null,
    },
    entries,
  };
}

// ---------------------------------------------------------------- 合并

/**
 * 增量导入：远端有、本机没有的新增；同名文件夹合并成员；不删除任何本地数据。
 * 关注顺序、文件夹顺序、订阅都按“本地优先，远端追加”处理。
 */
export function applyIncrementalLanSyncImport(
  storage: Storage,
  remoteEntries: PortableEntries,
): LanSyncImportResult {
  const hasFollowData =
    typeof remoteEntries[STORAGE_KEYS.follows] === "string" ||
    typeof remoteEntries[STORAGE_KEYS.followFolders] === "string" ||
    typeof remoteEntries[STORAGE_KEYS.followOrder] === "string";

  const remoteFollowsRaw = safeParseArray<unknown>(remoteEntries[STORAGE_KEYS.follows]);
  const remoteFoldersRaw = safeParseArray<unknown>(remoteEntries[STORAGE_KEYS.followFolders]);
  const remoteOrder = normalizeOrder(safeParseArray<unknown>(remoteEntries[STORAGE_KEYS.followOrder]));

  const localFollows = safeParseArray<unknown>(storage.getItem(STORAGE_KEYS.follows))
    .map(normalizeFollowRecord)
    .filter((item): item is FollowRecord => Boolean(item));
  const localFolders = safeParseArray<unknown>(storage.getItem(STORAGE_KEYS.followFolders))
    .map(normalizeFolder)
    .filter((item): item is FolderRecord => Boolean(item));
  const localOrder = normalizeOrder(safeParseArray<unknown>(storage.getItem(STORAGE_KEYS.followOrder)));

  const followByKey = new Map<string, FollowRecord>();
  for (const follow of localFollows) {
    followByKey.set(`${follow.platform}:${follow.id}`, follow);
  }

  let addedFollows = 0;
  const ensureFollow = (raw: unknown, fallbackKey?: string) => {
    let record = normalizeFollowRecord(raw);
    if (!record && fallbackKey) {
      const key = normalizeKey(fallbackKey);
      if (key) {
        const [platform, id] = key.split(":");
        record = {
          id,
          platform: platform as LivePlatform,
          nickname: id,
          title: "",
          avatar: "",
          viewers: 0,
          isLive: false,
          followedAt: 0,
        };
      }
    }
    if (!record) return;
    const key = `${record.platform}:${record.id}`;
    if (followByKey.has(key)) return;
    followByKey.set(key, record);
    addedFollows += 1;
  };

  for (const raw of remoteFollowsRaw) ensureFollow(raw);

  // 文件夹、顺序里引用的主播也补进 follows，保证 key 不会悬空。
  for (const raw of remoteFoldersRaw) {
    if (!isRecord(raw)) continue;
    const rawKeys = Array.isArray(raw.keys)
      ? raw.keys
      : Array.isArray(raw.streamerIds)
        ? raw.streamerIds
        : [];
    for (const key of rawKeys) ensureFollow(null, String(key));
  }
  for (const key of remoteOrder) ensureFollow(null, key);

  const folderById = new Map<string, FolderRecord>();
  const folderByName = new Map<string, FolderRecord>();
  for (const folder of localFolders) {
    folderById.set(folder.id, folder);
    folderByName.set(folder.name.toLowerCase(), folder);
  }

  let addedFolderCount = 0;
  let addedFolderItems = 0;
  for (const raw of remoteFoldersRaw) {
    const incoming = normalizeFolder(raw);
    if (!incoming) continue;

    let target = folderById.get(incoming.id) ?? folderByName.get(incoming.name.toLowerCase());
    if (!target) {
      const id = uniqueId(new Set(folderById.keys()), incoming.id, "folder");
      target = { ...incoming, id, keys: [] };
      localFolders.push(target);
      folderById.set(id, target);
      folderByName.set(incoming.name.toLowerCase(), target);
      addedFolderCount += 1;
    }

    const existing = new Set(target.keys);
    for (const key of incoming.keys) {
      if (existing.has(key)) continue;
      existing.add(key);
      target.keys.push(key);
      addedFolderItems += 1;
    }
  }

  const folderedKeys = new Set<string>();
  for (const folder of localFolders) {
    for (const key of folder.keys) folderedKeys.add(key);
  }
  for (const folder of localFolders) {
    folder.keys = folder.keys.filter((key) => followByKey.has(key));
  }

  const mergedFollows = Array.from(followByKey.values());
  const localOrderFiltered = localOrder.filter(
    (key) => followByKey.has(key) && !folderedKeys.has(key),
  );
  const remoteOrderFiltered = remoteOrder.filter(
    (key) => followByKey.has(key) && !folderedKeys.has(key),
  );

  const finalOrder: string[] = [];
  const orderSeen = new Set<string>();
  for (const key of [...localOrderFiltered, ...remoteOrderFiltered]) {
    if (orderSeen.has(key)) continue;
    orderSeen.add(key);
    finalOrder.push(key);
  }
  for (const follow of mergedFollows) {
    const key = `${follow.platform}:${follow.id}`;
    if (folderedKeys.has(key) || orderSeen.has(key)) continue;
    orderSeen.add(key);
    finalOrder.push(key);
  }

  if (hasFollowData) {
    storage.setItem(STORAGE_KEYS.follows, JSON.stringify(mergedFollows));
    storage.setItem(STORAGE_KEYS.followFolders, JSON.stringify(localFolders));
    storage.setItem(STORAGE_KEYS.followOrder, JSON.stringify(finalOrder));
  }

  // ------------------------------------------------------------ 订阅分区
  const localSubscriptions = safeParseArray<unknown>(storage.getItem(STORAGE_KEYS.subscriptions))
    .map(normalizeSubscription)
    .filter((item): item is SubscriptionRecord => Boolean(item));
  const remoteSubscriptions = safeParseArray<unknown>(remoteEntries[STORAGE_KEYS.subscriptions])
    .map(normalizeSubscription)
    .filter((item): item is SubscriptionRecord => Boolean(item));

  const subscriptionByKey = new Map<string, SubscriptionRecord>();
  for (const item of localSubscriptions) subscriptionByKey.set(item.key, item);
  let addedSubscriptions = 0;
  for (const item of remoteSubscriptions) {
    if (subscriptionByKey.has(item.key)) continue;
    subscriptionByKey.set(item.key, item);
    addedSubscriptions += 1;
  }
  if (remoteSubscriptions.length > 0) {
    storage.setItem(
      STORAGE_KEYS.subscriptions,
      JSON.stringify(Array.from(subscriptionByKey.values())),
    );
  }

  // ---------------------------------------------------------- 弹幕设置
  const localPreferences = safeParseObject(storage.getItem(STORAGE_KEYS.danmuPrefs));
  const remotePreferences = safeParseObject(remoteEntries[STORAGE_KEYS.danmuPrefs]);
  let appliedDanmuPreferences = false;
  if (!localPreferences && remotePreferences) {
    storage.setItem(STORAGE_KEYS.danmuPrefs, JSON.stringify(remotePreferences));
    appliedDanmuPreferences = true;
  }

  const localKeywords = normalizeDanmuKeywords(
    safeParseArray<unknown>(storage.getItem(STORAGE_KEYS.danmuKeywords)),
  );
  const remoteKeywords = normalizeDanmuKeywords(
    safeParseArray<unknown>(remoteEntries[STORAGE_KEYS.danmuKeywords]),
  );
  const mergedKeywords = normalizeDanmuKeywords([...localKeywords, ...remoteKeywords]);
  const addedDanmuKeywords = Math.max(0, mergedKeywords.length - localKeywords.length);
  if (mergedKeywords.length > 0) {
    storage.setItem(STORAGE_KEYS.danmuKeywords, JSON.stringify(mergedKeywords));
  }

  return {
    addedFollows,
    addedFolderCount,
    addedFolderItems,
    addedSubscriptions,
    addedDanmuKeywords,
    appliedDanmuPreferences,
  };
}

/** 把导入结果转成一行适合展示的文字。 */
export function formatImportResult(result: LanSyncImportResult): string {
  const parts = [
    `新增关注 ${result.addedFollows}`,
    `新增分组 ${result.addedFolderCount}`,
    `分组新增条目 ${result.addedFolderItems}`,
    `新增订阅 ${result.addedSubscriptions}`,
  ];
  if (result.addedDanmuKeywords > 0) {
    parts.push(`新增屏蔽词 ${result.addedDanmuKeywords}`);
  }
  if (result.appliedDanmuPreferences) {
    parts.push("已应用弹幕偏好");
  }
  return parts.join("，");
}
