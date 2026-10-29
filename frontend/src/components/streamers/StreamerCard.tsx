import { Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Streamer } from "@/api";
import { SmoothImage } from "@/components/common/SmoothImage";
import { cn } from "@/lib/cn";
import { formatViewers } from "@/lib/format";
import styles from "./StreamerCard.module.css";

interface StreamerCardProps {
  streamer: Streamer;
  followed: boolean;
  onToggleFollow: () => void;
}

/**
 * 主播/直播间卡片。
 *
 * 视觉对应旧版的 CommonStreamerList：16:9 封面 + 左上角直播状态 + 右上角人气 +
 * 下方头像/昵称/标题。改进点：
 *  - 整卡是一个 <button>，可用键盘 Tab/Enter 进入（旧版是 div + onClick）
 *  - 关注按钮独立于卡片点击（stopPropagation 换成结构分离，不会误触）
 *  - 人气用 tabular-nums 对齐，避免数字跳动时抖动
 */
export function StreamerCard({ streamer, followed, onToggleFollow }: StreamerCardProps) {
  const navigate = useNavigate();

  return (
    <div className={styles.card}>
      <button
        type="button"
        className={styles.coverBtn}
        onClick={() => navigate(`/player?platform=${streamer.platform}&roomId=${streamer.id}`)}
        aria-label={`进入 ${streamer.nickname} 的直播间`}
      >
        <SmoothImage src={streamer.cover} alt={streamer.title} className={styles.cover} />
        <span className={styles.coverShade} aria-hidden="true" />
        {streamer.isLive ? (
          <span className={styles.liveBadge}>
            <span className={styles.liveDot} />
            直播中
          </span>
        ) : (
          <span className={styles.offlineBadge}>未开播</span>
        )}
        <span className={styles.viewers}>{formatViewers(streamer.viewers)}</span>
      </button>

      <button
        type="button"
        className={cn(styles.followBtn, followed && styles.followBtnOn)}
        onClick={onToggleFollow}
        aria-label={followed ? "取消关注" : "关注"}
        aria-pressed={followed}
      >
        <Star size={14} strokeWidth={2.4} fill={followed ? "currentColor" : "none"} />
      </button>

      <button
        type="button"
        className={styles.meta}
        onClick={() => navigate(`/player?platform=${streamer.platform}&roomId=${streamer.id}`)}
      >
        <span className={styles.avatar}>
          <SmoothImage src={streamer.avatar} alt={streamer.nickname} rounded />
        </span>
        <span className={styles.metaText}>
          <span className={styles.nickname}>{streamer.nickname}</span>
          <span className={styles.title}>{streamer.title}</span>
        </span>
        <span className={styles.category}>{streamer.categoryName}</span>
      </button>
    </div>
  );
}
