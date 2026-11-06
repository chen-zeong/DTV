import { RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, PLATFORM_LABEL, type Category, type CategoryGroup, type LivePlatform } from "@/api";
import { CategoryBar } from "@/components/categories/CategoryBar";
import { StreamerGrid } from "@/components/streamers/StreamerGrid";
import { Spinner } from "@/components/ui/Spinner";
import { useStreamerFeed } from "@/hooks/useStreamerFeed";
import { useToast } from "@/state/ToastProvider";
import { useFollow } from "@/state/FollowProvider";
import { useSubscriptions } from "@/state/SubscriptionProvider";
import { loadSessionNumber, saveSessionNumber, STORAGE_KEYS } from "@/lib/storage";
import styles from "./HomeScreen.module.css";

interface HomeScreenProps {
  platform: LivePlatform;
}

/**
 * 四个平台共用的首页。
 *
 * 旧项目有 DouyuHomePage / HuyaHomePage / DouyinHomePage / BilibiliHomePage
 * 四个近乎相同的 screen（各自 ~300 行，重复的分类拉取 + 列表拉取 + 错误处理），
 * 平台差异其实只在"接口名"和"斗鱼有三级分区"。这里一份实现 + platform 参数。
 *
 * 分区选择同步到 URL（`?g=&c=&s=`），刷新/深链接/缓存 key 都稳定（U-02）。
 */
