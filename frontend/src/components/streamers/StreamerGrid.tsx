import type { LivePlatform, Streamer } from "@/api";
import { Skeleton } from "@/components/ui/Skeleton";
import { StreamerCard } from "./StreamerCard";
import styles from "./StreamerGrid.module.css";

interface StreamerGridProps {
  streamers: Streamer[];
  loading: boolean;
  isFollowed: (platform: LivePlatform, id: string) => boolean;
  onToggleFollow: (streamer: Streamer) => void;
}

const SKELETON_COUNT = 12;

export function StreamerGrid({ streamers, loading, isFollowed, onToggleFollow }: StreamerGridProps) {
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
        <p className={styles.emptyTitle}>这个分区暂时没有主播在播</p>
        <p className={styles.emptyHint}>换一个分区，或稍后再来看看</p>
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {streamers.map((streamer) => (
        <StreamerCard
          key={`${streamer.platform}-${streamer.id}`}
          streamer={streamer}
          followed={isFollowed(streamer.platform, streamer.id)}
          onToggleFollow={() => onToggleFollow(streamer)}
        />
      ))}
    </div>
  );
}
