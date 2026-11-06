import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, type LivePlatform, type Streamer } from "@/api";
import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";

/**
 * 关注列表 + 关注分组（文件夹）。
 *
 * 旧项目用 `Platform.DOUYU / 'DOUYU'` 等四种写法来回转换，且关注项的
 * 字段与列表项不一致（FollowedStreamer vs LiveStreamer）。这里只存
 * 渲染关注列表所需的最小字段 + 原始 id。
 *
 * 文件夹的数据模型（相比旧版 423 行 listOrder 归一化逻辑大幅简化）：
 *   - follows  关注的主播，唯一数据源（行的头像/昵称都从这里取）
 *   - folders  文件夹，内部用 `keys`（`platform:id`）保存成员及其顺序
 *   - order    顶层主播（不在任何文件夹里）的展示顺序
 * 三者放在**同一个 state 对象**里，任何一次写入都经过 normalize()，
 * 于是"主播同时出现在文件夹和顶层"、"key 引用了已取关的主播"这类脏数据
 * 在数据层面就不可能存在，UI 不需要再做兼容。
 */

export interface FollowRecord {
  id: string;
  platform: LivePlatform;
  nickname: string;
  title: string;
  avatar: string;
  /** 关注时的在线人气，仅用于列表展示 */
  viewers: number;
  /** 关注时/最近一次刷新时的直播状态 */
  isLive: boolean;
  followedAt: number;
}

export interface FollowFolder {
  id: string;
  name: string;
  /** 折叠状态；默认展开 */
  collapsed: boolean;
  /** 成员 key（`platform:id`），顺序即文件夹内展示顺序 */
  keys: string[];
}

/** 文件夹 + 已解析出来的成员 */
export interface FollowFolderView extends FollowFolder {
  records: FollowRecord[];
}

interface FollowState {
  follows: FollowRecord[];
  folders: FollowFolder[];
  order: string[];
}

interface FollowContextValue {
  follows: FollowRecord[];
  byPlatform: Record<LivePlatform, FollowRecord[]>;
  /** 顶层（不在任何文件夹里）的主播，按用户排序 */
  topLevel: FollowRecord[];
  folders: FollowFolderView[];
  /** key -> 记录，供 UI 反查 */
  byKey: Map<string, FollowRecord>;
  isFollowing: (platform: LivePlatform, id: string) => boolean;
  toggleFollow: (streamer: Streamer) => void;
  removeFollow: (platform: LivePlatform, id: string) => void;
  createFolder: (name: string) => void;
  renameFolder: (folderId: string, name: string) => void;
  deleteFolder: (folderId: string) => void;
  toggleFolder: (folderId: string) => void;
  /** 把主播移入文件夹（会从其它文件夹和顶层列表里摘掉） */
  moveToFolder: (key: string, folderId: string) => void;
  /** 把主播移出文件夹，回到顶层列表 */
  removeFromFolder: (key: string, folderId: string) => void;
  /** 拖拽调整顶层关注顺序 */
  reorderTopLevel: (fromKey: string, toKey: string) => void;
  /** 拖拽调整文件夹顺序 */
  reorderFolders: (fromId: string, toId: string) => void;
  /** 从各平台刷新关注主播的直播状态 / 标题 / 头像 */
  refreshStatuses: () => Promise<FollowRefreshResult>;
  /**
   * 是否正在刷新。
   *
   * 放在 Provider 而不是 FollowsList 里，是因为启动后那次自动刷新也发生在
   * 这里 —— 只有状态在这里，刷新按钮才能在自动刷新时同样转圈、显示进度。
   */
  refreshing: boolean;
  /** 刷新进度（已完成 / 总数），未刷新时为 0/0 */
  refreshProgress: FollowRefreshProgress;
}

export interface FollowRefreshProgress {
  done: number;
  total: number;
}

export interface FollowRefreshResult {
  total: number;
  updated: number;
  failed: number;
  /** true 表示这次调用因为上一轮还在跑而被跳过（调用方不必提示） */
  skipped?: boolean;
}

