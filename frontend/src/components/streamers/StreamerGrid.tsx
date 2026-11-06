import type { LivePlatform, Streamer } from "@/api";
import { RotateCw } from "lucide-react";
import { SignalMark } from "@/components/common/SignalMark";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { StreamerCard } from "./StreamerCard";
import styles from "./StreamerGrid.module.css";

interface StreamerGridProps {
  streamers: Streamer[];
  /** 首屏加载（显示骨架屏） */
  loading: boolean;
  /** 追加下一页（显示底部小转圈，不清空已有内容） */
  loadingMore?: boolean;
  /** 是否还有下一页；false 且列表非空时显示"到底了" */
  hasMore?: boolean;
  isFollowed: (platform: LivePlatform, id: string) => boolean;
  onToggleFollow: (streamer: Streamer) => void;
  /** 空态里的"刷新"动作 */
  onRetry?: () => void;
  /** 因三级分区过滤过窄导致空列表时，提供"清除筛选" */
  onClearFilter?: () => void;
  platform?: LivePlatform;
  /** 当前筛选的分类名；卡片不再重复显示同一个分类 */
  categoryFilterName?: string;
}

const SKELETON_COUNT = 12;

export function StreamerGrid({
  streamers,
  loading,
  loadingMore = false,
  hasMore = false,
  isFollowed,
  onToggleFollow,
  onRetry,
  onClearFilter,
  categoryFilterName,
}: StreamerGridProps) {
  if (loading) {
    return (
      <div className={styles.grid} aria-busy="true">
        {Array.from({ length: SKELETON_COUNT }, (_, i) => (
          <div key={i} className={styles.skeletonCard}>
            <Skeleton height="100%" radius={0} className={styles.skeletonCover} />
            <div className={styles.skeletonMeta}>
              <Skeleton width={34} height={34} radius={17} />
              <div className={styles.skeletonText}>
                <Skeleton width="55%" height={12} radius={6} />
                <Skeleton width="80%" height={10} radius={6} />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (streamers.length === 0) {
    return (
      <div className={styles.empty}>
        <SignalMark size={26} />
        <p className={styles.emptyTitle}>这个分区暂时没有主播在播</p>
        <p className={styles.emptyHint}>换一个分区，或稍后再来看看</p>
        <div className={styles.emptyActions}>
          {onRetry && (
            <button type="button" className={styles.emptyPrimary} onClick={onRetry}>
              <RotateCw size={13} strokeWidth={2.4} />
              刷新
            </button>
          )}
          {onClearFilter && (
            <button type="button" className={styles.emptyGhost} onClick={onClearFilter}>
              清除筛选
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={styles.grid}>
        {streamers.map((streamer, index) => (
          <StreamerCard
            key={`${streamer.platform}-${streamer.id}`}
            streamer={streamer}
            followed={isFollowed(streamer.platform, streamer.id)}
            onToggleFollow={() => onToggleFollow(streamer)}
            // P-07：首屏前 4 张图高优先级，其余低优先级
            priority={index < 4}
            hideCategory={
              Boolean(categoryFilterName) && streamer.categoryName === categoryFilterName
            }
          />
        ))}
      </div>

      {/* 底部分页状态：加载中 / 到底了。滚动触发的加载由 HomeScreen 负责 */}
      <div className={styles.footer}>
        {loadingMore ? (
          <span className={styles.footerLoading}>
            <Spinner size={14} />
            正在加载更多…
          </span>
        ) : hasMore ? (
          <span className={styles.footerHint}>继续下滑加载更多</span>
        ) : (
          <span className={styles.footerHint}>已显示最近 {streamers.length} 条</span>
        )}
      </div>
    </>
  );
}
