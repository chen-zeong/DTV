"use client";

export const LAN_SYNC_KIND = "dtv-lan-sync" as const;
export const LAN_SYNC_VERSION = 1 as const;

export const LAN_SYNC_KEYS = [
  "followFolders",
  // NOTE: keep payload minimal for LAN sync: only share folder structure.
] as const;

type LanSyncKey = (typeof LAN_SYNC_KEYS)[number];

type ConfigSource = {
  appVersion?: string | null;
  client: string;
};

export type PortableEntries = Record<string, string>;

export interface LanSyncPayload {
  kind: typeof LAN_SYNC_KIND;
  version: typeof LAN_SYNC_VERSION;
  exportedAt: string;
  source: ConfigSource;
  entries: PortableEntries;
}

export interface LanSyncSummary {
  followedStreamers: number;
  followFolders: number;
  followListOrder: number;
  customCategories: number;
  totalBytes?: number;
}

export interface LanSyncManifest {
  kind: typeof LAN_SYNC_KIND;
  version: typeof LAN_SYNC_VERSION;
  exportedAt: string;
  source: ConfigSource;
  summary: LanSyncSummary;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object" && !Array.isArray(value);
};

function safeParseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function collectLanSyncEntries(storage: Storage): PortableEntries {
  const entries: PortableEntries = {};
  LAN_SYNC_KEYS.forEach((key) => {
    const value = storage.getItem(key);
    if (typeof value === "string") entries[key] = value;
  });
  return entries;
}

export function createLanSyncPayload(storage: Storage, source: Partial<ConfigSource> = {}): LanSyncPayload {
  return {
    kind: LAN_SYNC_KIND,
    version: LAN_SYNC_VERSION,
    exportedAt: new Date().toISOString(),
    source: {
      client: source.client ?? "desktop",
      appVersion: source.appVersion ?? null
    },
    entries: collectLanSyncEntries(storage)
  };
}

export function parseLanSyncManifest(raw: unknown): LanSyncManifest {
  if (!isRecord(raw)) throw new Error("Manifest format is invalid.");
  if (raw.kind !== LAN_SYNC_KIND) throw new Error("This is not a DTV LAN sync export.");
  if (raw.version !== LAN_SYNC_VERSION) throw new Error(`Unsupported sync version: ${String(raw.version)}.`);
  if (typeof raw.exportedAt !== "string" || Number.isNaN(Date.parse(raw.exportedAt))) throw new Error("Manifest exportedAt is invalid.");
  if (!isRecord(raw.source) || typeof raw.source.client !== "string" || !raw.source.client.trim()) throw new Error("Manifest source is invalid.");
  if (!isRecord(raw.summary)) throw new Error("Manifest summary is missing.");

  const summary = raw.summary;
  const num = (key: keyof LanSyncSummary) => (typeof summary[key] === "number" ? (summary[key] as number) : 0);

  return {
    kind: LAN_SYNC_KIND,
    version: LAN_SYNC_VERSION,
    exportedAt: raw.exportedAt,
    source: {
      client: raw.source.client,
      appVersion: typeof raw.source.appVersion === "string" ? raw.source.appVersion : null
    },
    summary: {
      followedStreamers: num("followedStreamers"),
      followFolders: num("followFolders"),
      followListOrder: num("followListOrder"),
      customCategories: num("customCategories"),
      totalBytes: typeof summary.totalBytes === "number" ? (summary.totalBytes as number) : undefined
    }
  };
}

export function parseLanSyncPayload(raw: unknown): LanSyncPayload {
  if (!isRecord(raw)) throw new Error("Payload format is invalid.");
  if (raw.kind !== LAN_SYNC_KIND) throw new Error("This is not a DTV LAN sync export.");
  if (raw.version !== LAN_SYNC_VERSION) throw new Error(`Unsupported sync version: ${String(raw.version)}.`);
  if (typeof raw.exportedAt !== "string" || Number.isNaN(Date.parse(raw.exportedAt))) throw new Error("Payload exportedAt is invalid.");
  if (!isRecord(raw.source) || typeof raw.source.client !== "string" || !raw.source.client.trim()) throw new Error("Payload source is invalid.");
  if (!isRecord(raw.entries)) throw new Error("Payload entries are missing.");

  const entries: PortableEntries = {};
  Object.entries(raw.entries).forEach(([key, value]) => {
    if (!LAN_SYNC_KEYS.includes(key as LanSyncKey)) return;
    if (typeof value !== "string") return;
    entries[key] = value;
  });

  return {
    kind: LAN_SYNC_KIND,
    version: LAN_SYNC_VERSION,
    exportedAt: raw.exportedAt,
    source: {
      client: raw.source.client,
      appVersion: typeof raw.source.appVersion === "string" ? raw.source.appVersion : null
    },
    entries
  };
}