export function HomeScreen({ platform }: HomeScreenProps) {
  const { isFollowing, toggleFollow } = useFollow();
  const { isSubscribed, toggle: toggleSubscription } = useSubscriptions();
  const { toast } = useToast();

  const [searchParams, setSearchParams] = useSearchParams();
  const paramsRef = useRef(searchParams);
  paramsRef.current = searchParams;

  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState(() => searchParams.get("g") ?? "");
  const [activeCategoryId, setActiveCategoryId] = useState(() => searchParams.get("c") ?? "");
  const [subCategories, setSubCategories] = useState<Category[]>([]);
  const [activeSubCategoryId, setActiveSubCategoryId] = useState<string | null>(
    () => searchParams.get("s") ?? null,
  );

  const [loadingCategories, setLoadingCategories] = useState(true);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);
  const scrollRestoredRef = useRef<string>("");
  /** 分区树加载标记：keep-alive 恢复时不要重复拉取（reloadKey 变化才强制刷新） */
  const categoryLoadRef = useRef<string>("");
  /** 三级分区加载标记：切回页面时保留已经拿到的三级分区 */
  const subLoadRef = useRef<string>("");
  /** 用户是否手动选过三级分区（包括"全部"），避免 keep-alive 恢复时被默认值覆盖 */
  const subTouchedRef = useRef(false);

  /* ------------------------------------------------------------ 拉分区树 */
  useEffect(() => {
    const loadKey = `${platform}|${reloadKey}`;
    if (categoryLoadRef.current === loadKey) return;
    categoryLoadRef.current = loadKey;
    subLoadRef.current = "";
    subTouchedRef.current = false;

    let cancelled = false;
    // 切平台时先把上一平台的选择清掉：否则会拿旧平台的分区 id
    // 去请求新平台的列表（那一次请求注定是废的，还会闪一下错误态）
    setGroups([]);
    setActiveGroupId("");
    setActiveCategoryId("");
    setSubCategories([]);
    setActiveSubCategoryId(null);
    setLoadingCategories(true);
    setCategoryError(null);
    api
      .listCategories(platform)
      .then((next) => {
        if (cancelled) return;
        setGroups(next);
        // URL 里的分区优先；不存在或首次进入时回落到第一个
        const wantedGroupId = paramsRef.current.get("g");
        const wantedCategoryId = paramsRef.current.get("c");
        const wantedSubId = paramsRef.current.get("s");
        const group = next.find((g) => g.id === wantedGroupId) ?? next[0];
        const category =
          group?.categories.find((c) => c.id === wantedCategoryId) ?? group?.categories[0];
        setActiveGroupId(group?.id ?? "");
        setActiveCategoryId(category?.id ?? "");
        // 三级分区在下面的 effect 里按"URL 优先，否则第一个"决定
        if (wantedSubId) setActiveSubCategoryId(wantedSubId);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        categoryLoadRef.current = "";
        setGroups([]);
        setCategoryError(err instanceof Error ? err.message : "分区加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoadingCategories(false);
      });
    return () => {
      cancelled = true;
    };
  }, [platform, reloadKey]);

  /* -------------------------------------------------- 切二级分区 → 拉三级 */
  useEffect(() => {
    if (!activeCategoryId) {
      subLoadRef.current = "";
      setSubCategories([]);
      return;
    }
    const loadKey = `${platform}|${activeCategoryId}`;
    if (subLoadRef.current === loadKey) return;
    subLoadRef.current = loadKey;

    let cancelled = false;
    setSubCategories([]);
    api
      .listSubCategories(platform, activeCategoryId)
      .then((list) => {
        if (cancelled) return;
        setSubCategories(list);
        setActiveSubCategoryId((prev) => {
          // 用户手动点过（含"全部"）就尊重当前选择
          if (subTouchedRef.current) {
            return prev && list.some((item) => item.id === prev) ? prev : null;
          }
          // 深链接里的 s 只在当前二级分区下仍然存在时保留
          const wanted = paramsRef.current.get("s");
          if (wanted && list.some((item) => item.id === wanted)) return wanted;
          // 默认停在「全部」（= 二级分区维度，包含该分区下的所有直播）。
          // 之前默认选第一个三级分类，切换平台/二级分区后列表会被莫名收窄，
          // 和旧项目"进入分区先看全部"的行为不一致。
          return null;
        });
      })
      .catch(() => {
        if (cancelled) return;
        subLoadRef.current = "";
        setSubCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeCategoryId, platform]);

  /* -------------------------------------------------------------- 列表数据 */
  const feedQuery = useMemo(
    () =>
      activeCategoryId
        ? { platform, categoryId: activeCategoryId, subCategoryId: activeSubCategoryId }
        : null,
    [activeCategoryId, activeSubCategoryId, platform],
  );

  const feed = useStreamerFeed(feedQuery, listRef);

  /* ------------------------------------------------------------ URL 同步 */
  useEffect(() => {
    // 分区还没加载完时不要把深链接里的 ?g=&c= 清掉
    if (loadingCategories || !activeGroupId) return;
    const next = new URLSearchParams(paramsRef.current);
    if (activeGroupId) next.set("g", activeGroupId);
    else next.delete("g");
    if (activeCategoryId) next.set("c", activeCategoryId);
    else next.delete("c");
    if (activeSubCategoryId) next.set("s", activeSubCategoryId);
    else next.delete("s");
    if (next.toString() !== paramsRef.current.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [activeCategoryId, activeGroupId, activeSubCategoryId, loadingCategories, setSearchParams]);

  /* -------------------------------------------- 滚动位置保存 / 恢复（U-01） */
  const scrollKey = `${platform}|${activeGroupId}|${activeCategoryId}|${activeSubCategoryId ?? ""}`;
  const scrollKeyRef = useRef(scrollKey);
  scrollKeyRef.current = scrollKey;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (scrollRestoredRef.current === scrollKey) return;
    if (feed.items.length === 0) return;
    scrollRestoredRef.current = scrollKey;
    const saved = loadSessionNumber(STORAGE_KEYS.scrollPosition(scrollKey), 0);
    el.scrollTop = saved;
  }, [feed.items.length, scrollKey]);

  const scrollSaveRaf = useRef(0);
  useEffect(() => {
    const el = listRef.current;
    return () => {
      if (scrollSaveRaf.current) window.cancelAnimationFrame(scrollSaveRaf.current);
      if (el) saveSessionNumber(STORAGE_KEYS.scrollPosition(scrollKeyRef.current), el.scrollTop);
    };
  }, []);

  const handleScroll = useCallback<React.UIEventHandler<HTMLDivElement>>(
    (event) => {
      feed.onScroll(event);
      // 分区栏始终保持完整展开：滚动时不再收成一行（用户明确要求
      // 一级/二级/三级分类都不要因为上滑而折叠）
      const top = event.currentTarget.scrollTop;
      if (scrollSaveRaf.current) return;
      scrollSaveRaf.current = window.requestAnimationFrame(() => {
        scrollSaveRaf.current = 0;
        saveSessionNumber(STORAGE_KEYS.scrollPosition(scrollKeyRef.current), top);
      });
    },
    [feed],
  );

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? groups[0],
    [groups, activeGroupId],
  );

  const activeCategory = useMemo(
    () => activeGroup?.categories.find((c) => c.id === activeCategoryId),
    [activeCategoryId, activeGroup],
  );

  const subscribed = activeCategory
    ? isSubscribed(platform, activeCategory.id)
    : false;

  const handleSelectGroup = useCallback(
    (id: string) => {
      setActiveGroupId(id);
      const group = groups.find((g) => g.id === id);
      // 切一级分区时自动选中它的第一个二级分区（旧版行为一致）
      setActiveCategoryId(group?.categories[0]?.id ?? "");
      setActiveSubCategoryId(null);
      subTouchedRef.current = false;
    },
    [groups],
  );

  const handleToggleSubscribe = useCallback(() => {
    if (!activeCategory || !activeGroup) return;
    const wasSubscribed = isSubscribed(platform, activeCategory.id);
    toggleSubscription({
      platform,
      cate1Id: activeGroup.id,
      cate1Name: activeGroup.name,
      cate2Id: activeCategory.id,
      cate2Name: activeCategory.name,
    });
    toast(wasSubscribed ? "已取消订阅该分区" : "已订阅该分区", "success");
  }, [activeCategory, activeGroup, isSubscribed, platform, toast, toggleSubscription]);

  const handleRetry = useCallback(() => {
    setReloadKey((k) => k + 1);
    feed.reload();
  }, [feed]);

  const error = categoryError ?? feed.error;
  // 只有斗鱼的分区需要从远端拉取；其余平台是固定分区，静默等待即可
  const showCategoryLoading = loadingCategories && platform === "douyu";

  return (
    <div className={styles.root}>
      <h1 className="visually-hidden">{PLATFORM_LABEL[platform]}直播 · 热门直播</h1>

      {showCategoryLoading ? (
        <div className={styles.categoriesLoading}>
          <Spinner size={13} />
          <span>正在加载分区…</span>
        </div>
      ) : groups.length > 0 ? (
        <CategoryBar
          groups={groups}
          activeGroupId={activeGroupId}
          activeCategoryId={activeCategoryId}
          onSelectGroup={handleSelectGroup}
          onSelectCategory={(category) => {
            setActiveCategoryId(category.id);
            setActiveSubCategoryId(null);
            subTouchedRef.current = false;
          }}
          subCategories={subCategories}
          activeSubCategoryId={activeSubCategoryId}
          onSelectSubCategory={(id) => {
            subTouchedRef.current = true;
            setActiveSubCategoryId(id);
          }}
          canSubscribe={Boolean(activeCategory)}
          subscribed={subscribed}
          onToggleSubscribe={handleToggleSubscribe}
        />
      ) : null}

      {error && (
        <div className={styles.error} role="status">
          <p className={styles.errorText}>{error}</p>
          <button type="button" className={styles.retry} onClick={handleRetry}>
            <RotateCw size={12} strokeWidth={2.4} />
            重试
          </button>
        </div>
      )}

      <div className={styles.listArea} ref={listRef} onScroll={handleScroll}>
        <StreamerGrid
          streamers={feed.items}
          loading={loadingCategories || (feed.loading && feed.items.length === 0)}
          loadingMore={feed.loadingMore}
          hasMore={feed.hasMore}
          isFollowed={isFollowing}
          onToggleFollow={toggleFollow}
          onRetry={handleRetry}
          onClearFilter={
            activeSubCategoryId
              ? () => setActiveSubCategoryId(null)
              : undefined
          }
          platform={platform}
          categoryFilterName={activeCategory?.name}
        />
      </div>
    </div>
  );
}
