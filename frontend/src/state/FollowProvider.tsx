import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { LivePlatform, Streamer } from "@/api";
import { STORAGE_KEYS, usePersistentState } from "@/lib/storage";

/**
 * 关注列表。
 *
 * 旧项目用 `Platform.DOUYU / 'DOUYU'` 等四种写法来回转换，且关注项的
 * 字段与列表项不一致（FollowedStreamer vs LiveStreamer）。这里只存
 * 渲染关注列表所需的最小字段 + 原始 id。
 */

export interface FollowRecord {
  id: string;
  platform: LivePlatform;
  nickname: string;
  title: string;
  avatar: string;
  /** 关注时的在线人气，仅用于列表展示 */
  viewers: number;
  followedAt: number;
}

interface FollowContextValue {
  follows: FollowRecord[];
  byPlatform: Record<LivePlatform, FollowRecord[]>;
  isFollowing: (platform: LivePlatform, id: string) => boolean;
  toggleFollow: (streamer: Streamer) => void;
  removeFollow: (platform: LivePlatform, id: string) => void;
}

const FollowContext = createContext<FollowContextValue | null>(null);

const EMPTY_BY_PLATFORM: Record<LivePlatform, FollowRecord[]> = {
  douyu: [],
  huya: [],
  douyin: [],
  bilibili: [],
};

export function FollowProvider({ children }: { children: ReactNode }) {
  const [follows, setFollows] = usePersistentState<FollowRecord[]>(STORAGE_KEYS.follows, []);

  const isFollowing = useCallback(
    (platform: LivePlatform, id: string) =>
      follows.some((f) => f.platform === platform && f.id === id),
    [follows],
  );

  const toggleFollow = useCallback(
    (streamer: Streamer) => {
      setFollows(
        follows.some((f) => f.platform === streamer.platform && f.id === streamer.id)
          ? follows.filter((f) => !(f.platform === streamer.platform && f.id === streamer.id))
          : [
              {
                id: streamer.id,
                platform: streamer.platform,
                nickname: streamer.nickname,
                title: streamer.title,
                avatar: streamer.avatar,
                viewers: streamer.viewers,
                followedAt: Date.now(),
              },
              ...follows,
            ],
      );
    },
    [follows, setFollows],
  );

  const removeFollow = useCallback(
    (platform: LivePlatform, id: string) => {
      setFollows(follows.filter((f) => !(f.platform === platform && f.id === id)));
    },
    [follows, setFollows],
  );

  const byPlatform = useMemo(() => {
    const next: Record<LivePlatform, FollowRecord[]> = { ...EMPTY_BY_PLATFORM };
    for (const f of follows) {
      next[f.platform] = [...next[f.platform], f];
    }
    return next;
  }, [follows]);

  const value = useMemo<FollowContextValue>(
    () => ({ follows, byPlatform, isFollowing, toggleFollow, removeFollow }),
    [follows, byPlatform, isFollowing, toggleFollow, removeFollow],
  );

  return <FollowContext.Provider value={value}>{children}</FollowContext.Provider>;
}

export function useFollow(): FollowContextValue {
  const ctx = useContext(FollowContext);
  if (!ctx) throw new Error("useFollow 必须在 FollowProvider 内使用");
  return ctx;
}
