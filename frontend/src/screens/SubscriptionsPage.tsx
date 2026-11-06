import { Bookmark, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PLATFORM_LABEL, type LivePlatform } from "@/api";
import { StreamerGrid } from "@/components/streamers/StreamerGrid";
import { useStreamerFeed } from "@/hooks/useStreamerFeed";
import { cn } from "@/lib/cn";
import { useFollow } from "@/state/FollowProvider";
import { useSubscriptions } from "@/state/SubscriptionProvider";
import styles from "./SubscriptionsPage.module.css";

/**
 * 订阅分区页。
 *
 * 不设页头标题、不按平台分组：所有已订阅分区在顶部直接平铺成一行 chip，
 * 尽量把竖向空间留给主播列表。订阅入口在主播列表页的分区栏。
 */
export function SubscriptionsPage() {
  const { subscriptions, unsubscribe } = useSubscriptions();
  const { isFollowing, toggleFollow } = useFollow();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastScrolledKeyRef = useRef<string | null | undefined>(undefined);

  /* 选中项：默认第一个；被取消订阅后回退到第一个 */
  useEffect(() => {
    if (subscriptions.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !subscriptions.some((s) => s.key === selectedKey)) {
      setSelectedKey(subscriptions[0]!.key);
    }
  }, [selectedKey, subscriptions]);

  const selected = useMemo(
    () => subscriptions.find((s) => s.key === selectedKey) ?? null,
    [selectedKey, subscriptions],
  );

  const feed = useStreamerFeed(
    selected ? { platform: selected.platform, categoryId: selected.cate2Id } : null,
    listRef,
  );

  useEffect(() => {
    // keep-alive 恢复时 effect 会重跑，但 selectedKey 没变，不要无脑滚回顶部
    if (lastScrolledKeyRef.current === selectedKey) return;
    lastScrolledKeyRef.current = selectedKey;
    listRef.current?.scrollTo({ top: 0 });
  }, [selectedKey]);

  const handleRemove = useCallback(
    (platform: LivePlatform, cate2Id: string) => {
      unsubscribe(platform, cate2Id);
    },
    [unsubscribe],
  );

  return (
    <div className={styles.root}>
      {subscriptions.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>
            <Bookmark size={26} strokeWidth={1.6} />
          </span>
          <p className={styles.emptyTitle}>还没有订阅任何分区</p>
          <p className={styles.emptyHint}>
            进入任意主播列表，在分区栏点击
            <span className={styles.inlineHint}>
              <Plus size={11} strokeWidth={2.8} />
              订阅分区
            </span>
            即可加到这里。
          </p>
        </div>
      ) : (
        <>
          <div className={styles.subscriptionBar}>
            {subscriptions.map((item) => {
              const active = item.key === selectedKey;
              return (
                <span key={item.key} className={cn(styles.chip, active && styles.chipActive)}>
                  <span
                    className={styles.chipPlatform}
                    data-platform={item.platform}
                    aria-label={PLATFORM_LABEL[item.platform]}
                  >
                    {PLATFORM_LABEL[item.platform]}
                  </span>
                  <button
                    type="button"
                    className={styles.chipMain}
                    onClick={() => setSelectedKey(item.key)}
                    title={`${item.cate1Name} / ${item.cate2Name}`}
                  >
                    {item.cate2Name}
                  </button>
                  <button
                    type="button"
                    className={styles.chipRemove}
                    onClick={() => handleRemove(item.platform, item.cate2Id)}
                    aria-label={`取消订阅 ${item.cate2Name}`}
                    title="取消订阅"
                  >
                    <X size={11} strokeWidth={2.6} />
                  </button>
                </span>
              );
            })}
          </div>

          <div className={styles.listArea} ref={listRef} onScroll={feed.onScroll}>
            <StreamerGrid
              streamers={feed.items}
              loading={feed.loading}
              loadingMore={feed.loadingMore}
              hasMore={feed.hasMore}
              isFollowed={isFollowing}
              onToggleFollow={toggleFollow}
            />
          </div>
        </>
      )}
    </div>
  );
}