type FollowPlatform = "DOUYU" | "DOUYIN" | "HUYA" | "BILIBILI";

type FollowedStreamer = {
  id: string;
  platform: FollowPlatform;
  nickname: string;
  avatarUrl: string;
  roomTitle?: string;
  currentRoomId: string;
  liveStatus: "UNKNOWN" | "LIVE" | "OFFLINE";
};

type FollowFolder = {
  id: string;
  name: string;
  streamerIds: string[];
  expanded?: boolean;
};

type FollowListItem = { type: "folder"; data: FollowFolder } | { type: "streamer"; data: FollowedStreamer };

function normalizeStreamerKey(streamerKey: string) {
  const [rawPlatform, rawId] = String(streamerKey || "").split(":");
  const platform = String(rawPlatform || "").toUpperCase();
  const id = String(rawId || "");
  return { platform, id, key: `${platform}:${id}` };
}

function isKnownPlatform(platform: string): platform is FollowPlatform {
  return platform === "DOUYU" || platform === "DOUYIN" || platform === "HUYA" || platform === "BILIBILI";
}

function ensureUuid(existing: Set<string>, seed?: string): string {
  const raw = String(seed || "").trim();
  if (raw && !existing.has(raw)) return raw;
  const gen = () => {
    const c = (globalThis as any).crypto;
    if (c?.randomUUID) return c.randomUUID();
    return `id-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  };
  for (let i = 0; i < 8; i += 1) {
    const next = gen();
    if (!existing.has(next)) return next;
  }
  return `${raw || "id"}-${Date.now().toString(16)}`;
}

function uniqPreserveOrder(values: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export type LanSyncImportResult = {
  addedStreamers: number;
  addedFolderCount: number;
  addedFolderItems: number;
};

export function applyIncrementalLanSyncImport(storage: Storage, remoteEntries: PortableEntries): LanSyncImportResult {
  const remoteFoldersFromKey = safeParseJsonArray<FollowFolder>(remoteEntries["followFolders"]);

  const localFollowed = safeParseJsonArray<FollowedStreamer>(storage.getItem("followedStreamers"));
  const localFolders = safeParseJsonArray<FollowFolder>(storage.getItem("followFolders"));
  const localOrder = safeParseJsonArray<FollowListItem>(storage.getItem("followListOrder"));

  let addedStreamers = 0;
  let addedFolderCount = 0;
  let addedFolderItems = 0;

  const streamerByKey = new Map<string, FollowedStreamer>();
  for (const s of localFollowed) {
    if (!s?.platform || !s?.id) continue;
    streamerByKey.set(`${s.platform}:${s.id}`, s);
  }

  const addStreamerIfMissing = (platform: string, id: string, streamer?: Partial<FollowedStreamer>) => {
    const p = String(platform || "").toUpperCase();
    if (!isKnownPlatform(p)) return;
    const sid = String(id || "");
    if (!sid) return;
    const key = `${p}:${sid}`;
    if (streamerByKey.has(key)) return;
    streamerByKey.set(key, {
      id: sid,
      platform: p,
      nickname: streamer?.nickname ?? sid,
      avatarUrl: streamer?.avatarUrl ?? "",
      roomTitle: streamer?.roomTitle ?? "",
      currentRoomId: streamer?.currentRoomId ?? sid,
      liveStatus: streamer?.liveStatus ?? "UNKNOWN"
    });
    addedStreamers += 1;
  };

  const remoteFolders = [...remoteFoldersFromKey];

  // Ensure streamers referenced by folders/order exist (align with FollowProvider)
  for (const folder of remoteFolders) {
    for (const rawKey of folder?.streamerIds ?? []) {
      const norm = normalizeStreamerKey(rawKey);
      if (!norm.id || !isKnownPlatform(norm.platform)) continue;
      addStreamerIfMissing(norm.platform, norm.id);
    }
  }

  const existingFolderIds = new Set(localFolders.map((f) => String(f?.id || "")).filter(Boolean));
  const folderByName = new Map<string, FollowFolder>();
  for (const f of localFolders) {
    const name = String(f?.name || "").trim();
    if (!name || !f?.id) continue;
    folderByName.set(name.toLowerCase(), f);
  }

  const mergedFolders: FollowFolder[] = [...localFolders.map((f) => ({ ...f, streamerIds: Array.isArray(f.streamerIds) ? [...f.streamerIds] : [] }))];
  const mergedFolderById = new Map<string, FollowFolder>();
  mergedFolders.forEach((f) => {
    if (f?.id) mergedFolderById.set(f.id, f);
  });

  for (const rf of remoteFolders) {
    const name = String(rf?.name || "").trim();
    if (!name) continue;
    const match = folderByName.get(name.toLowerCase());
    const nextStreamerIds = uniqPreserveOrder(
      (Array.isArray(rf?.streamerIds) ? rf.streamerIds : [])
        .map((x) => normalizeStreamerKey(String(x)).key)
        .filter((k) => {
          const norm = normalizeStreamerKey(k);
          return !!norm.id && isKnownPlatform(norm.platform);
        })
    );

    if (match && match.id) {
      const target = mergedFolderById.get(match.id);
      if (!target) continue;
      const before = target.streamerIds.length;
      const existing = new Set(target.streamerIds.map((x) => normalizeStreamerKey(String(x)).key));
      for (const k of nextStreamerIds) {
        if (existing.has(k)) continue;
        existing.add(k);
        target.streamerIds.push(k);
      }
      const delta = target.streamerIds.length - before;
      if (delta > 0) addedFolderItems += delta;
      continue;
    }

    const id = ensureUuid(existingFolderIds, rf?.id);
    existingFolderIds.add(id);
    const folder: FollowFolder = {
      id,
      name,
      streamerIds: nextStreamerIds,
      expanded: true
    };
    mergedFolders.push(folder);
    mergedFolderById.set(id, folder);
    folderByName.set(name.toLowerCase(), folder);
    addedFolderCount += 1;
    addedFolderItems += nextStreamerIds.length;
  }

  const mergedStreamers = Array.from(streamerByKey.values());

  // Rebuild list order: keep local order, append newly added folders/streamers.
  const folderedKeys = new Set<string>();
  for (const f of mergedFolders) {
    for (const rawKey of f.streamerIds ?? []) {
      folderedKeys.add(normalizeStreamerKey(String(rawKey)).key);
    }
  }

  const localFolderOrder = (Array.isArray(localOrder) ? localOrder : []).filter((x): x is Extract<FollowListItem, { type: "folder" }> => x?.type === "folder");
  const localStreamerOrder = (Array.isArray(localOrder) ? localOrder : []).filter((x): x is Extract<FollowListItem, { type: "streamer" }> => x?.type === "streamer");

  const folderIdsInOrder = new Set(localFolderOrder.map((x) => String(x?.data?.id || "")).filter(Boolean));
  const updatedFolderItems: FollowListItem[] = [];
  for (const item of localFolderOrder) {
    const id = String(item?.data?.id || "");
    const merged = id ? mergedFolderById.get(id) : null;
    if (!merged) continue;
    updatedFolderItems.push({ type: "folder", data: merged });
  }
  for (const f of mergedFolders) {
    if (!f?.id || folderIdsInOrder.has(f.id)) continue;
    updatedFolderItems.push({ type: "folder", data: f });
  }

  const streamerKeysInOrder = new Set<string>();
  const updatedStreamerItems: FollowListItem[] = [];
  for (const item of localStreamerOrder) {
    const s = item.data;
    if (!s?.platform || !s?.id) continue;
    const key = normalizeStreamerKey(`${s.platform}:${s.id}`).key;
    if (folderedKeys.has(key) || streamerKeysInOrder.has(key)) continue;
    streamerKeysInOrder.add(key);
    const merged = streamerByKey.get(`${String(s.platform).toUpperCase()}:${String(s.id)}`);
    updatedStreamerItems.push({ type: "streamer", data: merged ?? s });
  }
  for (const s of mergedStreamers) {
    const key = normalizeStreamerKey(`${s.platform}:${s.id}`).key;
    if (folderedKeys.has(key) || streamerKeysInOrder.has(key)) continue;
    streamerKeysInOrder.add(key);
    updatedStreamerItems.push({ type: "streamer", data: s });
  }

  const mergedOrder: FollowListItem[] = [...updatedFolderItems, ...updatedStreamerItems];

  storage.setItem("followedStreamers", JSON.stringify(mergedStreamers));
  storage.setItem("followFolders", JSON.stringify(mergedFolders));
  storage.setItem("followListOrder", JSON.stringify(mergedOrder));

  return { addedStreamers, addedFolderCount, addedFolderItems };
}