const FollowContext = createContext<FollowContextValue | null>(null);

/** `platform:id` —— 关注项在整个应用里的唯一 key */
export function followKey(platform: LivePlatform | string, id: string): string {
  return `${platform}:${id}`;
}

/**
 * 在播的排前面；数组是稳定排序，所以同状态内仍然保持传入的相对顺序。
 */
export function sortLiveFirst(records: FollowRecord[]): FollowRecord[] {
  // 已经有序时直接返回原数组，避免每次渲染都产生新引用
  let sorted = true;
  for (let i = 1; i < records.length; i += 1) {
    const prev = records[i - 1];
    const curr = records[i];
    if (prev && curr && !prev.isLive && curr.isLive) {
      sorted = false;
      break;
    }
  }
  if (sorted) return records;
  return [...records].sort((a, b) => Number(b.isLive) - Number(a.isLive));
}

function newFolderId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 给单条刷新请求加超时，避免某个平台卡住时整轮刷新永远结束不了 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} 超时`));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/* ---------------------------------------------------------------------------
 * 老 Tauri 版数据结构
 *
 * 4.0 的 localStorage 键名已经和老版对齐，所以值也必须写成老版形状，
 * 否则旧版本读到的关注项会缺字段。内部仍然使用上面的 FollowRecord /
 * FollowFolder（小写平台、keys / collapsed），只在读写边界做转换。
 * ------------------------------------------------------------------------- */

type LegacyPlatform = "DOUYU" | "DOUYIN" | "HUYA" | "BILIBILI";

const LEGACY_PLATFORM: Record<LivePlatform, LegacyPlatform> = {
  douyu: "DOUYU",
  douyin: "DOUYIN",
  huya: "HUYA",
  bilibili: "BILIBILI",
};

const PLATFORMS: LivePlatform[] = ["douyu", "douyin", "huya", "bilibili"];

/**
 * 刷新关注状态时的并发数。
 *
 * 一次刷新的请求都是独立房间的轻量房间信息（getRoomInfo），互相没有依赖，
 * 所以并发跑。取值 6 是"明显快"和"别把上游/风控惹毛"之间的折中：
 * 关注主播通常跨 2~4 个平台，单平台瞬时并发一般不超过 2~3。
 */
const REFRESH_CONCURRENCY = 6;

interface LegacyFollowedStreamer {
  id: string;
  platform: LegacyPlatform;
  nickname: string;
  avatarUrl: string;
  roomTitle?: string;
  currentRoomId: string;
  liveStatus: "UNKNOWN" | "LIVE" | "OFFLINE";
}

interface LegacyFollowFolder {
  id: string;
  name: string;
  streamerIds: string[];
  expanded?: boolean;
}

type LegacyFollowListItem =
  | { type: "folder"; data: LegacyFollowFolder }
  | { type: "streamer"; data: LegacyFollowedStreamer };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizePlatform(value: unknown): LivePlatform | null {
  const raw = String(value ?? "").trim().toLowerCase();
  return PLATFORMS.includes(raw as LivePlatform) ? (raw as LivePlatform) : null;
}

function normalizeKey(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  const idx = raw.indexOf(":");
  if (idx <= 0) return null;
  const platform = normalizePlatform(raw.slice(0, idx));
  const id = raw.slice(idx + 1).trim();
  return platform && id ? followKey(platform, id) : null;
}

function toTimestamp(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 同时接受 4.0 早期形状和老 Tauri 形状 */
function parseFollow(raw: unknown): FollowRecord | null {
  if (!isRecord(raw)) return null;
  const platform = normalizePlatform(raw.platform);
  const id = String(raw.id ?? raw.currentRoomId ?? "").trim();
  if (!platform || !id) return null;
  const liveStatus = String(raw.liveStatus ?? "").toUpperCase();
  return {
    id,
    platform,
    nickname: String(raw.nickname ?? "").trim() || id,
    title: String(raw.title ?? raw.roomTitle ?? ""),
    avatar: String(raw.avatar ?? raw.avatarUrl ?? ""),
    viewers: toTimestamp(raw.viewers),
    isLive: raw.isLive === true || liveStatus === "LIVE",
    followedAt: toTimestamp(raw.followedAt),
  };
}

/** 同时接受新版 `keys` + `collapsed` 和老版 `streamerIds` + `expanded` */
function parseFolder(raw: unknown): FollowFolder | null {
  if (!isRecord(raw)) return null;
  const name = String(raw.name ?? "").trim();
  if (!name) return null;

  const id = String(raw.id ?? "").trim() || newFolderId();
  const rawKeys = Array.isArray(raw.keys)
    ? raw.keys
    : Array.isArray(raw.streamerIds)
      ? raw.streamerIds
      : [];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const value of rawKeys) {
    const key = normalizeKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }

  const collapsed =
    typeof raw.collapsed === "boolean"
      ? raw.collapsed
      : typeof raw.expanded === "boolean"
        ? !raw.expanded
        : false;

  return { id, name, collapsed, keys };
}

function toLegacyFollow(record: FollowRecord): LegacyFollowedStreamer {
  return {
    id: record.id,
    platform: LEGACY_PLATFORM[record.platform],
    nickname: record.nickname,
    avatarUrl: record.avatar,
    roomTitle: record.title,
    currentRoomId: record.id,
    liveStatus: record.isLive ? "LIVE" : "OFFLINE",
  };
}

function toLegacyKey(key: string): string {
  const idx = key.indexOf(":");
  if (idx <= 0) return key;
  const platform = normalizePlatform(key.slice(0, idx));
  return platform ? `${LEGACY_PLATFORM[platform]}:${key.slice(idx + 1)}` : key;
}

function toLegacyFolder(folder: FollowFolder): LegacyFollowFolder {
  return {
    id: folder.id,
    name: folder.name,
    streamerIds: folder.keys.map(toLegacyKey),
    expanded: !folder.collapsed,
  };
}

/** 老版 followListOrder 把文件夹和顶层主播按展示顺序混排在一起 */
function toLegacyOrder(state: FollowState, records: Map<string, FollowRecord>): LegacyFollowListItem[] {
  const items: LegacyFollowListItem[] = state.folders.map((folder) => ({
    type: "folder",
    data: toLegacyFolder(folder),
  }));
  for (const key of state.order) {
    const record = records.get(key);
    if (!record) continue;
    items.push({ type: "streamer", data: toLegacyFollow(record) });
  }
  return items;
}

/** 把任意状态洗成合法状态（幂等）。所有写入都过这一层。 */
function normalize(state: FollowState): FollowState {
  const follows = state.follows
    .filter((f) => f && f.platform && f.id)
    .map((f) => ({ ...f, isLive: Boolean(f.isLive) }));
  const liveKeys = new Set(follows.map((f) => followKey(f.platform, f.id)));

  const usedKeys = new Set<string>();
  const folderIds = new Set<string>();
  const folders: FollowFolder[] = [];

  for (const folder of state.folders) {
    if (!folder || !folder.id || folderIds.has(folder.id)) continue;
    folderIds.add(folder.id);
    const keys: string[] = [];
    for (const key of folder.keys ?? []) {
      // 已取关的、或已被前一个文件夹占用的，直接丢弃
      if (!liveKeys.has(key) || usedKeys.has(key)) continue;
      usedKeys.add(key);
      keys.push(key);
    }
    folders.push({ ...folder, keys });
  }

  const order: string[] = [];
  const seen = new Set<string>();
  for (const key of state.order) {
    if (!liveKeys.has(key) || usedKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    order.push(key);
  }
  // 兜底：关注了但既不在顶层也不在任何文件夹里的主播，补到顶层末尾
  for (const f of follows) {
    const key = followKey(f.platform, f.id);
    if (usedKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    order.push(key);
  }

  return { follows, folders, order };
}

function loadInitialState(): FollowState {
  const rawFollows = loadJSON<unknown>(STORAGE_KEYS.follows, []);
  const rawFolders = loadJSON<unknown>(STORAGE_KEYS.followFolders, []);
  const rawOrder = loadJSON<unknown>(STORAGE_KEYS.followOrder, []);

  const records = new Map<string, FollowRecord>();
  const addFollow = (record: FollowRecord | null) => {
    if (!record) return;
    const key = followKey(record.platform, record.id);
    if (!records.has(key)) records.set(key, record);
  };
  /** 老版 followListOrder / followFolders 可能引用已不在关注表里的主播 */
  const ensurePlaceholder = (key: string) => {
    if (records.has(key)) return;
    const [platform, id] = key.split(":");
    records.set(key, {
      id,
      platform: platform as LivePlatform,
      nickname: id,
      title: "",
      avatar: "",
      viewers: 0,
      isLive: false,
      followedAt: 0,
    });
  };

  for (const raw of Array.isArray(rawFollows) ? rawFollows : []) addFollow(parseFollow(raw));

  const orderItems = Array.isArray(rawOrder) ? rawOrder : [];
  const orderedKeys: string[] = [];
  const orderFolders: FollowFolder[] = [];

  for (const raw of orderItems) {
    if (typeof raw === "string") {
      const key = normalizeKey(raw);
      if (key) orderedKeys.push(key);
      continue;
    }
    if (!isRecord(raw)) continue;
    if (raw.type === "folder") {
      const folder = parseFolder(raw.data);
      if (folder) orderFolders.push(folder);
      continue;
    }
    // 老版把完整的 FollowedStreamer 内联在排序项里
    const record = parseFollow(raw.type === "streamer" ? raw.data : raw);
    if (record) {
      addFollow(record);
      orderedKeys.push(followKey(record.platform, record.id));
    }
  }

  // 文件夹以 followFolders 为底，再合并 followListOrder 里的定义
  const folderById = new Map<string, FollowFolder>();
  for (const raw of Array.isArray(rawFolders) ? rawFolders : []) {
    const folder = parseFolder(raw);
    if (folder && !folderById.has(folder.id)) folderById.set(folder.id, folder);
  }

  const folders: FollowFolder[] = [];
  const seenFolders = new Set<string>();
  for (const source of [...orderFolders, ...folderById.values()]) {
    if (seenFolders.has(source.id)) continue;
    seenFolders.add(source.id);
    const stored = folderById.get(source.id);
    const keys =
      stored && stored !== source
        ? [...source.keys, ...stored.keys.filter((key) => !source.keys.includes(key))]
        : source.keys;
    folders.push({ ...source, keys });
  }

  for (const folder of folders) {
    for (const key of folder.keys) ensurePlaceholder(key);
  }

  const folderedKeys = new Set<string>();
  for (const folder of folders) {
    for (const key of folder.keys) folderedKeys.add(key);
  }

  const order: string[] = [];
  const seenOrder = new Set<string>();
  for (const key of orderedKeys) {
    if (folderedKeys.has(key) || seenOrder.has(key)) continue;
    ensurePlaceholder(key);
    seenOrder.add(key);
    order.push(key);
  }
  // 兜底：关注了但既不在顶层也不在任何文件夹里的主播，补到顶层末尾
  for (const key of records.keys()) {
    if (folderedKeys.has(key) || seenOrder.has(key)) continue;
    seenOrder.add(key);
    order.push(key);
  }

  return normalize({
    follows: Array.from(records.values()),
    folders,
    order,
  });
}

export function FollowProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FollowState>(loadInitialState);

  /* ------------------------------------------------------- 刷新状态 / 进度 */
  const [refreshing, setRefreshing] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState<FollowRefreshProgress>({
    done: 0,
    total: 0,
  });
  /** 并发闸门：自动刷新和手动刷新不能同时跑（否则进度会来回跳） */
  const refreshingRef = useRef(false);
  /** 供 refreshStatuses 读到最新关注列表，同时让它的引用保持稳定 */
  const followsRef = useRef<FollowRecord[]>(state.follows);
  followsRef.current = state.follows;

  /* ---------------------------------------------------------------- 持久化 */
  // 始终写成老 Tauri 版形状：旧版本 / JSON 导入导出都依赖这些字段名。
  useEffect(() => {
    const records = new Map(
      state.follows.map((record) => [followKey(record.platform, record.id), record]),
    );
    saveJSON(STORAGE_KEYS.follows, state.follows.map(toLegacyFollow));
    saveJSON(STORAGE_KEYS.followFolders, state.folders.map(toLegacyFolder));
    saveJSON(STORAGE_KEYS.followOrder, toLegacyOrder(state, records));
  }, [state]);

  const { follows, folders, order } = state;

  /* ---------------------------------------------------------------- 派生值 */
  const byKey = useMemo(() => {
    const map = new Map<string, FollowRecord>();
    for (const f of follows) map.set(followKey(f.platform, f.id), f);
    return map;
  }, [follows]);

  /**
   * 直播中的排前面（同一状态内保持用户的手动顺序）。
   *
   * 只影响展示，不改动持久化的 order —— 用户拖拽出来的相对顺序仍然保留，
   * 主播上下播时列表会自己归位。侧栏顶层列表和文件夹内部都用它。
   */
  const topLevel = useMemo(() => {
    const rows: FollowRecord[] = [];
    for (const key of order) {
      const record = byKey.get(key);
      if (record) rows.push(record);
    }
    return sortLiveFirst(rows);
  }, [byKey, order]);

  const folderViews = useMemo<FollowFolderView[]>(
    () =>
      folders.map((folder) => ({
        ...folder,
        records: sortLiveFirst(
          folder.keys
            .map((key) => byKey.get(key))
            .filter((record): record is FollowRecord => Boolean(record)),
        ),
      })),
    [byKey, folders],
  );

  const byPlatform = useMemo(() => {
    const next: Record<LivePlatform, FollowRecord[]> = {
      douyu: [],
      huya: [],
      douyin: [],
      bilibili: [],
    };
    for (const f of follows) {
      next[f.platform].push(f);
    }
    return next;
  }, [follows]);

  /* ------------------------------------------------------------------ 操作 */
  // 直接查 byKey（O(1)），首页每张卡片都会调用，关注多时差别明显。
  const isFollowing = useCallback(
    (platform: LivePlatform, id: string) => byKey.has(followKey(platform, id)),
    [byKey],
  );

  const removeFollow = useCallback((platform: LivePlatform, id: string) => {
    const key = followKey(platform, id);
    setState((prev) =>
      normalize({
        follows: prev.follows.filter(
          (f) => !(f.platform === platform && f.id === id),
        ),
        folders: prev.folders.map((folder) =>
          folder.keys.includes(key)
            ? { ...folder, keys: folder.keys.filter((k) => k !== key) }
            : folder,
        ),
        order: prev.order.filter((k) => k !== key),
      }),
    );
  }, []);

  const toggleFollow = useCallback(
    (streamer: Streamer) => {
      const key = followKey(streamer.platform, streamer.id);
      setState((prev) => {
        const existing = prev.follows.find(
          (f) => f.platform === streamer.platform && f.id === streamer.id,
        );
        if (existing) {
          return normalize({
            follows: prev.follows.filter(
              (f) => !(f.platform === streamer.platform && f.id === streamer.id),
            ),
            folders: prev.folders.map((folder) =>
              folder.keys.includes(key)
                ? { ...folder, keys: folder.keys.filter((k) => k !== key) }
                : folder,
            ),
            order: prev.order.filter((k) => k !== key),
          });
        }
        return normalize({
          follows: [
            {
              id: streamer.id,
              platform: streamer.platform,
              nickname: streamer.nickname,
              title: streamer.title,
              avatar: streamer.avatar,
              viewers: streamer.viewers,
              isLive: streamer.isLive,
              followedAt: Date.now(),
            },
            ...prev.follows,
          ],
          folders: prev.folders,
          // 新关注的放顶层最前面，立刻可见（不会掉进文件夹里）
          order: [key, ...prev.order.filter((k) => k !== key)],
        });
      });
    },
    [],
  );

  const createFolder = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const folder: FollowFolder = {
      id: newFolderId(),
      name: trimmed,
      collapsed: false,
      keys: [],
    };
    // 新文件夹排在最前面（顶层主播永远显示在文件夹下方）
    setState((prev) => normalize({ ...prev, folders: [folder, ...prev.folders] }));
  }, []);

  const renameFolder = useCallback((folderId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setState((prev) =>
      normalize({
        ...prev,
        folders: prev.folders.map((f) =>
          f.id === folderId ? { ...f, name: trimmed } : f,
        ),
      }),
    );
  }, []);

  const deleteFolder = useCallback((folderId: string) => {
    setState((prev) => {
      const folder = prev.folders.find((f) => f.id === folderId);
      if (!folder) return prev;
      // 删掉文件夹后，里面的主播回到顶层（放在最前面，保证可见）
      return normalize({
        ...prev,
        folders: prev.folders.filter((f) => f.id !== folderId),
        order: [...folder.keys, ...prev.order],
      });
    });
  }, []);

  const toggleFolder = useCallback((folderId: string) => {
    setState((prev) =>
      normalize({
        ...prev,
        folders: prev.folders.map((f) =>
          f.id === folderId ? { ...f, collapsed: !f.collapsed } : f,
        ),
      }),
    );
  }, []);

  const moveToFolder = useCallback((key: string, folderId: string) => {
    setState((prev) =>
      normalize({
        follows: prev.follows,
        folders: prev.folders.map((folder) => {
          if (folder.id !== folderId) {
            // 一个主播同时只能属于一个文件夹：从其它文件夹里摘掉
            return folder.keys.includes(key)
              ? { ...folder, keys: folder.keys.filter((k) => k !== key) }
              : folder;
          }
          const keys = folder.keys.includes(key) ? folder.keys : [...folder.keys, key];
          // 移入后自动展开，用户能立刻看到结果
          return { ...folder, keys, collapsed: false };
        }),
        order: prev.order.filter((k) => k !== key),
      }),
    );
  }, []);

  const removeFromFolder = useCallback((key: string, folderId: string) => {
    setState((prev) =>
      normalize({
        ...prev,
        folders: prev.folders.map((f) =>
          f.id === folderId ? { ...f, keys: f.keys.filter((k) => k !== key) } : f,
        ),
        order: [key, ...prev.order],
      }),
    );
  }, []);

  const reorderTopLevel = useCallback((fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    setState((prev) => {
      const from = prev.order.indexOf(fromKey);
      if (from < 0 || !prev.order.includes(toKey)) return prev;
      const order = [...prev.order];
      const [moved] = order.splice(from, 1);
      const target = order.indexOf(toKey);
      if (target < 0) return prev;
      order.splice(target, 0, moved);
      return normalize({ ...prev, order });
    });
  }, []);

  const reorderFolders = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setState((prev) => {
      const from = prev.folders.findIndex((f) => f.id === fromId);
      if (from < 0 || !prev.folders.some((f) => f.id === toId)) return prev;
      const folders = [...prev.folders];
      const [moved] = folders.splice(from, 1);
      const target = folders.findIndex((f) => f.id === toId);
      if (target < 0) return prev;
      folders.splice(target, 0, moved);
      return normalize({ ...prev, folders });
    });
  }, []);

  const refreshStatuses = useCallback(async (): Promise<FollowRefreshResult> => {
    // 自动刷新（启动 1.2s 后）与手动刷新共用一把闸门
    if (refreshingRef.current) {
      return { total: 0, updated: 0, failed: 0, skipped: true };
    }
    const snapshot = followsRef.current;
    if (snapshot.length === 0) return { total: 0, updated: 0, failed: 0 };

    refreshingRef.current = true;
    setRefreshing(true);
    setRefreshProgress({ done: 0, total: snapshot.length });

    const queue = [...snapshot];
    let updatedCount = 0;
    let failedCount = 0;
    let doneCount = 0;
    const workerCount = Math.min(REFRESH_CONCURRENCY, queue.length);

    /** 一条处理完（无论成败）就推进一格进度 */
    const tick = () => {
      doneCount += 1;
      setRefreshProgress({ done: doneCount, total: snapshot.length });
    };

    /** 每拿到一条就立刻写回，和老项目一样让状态逐个变化，而不是等全部结束才刷新 UI */
    const applyPatch = (key: string, patch: Partial<FollowRecord>) => {
      setState((prev) =>
        normalize({
          ...prev,
          follows: prev.follows.map((record) =>
            followKey(record.platform, record.id) === key ? { ...record, ...patch } : record,
          ),
        }),
      );
    };

    try {
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (queue.length > 0) {
            const record = queue.shift();
            if (!record) return;
            const key = followKey(record.platform, record.id);
            try {
              const info = await withTimeout(
                api.getRoomInfo(record.platform, record.id),
                15_000,
                `${record.platform}:${record.id}`,
              );
              updatedCount += 1;
              applyPatch(key, {
                nickname: info.nickname || record.nickname,
                title: info.title || record.title,
                avatar: info.avatar || record.avatar,
                viewers: info.viewers || record.viewers,
                isLive: info.isLive,
              });
            } catch (primaryError) {
              // 轻量房间信息失败时退回取流信息接口再试一次（老项目也是逐个平台取详情）
              try {
                const stream = await withTimeout(
                  api.getStreamInfo(record.platform, record.id),
                  20_000,
                  `${record.platform}:${record.id}`,
                );
                updatedCount += 1;
                applyPatch(key, {
                  nickname: stream.nickname || record.nickname,
                  title: stream.title || record.title,
                  avatar: stream.avatar || record.avatar,
                  isLive: stream.isLive,
                });
              } catch (fallbackError) {
                failedCount += 1;
                // 对齐老项目：刷新失败的直播间不要继续挂着"直播中"
                applyPatch(key, { isLive: false });
                console.warn(
                  `[follow-refresh] ${record.platform}:${record.id} 刷新失败`,
                  primaryError,
                  fallbackError,
                );
              }
            } finally {
              tick();
            }
          }
        }),
      );
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
      // 进度条收尾时停在 total/total，方便 UI 播一下"完成"的状态再消失
      setRefreshProgress({ done: snapshot.length, total: snapshot.length });
    }

    console.info(
      `[follow-refresh] 成功 ${updatedCount}/${snapshot.length}，失败 ${failedCount}`,
    );
    return { total: snapshot.length, updated: updatedCount, failed: failedCount };
  }, []);

  const refreshStatusesRef = useRef(refreshStatuses);
  refreshStatusesRef.current = refreshStatuses;

  const didRefreshRef = useRef(false);
  useEffect(() => {
    if (didRefreshRef.current) return;
    didRefreshRef.current = true;
    // 等首屏和 Wails IPC 都就绪后再刷新一次，避免启动瞬间请求全部失败
    const timer = window.setTimeout(() => void refreshStatusesRef.current(), 1200);
    return () => window.clearTimeout(timer);
  }, []);

  const value = useMemo<FollowContextValue>(
    () => ({
      follows,
      byPlatform,
      topLevel,
      folders: folderViews,
      byKey,
      isFollowing,
      toggleFollow,
      removeFollow,
      createFolder,
      renameFolder,
      deleteFolder,
      toggleFolder,
      moveToFolder,
      removeFromFolder,
      reorderTopLevel,
      reorderFolders,
      refreshStatuses,
      refreshing,
      refreshProgress,
    }),
    [
      byKey,
      byPlatform,
      createFolder,
      deleteFolder,
      folderViews,
      follows,
      isFollowing,
      moveToFolder,
      refreshStatuses,
      refreshProgress,
      refreshing,
      removeFollow,
      removeFromFolder,
      reorderFolders,
      reorderTopLevel,
      renameFolder,
      toggleFolder,
      toggleFollow,
      topLevel,
    ],
  );

  return <FollowContext.Provider value={value}>{children}</FollowContext.Provider>;
}

export function useFollow() {
  const ctx = useContext(FollowContext);
  if (!ctx) throw new Error("useFollow 必须在 FollowProvider 内使用");
  return ctx;
}
