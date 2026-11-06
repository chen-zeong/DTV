import { Card, ListBox } from "@heroui/react";
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, PLATFORM_LABEL, type LivePlatform, type SearchHit } from "@/api";
import { SmoothImage } from "@/components/common/SmoothImage";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import { useOpenPlayer } from "@/lib/navigation";
import styles from "./SearchBox.module.css";

const PLACEHOLDER: Record<LivePlatform, string> = {
  douyu: "搜索关键词或直播间号…",
  huya: "搜索关键词或直播间号…",
  douyin: "输入抖音直播间号…",
  bilibili: "搜索关键词或直播间号…",
};

const SEARCH_HINT: Record<LivePlatform, string> = {
  douyu: "支持关键词与直播间号，↑↓ 选择，Enter 打开",
  huya: "支持关键词与直播间号，↑↓ 选择，Enter 打开",
  douyin: "抖音仅支持直播间号，输入后按 Enter 进入",
  bilibili: "支持关键词与直播间号，↑↓ 选择，Enter 打开",
};

interface SearchBoxProps {
  platform: LivePlatform;
}

/**
 * 平台搜索框。
 *
 * 旧版把搜索状态（query/results/error/focused/防抖/外部点击关闭/Esc 清空）
 * 全部塞在 800 行的 Navbar 里，还靠 `eslint-disable exhaustive-deps` 兜底。
 * 这里独立成组件 + 一个 `useDebouncedSearch` 小 hook，状态机清晰。
 *
 * U-04：↑/↓ 在结果间移动、Enter 打开当前项、Esc 关闭；Ctrl/Cmd+K 聚焦。
 */
export function SearchBox({ platform }: SearchBoxProps) {
  const openRoomNavigation = useOpenPlayer();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listWrapRef = useRef<HTMLDivElement>(null);
  const [hoverBox, setHoverBox] = useState({ top: 0, height: 0, visible: false });

  const showHover = useCallback((el: HTMLElement) => {
    const root = listWrapRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const itemRect = el.getBoundingClientRect();
    setHoverBox({
      top: itemRect.top - rootRect.top + root.scrollTop,
      height: itemRect.height,
      visible: true,
    });
  }, []);

  const hideHover = useCallback(() => {
    setHoverBox((prev) => (prev.visible ? { ...prev, visible: false } : prev));
  }, []);

  // 防抖搜索（用 cancelled 标记丢弃过期响应）
  useEffect(() => {
    const kw = query.trim();
    setActiveIndex(-1);
    if (!kw) {
      setHits([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      api
        .search(platform, kw)
        .then((result) => {
          if (cancelled) return;
          setHits(result);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : "搜索失败");
          setLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, platform]);

  // 切换平台时清空
  useEffect(() => {
    setQuery("");
    setHits([]);
    hideHover();
  }, [platform, hideHover]);

  useEffect(() => {
    hideHover();
  }, [query, hits, hideHover]);

  // 点击外部关闭结果
  useEffect(() => {
    if (!focused) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [focused]);

  // Ctrl/Cmd+K 聚焦搜索
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openRoom = useCallback(
    (roomId: string) => {
      setFocused(false);
      setQuery("");
      // 进入直播间后把焦点还给页面：否则焦点留在搜索框里，
      // 播放页的空格 / Esc / F 等快捷键会因为“正在输入”而被忽略。
      inputRef.current?.blur();
      // 从播放页搜索另一个房间时同样 replace：不把旧直播间留在历史栈里。
      openRoomNavigation(platform, roomId);
    },
    [openRoomNavigation, platform],
  );

  const onSubmit = () => {
    const kw = query.trim();
    if (!kw) return;
    if (activeIndex >= 0 && hits[activeIndex]) {
      openRoom(hits[activeIndex].id);
      return;
    }
    if (/^\d+$/.test(kw)) openRoom(kw);
  };

  const moveActive = (delta: number) => {
    if (hits.length === 0) return;
    setActiveIndex((prev) => {
      const next = prev + delta;
      if (next < 0) return hits.length - 1;
      if (next >= hits.length) return 0;
      return next;
    });
  };

  useEffect(() => {
    if (activeIndex < 0) return;
    const el = listWrapRef.current?.querySelector<HTMLElement>(
      `[data-search-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const showPanel = focused && query.trim().length > 0;

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={cn(styles.shell, focused && styles.shellFocused)}>
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              moveActive(1);
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              moveActive(-1);
            }
            if (e.key === "Escape") {
              setQuery("");
              setFocused(false);
              inputRef.current?.blur();
            }
          }}
          placeholder={PLACEHOLDER[platform]}
          aria-label={PLACEHOLDER[platform]}
          title={SEARCH_HINT[platform]}
          spellCheck={false}
        />
        {query && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => setQuery("")}
            aria-label="清空搜索"
          >
            <X size={15} strokeWidth={2.4} />
          </button>
        )}
        {loading ? (
          <span className={styles.spinnerWrap}>
            <Spinner size={14} />
          </span>
        ) : (
          <button type="button" className={styles.iconBtn} onClick={onSubmit} aria-label="搜索">
            <Search size={17} strokeWidth={2.4} />
          </button>
        )}
      </div>

      {showPanel && (
        <Card className={styles.panel} onMouseLeave={hideHover}>
          <div className={styles.panelHead}>
            <span className={styles.panelTitle}>搜索结果</span>
            <span className={styles.panelCount}>
              {loading ? "搜索中" : `${hits.length} 条`}
            </span>
          </div>

          {error ? (
            <p className={styles.meta}>{error}</p>
          ) : !loading && hits.length === 0 ? (
            <p className={styles.meta}>
              {platform === "douyin"
                ? "未找到该直播间，请检查直播间号"
                : "未找到结果，试试直接输入房间号"}
            </p>
          ) : (
            <div
              className={styles.listWrap}
              ref={listWrapRef}
              onScroll={hideHover}
              onMouseLeave={hideHover}
            >
              <div
                className={styles.hoverLayer}
                style={{
                  opacity: hoverBox.visible ? 1 : 0,
                  transform: `translate3d(0, ${hoverBox.top}px, 0)`,
                  height: hoverBox.height,
                }}
                aria-hidden="true"
              />
              <ListBox
                className={styles.list}
                aria-label="搜索结果"
                selectionMode="none"
                onAction={(key) => openRoom(String(key))}
              >
                {hits.map((hit, index) => (
                  <ListBox.Item
                    key={hit.id}
                    id={hit.id}
                    textValue={`${hit.nickname} ${hit.title}`}
                    className={cn(styles.item, activeIndex === index && styles.itemActive)}
                    data-search-index={index}
                    onMouseEnter={(event) => {
                      showHover(event.currentTarget);
                      setActiveIndex(index);
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <span className={styles.avatar}>
                      <SmoothImage src={hit.avatar} alt={hit.nickname} rounded />
                    </span>
                    <span className={styles.itemMain}>
                      <span className={styles.itemName}>{hit.nickname}</span>
                      <span className={styles.itemTitle}>{hit.title}</span>
                    </span>
                    <span className={cn(styles.dot, hit.isLive && styles.dotLive)} />
                  </ListBox.Item>
                ))}
              </ListBox>
            </div>
          )}

          <p className={styles.hint}>
            {PLATFORM_LABEL[platform]} · {SEARCH_HINT[platform]}
          </p>
        </Card>
      )}
    </div>
  );
}
