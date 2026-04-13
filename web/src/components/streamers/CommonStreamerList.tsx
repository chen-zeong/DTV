"use client";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, Skeleton, Spinner } from "@heroui/react";
import { AnimatePresence, m } from "framer-motion";

import styles from "./CommonStreamerList.module.css";
import { SmoothImage } from "@/components/common/SmoothImage";
import type { CategorySelectedEvent } from "@/platforms/common/categoryTypes";
import type { CommonStreamer } from "@/platforms/common/streamerTypes";
import { useHuyaLiveRooms } from "@/hooks/liveRooms/useHuyaLiveRooms";
import { useDouyinLiveRooms } from "@/hooks/liveRooms/useDouyinLiveRooms";
import { useBilibiliLiveRooms } from "@/hooks/liveRooms/useBilibiliLiveRooms";
import { useDouyuLiveRooms } from "@/hooks/liveRooms/useDouyuLiveRooms";

type DouyuCategorySelection = {
  type: "cate2" | "cate3";
  id: string;
  name?: string;
};

export function CommonStreamerList({
  selectedCategory,
  categoriesData,
  platformName,
  defaultPageSize,
  douyuCategory
}: {
  selectedCategory?: CategorySelectedEvent | null;
  categoriesData?: any[];
  platformName?: "huya" | "douyin" | "douyu" | "bilibili" | string;
  defaultPageSize?: number;
  douyuCategory?: DouyuCategorySelection | null;
}) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef(0);
  const lastScrollAtRef = useRef(0);
  const scrollEndTimerRef = useRef<number | null>(null);

  const platform = platformName ?? "huya";
  const categoryHref = selectedCategory?.cate2Href ?? null;
  const douyuCategoryId = douyuCategory?.id ?? null;
  const douyuCategoryType = douyuCategory?.type ?? null;

  const hasCategory = platform === "douyu" ? !!douyuCategoryId : !!categoryHref;

  const resolvedSubcategoryId = useMemo(() => {
    const href = selectedCategory?.cate2Href;
    const data = categoriesData;
    if (!href || !Array.isArray(data)) return null;
    for (const c1 of data) {
      if (!Array.isArray(c1.subcategories)) continue;
      const c2 = c1.subcategories.find((s: any) => s.href === href);
      if (c2 && (c2.id || c2.gid)) return String(c2.id ?? c2.gid);
    }
    return null;
  }, [categoriesData, selectedCategory?.cate2Href]);

  const douyinPartition = useMemo(() => {
    if (platform !== "douyin") return null;
    const href = selectedCategory?.cate2Href;
    if (!href) return null;
    const parts = href.split("_");
    return parts.length >= 1 ? parts[parts.length - 1] : null;
  }, [platform, selectedCategory?.cate2Href]);

  const douyinPartitionType = useMemo(() => {
    if (platform !== "douyin") return null;
    const href = selectedCategory?.cate2Href;
    if (!href) return null;
    const parts = href.split("_");
    return parts.length >= 2 ? parts[parts.length - 2] : null;
  }, [platform, selectedCategory?.cate2Href]);

  const resolvedParentCategoryId = useMemo(() => {
    const href = selectedCategory?.cate2Href;
    const data = categoriesData;
    if (!href || !Array.isArray(data)) return null;
    for (const c1 of data) {
      if (!Array.isArray(c1.subcategories)) continue;
      const c2 = c1.subcategories.find((s: any) => s.href === href);
      if (c2 && (c2.parent_id || c2.parentId || c1.id)) return String(c2.parent_id ?? c2.parentId ?? c1.id);
    }
    return null;
  }, [categoriesData, selectedCategory?.cate2Href]);

  // 注意：所有平台的 hook 都会被调用（避免违反 React Hooks 规则）。
  // 为了避免“错误平台的分类参数”触发无关的请求，这里对非当前平台的参数传 null。
  const huya = useHuyaLiveRooms(platform === "huya" ? resolvedSubcategoryId : null, { defaultPageSize: defaultPageSize ?? 120 });
  const douyin = useDouyinLiveRooms(douyinPartition, douyinPartitionType);
  const bilibili = useBilibiliLiveRooms(
    platform === "bilibili" ? resolvedSubcategoryId : null,
    platform === "bilibili" ? resolvedParentCategoryId : null
  );
  const douyu = useDouyuLiveRooms(platform === "douyu" ? douyuCategoryType : null, platform === "douyu" ? douyuCategoryId : null);

  const selected = useMemo(() => {
    if (platform === "douyin") return douyin;
    if (platform === "bilibili") return bilibili;
    if (platform === "douyu") return douyu;
    return huya;
  }, [bilibili, douyin, douyu, huya, platform]);

  const rooms: CommonStreamer[] = selected.rooms;
  const isLoading = selected.isLoading;
  const isLoadingMore = selected.isLoadingMore;
  const hasMore = selected.hasMore;
  const error: string | null = (selected as any).error ?? null;

  const uniqueRooms = useMemo(() => {
    const seen = new Set<string>();
    const next: CommonStreamer[] = [];
    for (const room of rooms) {
      const id = String(room.room_id ?? "");
      if (!id) {
        next.push(room);
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      next.push(room);
    }
    return next;
  }, [rooms]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) window.cancelAnimationFrame(scrollRafRef.current);
      if (scrollEndTimerRef.current) window.clearTimeout(scrollEndTimerRef.current);
      if (typeof document !== "undefined") delete document.documentElement.dataset.scrolling;
    };
  }, []);

  const markScrolling = useCallback(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;

    if (root.dataset.scrolling !== "1") root.dataset.scrolling = "1";
    if (scrollEndTimerRef.current) window.clearTimeout(scrollEndTimerRef.current);
    scrollEndTimerRef.current = window.setTimeout(() => {
      delete document.documentElement.dataset.scrolling;
      scrollEndTimerRef.current = null;
    }, 160);
  }, []);

  const maybeEnsureFill = useCallback(() => {
    const rootEl = scrollRef.current;
    if (!rootEl || !hasMore || isLoading || isLoadingMore) return;
    const needsMore = rootEl.scrollHeight - rootEl.clientHeight <= 100;
    if (needsMore) void selected.loadMoreRooms();
  }, [hasMore, isLoading, isLoadingMore, selected]);

  useEffect(() => {
    const id = window.setTimeout(() => maybeEnsureFill(), 50);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms.length, isLoading, isLoadingMore]);

  const goToPlayer = useCallback(
    (roomId: string) => {
      if (!roomId) return;
      router.push(`/player?platform=${encodeURIComponent(platform)}&roomId=${encodeURIComponent(roomId)}`);
    },
    [platform, router]
  );

  const shouldIgnoreClick = useCallback(() => {
    const now = typeof window !== "undefined" && window.performance?.now ? window.performance.now() : Date.now();
    return now - lastScrollAtRef.current < 140;
  }, []);

  const onCardClick = useCallback(
    (roomId: string) => {
      if (shouldIgnoreClick()) return;
      goToPlayer(roomId);
    },
    [goToPlayer, shouldIgnoreClick]
  );

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      markScrolling();
      lastScrollAtRef.current = typeof window !== "undefined" && window.performance?.now ? window.performance.now() : Date.now();

      if (scrollRafRef.current) return;
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = 0;
        if (!hasMore || isLoading || isLoadingMore) return;
        const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 260;
        if (nearBottom) void selected.loadMoreRooms();
      });
    },
    [hasMore, isLoading, isLoadingMore, selected]
  );

  const listKey = useMemo(() => {
    if (platform === "douyu") return `douyu:${douyuCategoryType ?? "none"}:${douyuCategoryId ?? "none"}`;
    return `${platform}:${categoryHref ?? "none"}`;
  }, [categoryHref, douyuCategoryId, douyuCategoryType, platform]);

  const onCardKeyDown = useCallback(
    (e: React.KeyboardEvent, roomId: string) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      onCardClick(roomId);
    },
    [onCardClick]
  );

  // NOTE: click navigation is handled by `onCardClick` to avoid scroll-induced misclicks.

  if (isLoading && rooms.length === 0) {
    const skeletonCount = 10;
    return (
      <div className={styles.container}>
        <div className={styles.scrollArea}>
          <div className={styles.loadingTop}>
            <Spinner size="lg" />
          </div>
          <div className={styles.grid} aria-hidden="true">
            {Array.from({ length: skeletonCount }).map((_, idx) => (
              <div key={idx}>
                <Card className={`${styles.card} ${styles.skeletonCard}`}>
                  <div className={styles.preview}>
                    <Skeleton className={styles.skeletonPreview} />
                  </div>
                  <div className={styles.footer}>
                    <Skeleton className={styles.skeletonAvatar} />
                    <div className={styles.skeletonText}>
                      <Skeleton className={styles.skeletonTitle} />
                      <Skeleton className={styles.skeletonSub} />
                    </div>
                  </div>
                </Card>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!isLoading && rooms.length === 0 && !!error && hasCategory) {
    return (
      <div className={styles.container}>
        <div className={styles.noStreamers} style={{ maxWidth: 720 }}>
          <p style={{ marginBottom: 10, fontWeight: 800 }}>加载失败</p>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", opacity: 0.9, margin: 0 }}>{error}</pre>
          <div style={{ marginTop: 14 }}>
            <button type="button" className="retry-btn" onClick={() => void (selected as any).loadInitialRooms?.()}>
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isLoading && rooms.length === 0 && hasCategory) {
    return (
      <div className={styles.container}>
        <div className={styles.noStreamers}>
          <p>分类下暂无主播</p>
        </div>
      </div>
    );
  }

  if (!hasCategory && !isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.noCategory}>
          <p>请选择一个分类开始浏览</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div
        ref={scrollRef}
        className={styles.scrollArea}
        onScroll={onScroll}
      >
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={listKey}
            className={styles.grid}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.14 } }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
          >
            {uniqueRooms.map((room) => (
              <div
                key={room.room_id}
                className={styles.cardOuter}
                role="button"
                tabIndex={0}
                onClick={() => onCardClick(room.room_id)}
                onKeyDown={(e) => onCardKeyDown(e, room.room_id)}
              >
                <Card className={styles.card}>
                    <div className={styles.preview}>
                      <div className={styles.imageWrapper}>
                        <SmoothImage src={room.room_cover || ""} alt={room.title} className={styles.previewImage} />
                        <div className={styles.overlayGradient} />
                        <span className={styles.viewersOverlay}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                          </svg>
                          {room.viewer_count_str || "0"}
                        </span>
                      </div>
                    </div>
                    <div className={styles.footer}>
                      <div className={styles.avatarContainer}>
                        <SmoothImage src={room.avatar || ""} alt={room.nickname} className={styles.avatarImg} />
                      </div>
                      <div className={styles.textDetails}>
                        <h3 className={styles.streamerName} title={room.nickname}>
                          {room.nickname || "主播"}
                        </h3>
                        <p className={styles.streamTitle} title={room.title}>
                          {room.title}
                        </p>
                      </div>
                    </div>
                </Card>
              </div>
            ))}
          </m.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
