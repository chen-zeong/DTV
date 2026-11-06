import { Card } from "@heroui/react";
import { Play, Star } from "lucide-react";
import { useCallback } from "react";
import type { Streamer } from "@/api";
import { SmoothImage } from "@/components/common/SmoothImage";
import { STREAMER_COVER_WIDTH } from "@/lib/imageProxy";
import { cn } from "@/lib/cn";
import { formatViewers } from "@/lib/format";
import { useOpenPlayer } from "@/lib/navigation";
import styles from "./StreamerCard.module.css";

interface StreamerCardProps {
  streamer: Streamer;
  followed: boolean;
  onToggleFollow: () => void;
  /** 首屏前几张图提高加载优先级 */
  priority?: boolean;
  /** 与当前筛选分类相同，不再重复展示分类胶囊 */
  hideCategory?: boolean;
}

/** 卡片 hover/focus 时预取播放页 chunk（P-12），点进去时几乎无等待。 */
function prefetchPlayer() {
  void import("@/screens/PlayerPage").catch(() => undefined);
}

/**
 * 主播/直播间卡片。
 *
 * 外层使用 HeroUI 官方 Card（官方圆角、表面和投影），内部媒体区自定义：
 *  - 封面 / 人气 / 播放提示 / 关注星标
 *  - 不再显示直播/未开播状态
 *  - 关注按钮独立于卡片点击（结构分离，不会误触）
 */
export function StreamerCard({
  streamer,
  followed,
  onToggleFollow,
  priority = false,
  hideCategory = false,
}: StreamerCardProps) {
  const openPlayer = useOpenPlayer();

  const open = useCallback(() => {
    openPlayer(streamer.platform, streamer.id);
  }, [openPlayer, streamer.id, streamer.platform]);

  return (
    <Card className={styles.card}>
      <div className={styles.media}>
        <button
          type="button"
          className={styles.coverBtn}
          onClick={open}
          onPointerEnter={prefetchPlayer}
          onFocus={prefetchPlayer}
          aria-label={`进入 ${streamer.nickname} 的直播间`}
        >
          <SmoothImage
            src={streamer.cover}
            alt={streamer.title}
            className={styles.cover}
            priority={priority}
            displayWidth={STREAMER_COVER_WIDTH}
          />
          <span className={styles.viewers}>{formatViewers(streamer.viewers)}</span>
          <span className={styles.playHint} aria-hidden="true">
            <Play size={17} strokeWidth={2.2} fill="currentColor" />
          </span>
        </button>

        <button
          type="button"
          className={cn(styles.followBtn, followed && styles.followBtnOn)}
          onClick={onToggleFollow}
          aria-label={followed ? "取消关注" : "关注"}
          aria-pressed={followed}
        >
          <Star size={15} strokeWidth={2.4} fill={followed ? "currentColor" : "none"} />
        </button>
      </div>

      <button type="button" className={styles.meta} onClick={open}>
        <span className={styles.avatar}>
          <SmoothImage src={streamer.avatar} alt={streamer.nickname} rounded priority={priority} />
        </span>
        <span className={styles.metaText}>
          <span className={styles.nickname}>{streamer.nickname}</span>
          <span className={styles.title}>{streamer.title}</span>
        </span>
        {streamer.categoryName && !hideCategory && (
          <span className={styles.category}>{streamer.categoryName}</span>
        )}
      </button>
    </Card>
  );
}
