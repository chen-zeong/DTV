import { useEffect, useState } from "react";
import { api, type CategoryGroup, type LivePlatform, type Streamer } from "@/api";
import { CategoryBar } from "@/components/categories/CategoryBar";
import { StreamerGrid } from "@/components/streamers/StreamerGrid";
import { Spinner } from "@/components/ui/Spinner";
import { useFollow } from "@/state/FollowProvider";
import styles from "./HomeScreen.module.css";

interface HomeScreenProps {
  platform: LivePlatform;
}

/**
 * 四个平台共用的首页。
 *
 * 旧项目有 DouyuHomePage / HuyaHomePage / DouyinHomePage / BilibiliHomePage
 * 四个近乎相同的 screen（各自 ~300 行，重复的分类拉取 + 列表拉取 + 错误处理），
 * 平台差异其实只在"接口名"。这里一份实现 + platform 参数，差异留给 api 层。
 */
export function HomeScreen({ platform }: HomeScreenProps) {
  const { isFollowing, toggleFollow } = useFollow();

  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [loadingStreamers, setLoadingStreamers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 拉分区
  useEffect(() => {
    let cancelled = false;
    setLoadingCategories(true);
    setError(null);
    api
      .listCategories(platform)
      .then((next) => {
        if (cancelled) return;
        setGroups(next);
        setActiveCategory(next[0]?.categories[0]?.id ?? "");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "分区加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoadingCategories(false);
      });
    return () => {
      cancelled = true;
    };
  }, [platform, reloadKey]);

  // 拉主播列表
  useEffect(() => {
    if (!activeCategory) return;
    let cancelled = false;
    setLoadingStreamers(true);
    setError(null);
    api
      .listStreamers(platform, activeCategory)
      .then((next) => {
        if (!cancelled) setStreamers(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "主播列表加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoadingStreamers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [platform, activeCategory, reloadKey]);

  return (
    <div className={styles.root}>
      {loadingCategories ? (
        <div className={styles.categoriesLoading}>
          <Spinner size={16} />
          <span>正在加载分区…</span>
        </div>
      ) : (
        groups.length > 0 && (
          <CategoryBar
            groups={groups}
            activeId={activeCategory}
            onSelect={setActiveCategory}
          />
        )
      )}

      {error && (
        <div className={styles.error}>
          <p className={styles.errorText}>{error}</p>
          <button type="button" className={styles.retry} onClick={() => setReloadKey((k) => k + 1)}>
            重试
          </button>
        </div>
      )}

      <div className={styles.listArea}>
        <StreamerGrid
          streamers={streamers}
          loading={loadingStreamers}
          isFollowed={isFollowing}
          onToggleFollow={toggleFollow}
        />
      </div>
    </div>
  );
}
