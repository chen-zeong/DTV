import { useCallback, useEffect, useRef, useState } from "react";
import { api, type LivePlatform, type Streamer } from "@/api";
import { prefetchStreamerImages } from "@/lib/imageProxy";

/** 距离底部多少像素时开始预取下一页（提前一点，滚动更顺） */
const PREFETCH_THRESHOLD = 320;

/**
 * "内容还差多少就算没填满一屏"的阈值。
 *
 * 只比 0 大一点点：容器能滚动（哪怕只有几十像素）时交给 scroll 事件去预取，
 * 这里只在"根本滚不动"的时候补页，避免每次打开分区都多拉一页。
 */
const VIEWPORT_FILL_THRESHOLD = 16;

/** 缓存多久内不重复请求（返回首页、切回分区都是瞬时的） */
const CACHE_TTL = 60_000;

/** 单个分区最多保留多少张卡片（P-08：避免长会话无限累积 DOM/图片） */
const MAX_ITEMS = 300;

export interface FeedQuery {
  platform: LivePlatform;
  /** 二级分区 id */
  categoryId: string;
  /** 三级分区 id；有值时按三级分区取列表 */
  subCategoryId?: string | null;
}

export interface StreamerFeed {
  items: Streamer[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  /** 是否命中缓存（用于避免滚动位置恢复时闪骨架屏） */
  fromCache: boolean;
  /** 重新拉第一页（错误重试 / 手动刷新） */
  reload: () => void;
  /** 绑定到滚动容器 */
  onScroll: React.UIEventHandler<HTMLDivElement>;
}

interface CacheEntry {
  items: Streamer[];
  page: number;
  hasMore: boolean;
  ts: number;
}

/**
 * 分区列表缓存（模块级）。
 *
 * 从直播间返回时 HomeScreen 会重新挂载，但这里的数据还在：
 * 先渲染缓存，再判断是否过期。滚动位置由 HomeScreen 用 sessionStorage 恢复。
 */
const feedCache = new Map<string, CacheEntry>();

function cacheKeyOf(query: FeedQuery | null): string {
  if (!query) return "";
  return `${query.platform}|${query.categoryId}|${query.subCategoryId ?? ""}`;
}

/**
 * 主播列表的无限滚动取数。
 *
 * 旧项目把"分类拉取 + 列表拉取 + 分页 + 错误 + loading"在四个平台的首页里
 * 各写了一遍（4 × ~300 行）。这里抽成一个 hook：给一个 query，还一页一页的
 * 数据和滚动处理函数。订阅页复用同一份逻辑。
 *
 * 并发保护用 busyRef 而不是 state：滚动事件可能在同一个 tick 里连发多次，
 * 用 state 判断会因为更新还没落地而放过重复请求。
 *
 * `scrollRef` 传滚动容器（可选）。传了之后，第一页内容不足一屏时会自动补
 * 下一页 —— 否则浏览器根本不产生 scroll 事件，"继续下滑加载更多"永远没有
 * 反应（抖音一页 15 条，刚好一屏时必现）。
 */
export function useStreamerFeed(
  query: FeedQuery | null,
  scrollRef?: React.RefObject<HTMLDivElement | null>,
): StreamerFeed {
  const key = cacheKeyOf(query);
  const [items, setItems] = useState<Streamer[]>(() => feedCache.get(key)?.items ?? []);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(() => feedCache.get(key)?.hasMore ?? false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const pageRef = useRef(feedCache.get(key)?.page ?? 0);
  const busyRef = useRef(false);
  /** 已经为哪个 query 装载过数据；Activity keep-alive 恢复 effect 时不再重复拉取 */
  const loadedQueryRef = useRef("");
  /** 已经应用过的 reloadKey（手动刷新只执行一次，keep-alive 恢复时不重复） */
  const loadedReloadRef = useRef(0);
  const retryRef = useRef(0);
  const retryTimerRef = useRef(0);
  /**
   * 请求代号。快速连点分区时，旧请求可能在切换之后才返回，
   * 把过期数据写进列表。每次换 query 就 +1，回调里对不上号的直接丢弃。
   */
  const generationRef = useRef(0);

  const platform = query?.platform ?? null;
  const categoryId = query?.categoryId ?? "";
  const subCategoryId = query?.subCategoryId ?? null;

  /** 拉第 page 页；page=1 表示重新开始（替换列表），否则追加 */
  const loadPage = useCallback(
    (page: number) => {
      if (!platform || !categoryId) return;
      if (busyRef.current) return;
      if (page > 1 && page !== pageRef.current + 1) return;

      const generation = generationRef.current;
      const requestKey = `${platform}|${categoryId}|${subCategoryId ?? ""}`;
      busyRef.current = true;
      if (page === 1) {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }

      const request = subCategoryId
        ? api.listStreamersBySubCategory(platform, subCategoryId, page)
        : api.listStreamers(platform, categoryId, page);

      request
        .then((result) => {
          if (generation !== generationRef.current) return;
          retryRef.current = 0;
          pageRef.current = result.page;
          setHasMore(result.hasMore);
          const commit = (next: Streamer[]) => {
            const capped = next.length > MAX_ITEMS ? next.slice(0, MAX_ITEMS) : next;
            if (capped.length < next.length) setHasMore(false);
            // 列表数据一到就让 Go 侧先缓存首屏封面/头像，避免被浏览器
            // 对 localhost 的 6 条 HTTP/1.1 连接限制分批卡住。
            prefetchStreamerImages(capped);
            feedCache.set(requestKey, {
              items: capped,
              page: result.page,
              hasMore: capped.length < next.length ? false : result.hasMore,
              ts: Date.now(),
            });
            return capped;
          };
          if (page === 1) {
            setItems(commit(result.items));
          } else {
            // 上游翻页偶尔会返回重复房间，按 id 去重避免 key 冲突
            setItems((prev) => {
              const seen = new Set(prev.map((s) => s.id));
              return commit([
                ...prev,
                ...result.items.filter((s) => !seen.has(s.id)),
              ]);
            });
          }
        })
        .catch((err: unknown) => {
          if (generation !== generationRef.current) return;
          setError(err instanceof Error ? err.message : "主播列表加载失败");
          // U-19：第一页失败时自动退避重试（1s / 3s / 9s），最多三次。
          if (page === 1 && retryRef.current < 3) {
            const delay = [1000, 3000, 9000][retryRef.current] ?? 9000;
            retryRef.current += 1;
            retryTimerRef.current = window.setTimeout(() => {
              if (generation === generationRef.current) setReloadKey((k) => k + 1);
            }, delay);
          }
        })
        .finally(() => {
          if (generation !== generationRef.current) return;
          busyRef.current = false;
          setLoading(false);
          setLoadingMore(false);
        });
    },
    [categoryId, platform, subCategoryId],
  );

  // 换分区时清掉未触发的退避重试
  useEffect(() => {
    retryRef.current = 0;
    return () => {
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = 0;
      }
    };
  }, [key]);

  // 换分区 / 换平台 / 手动重试 → 先吃缓存，再按需拉第一页
  useEffect(() => {
    generationRef.current += 1;
    busyRef.current = false;
    setError(null);
    setLoadingMore(false);

    // keep-alive：同一个 query / 同一次手动刷新已经处理过，Activity 重新可见时直接复用内存数据
    if (loadedQueryRef.current === key && loadedReloadRef.current === reloadKey) {
      setLoading(false);
      return;
    }
    loadedQueryRef.current = key;
    loadedReloadRef.current = reloadKey;

    const cached = feedCache.get(key);
    if (cached) {
      pageRef.current = cached.page;
      setItems(cached.items);
      setHasMore(cached.hasMore);
      if (reloadKey === 0 && Date.now() - cached.ts < CACHE_TTL) {
        setLoading(false);
        return;
      }
    } else {
      pageRef.current = 0;
      setItems([]);
      setHasMore(false);
    }

    if (!platform || !categoryId) {
      setLoading(false);
      return;
    }
    setLoading(!cached);
    loadPage(1);
  }, [categoryId, key, loadPage, platform, reloadKey, subCategoryId]);

  // 追加时用最新的 hasMore，避免把已过期的值闭进 loadPage
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;

  const onScroll = useCallback<React.UIEventHandler<HTMLDivElement>>(
    (event) => {
      if (!hasMoreRef.current || busyRef.current) return;
      const el = event.currentTarget;
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (remaining <= PREFETCH_THRESHOLD) loadPage(pageRef.current + 1);
    },
    [loadPage],
  );

  /**
   * 还差多少像素到底。
   * 容器还没布局（clientHeight = 0）时返回 -1，调用方据此跳过。
   */
  const remainingRef = useRef<() => number>(() => -1);
  remainingRef.current = () => {
    const el = scrollRef?.current;
    if (!el || el.clientHeight === 0) return -1;
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  };

  /** 内容不够一屏就继续补页，直到填满或没有更多 */
  const fillViewport = useCallback(() => {
    if (!hasMoreRef.current || busyRef.current) return;
    const remaining = remainingRef.current();
    if (remaining < 0) return;
    if (remaining <= VIEWPORT_FILL_THRESHOLD) loadPage(pageRef.current + 1);
  }, [loadPage]);

  /**
   * 每提交一页就检查一次是否要补页。
   *
   * 用 `key + items.length` 做闸门：同一批数据只补一次，避免请求失败后在
   * effect 里反复重试形成死循环；换分区时 key 变化，会重新判断。
   */
  const filledStampRef = useRef("");
  useEffect(() => {
    const stamp = `${key}|${items.length}`;
    if (filledStampRef.current === stamp) return;
    filledStampRef.current = stamp;
    fillViewport();
  }, [fillViewport, items.length, key]);

  /** 窗口/侧栏尺寸变化后，原本"多余一屏"的内容也可能变成不足一屏 */
  useEffect(() => {
    const el = scrollRef?.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => fillViewport());
    observer.observe(el);
    return () => observer.disconnect();
  }, [fillViewport, scrollRef]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return {
    items,
    loading,
    loadingMore,
    hasMore,
    error,
    fromCache: Boolean(feedCache.get(key)),
    reload,
    onScroll,
  };
}
