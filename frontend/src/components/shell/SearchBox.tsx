import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, PLATFORM_LABEL, type LivePlatform, type SearchHit } from "@/api";
import { SmoothImage } from "@/components/common/SmoothImage";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import styles from "./SearchBox.module.css";

const PLACEHOLDER: Record<LivePlatform, string> = {
  douyu: "搜索斗鱼主播/房间…",
  huya: "搜索虎牙主播/房间…",
  douyin: "搜索抖音直播间…",
  bilibili: "搜索B站直播间…",
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
 */
export function SearchBox({ platform }: SearchBoxProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 防抖搜索
  useEffect(() => {
    const kw = query.trim();
    if (!kw) {
      setHits([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      api
        .search(platform, kw)
        .then((result) => {
          setHits(result);
          setLoading(false);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "搜索失败");
          setLoading(false);
        });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, platform]);

  // 切换平台时清空
  useEffect(() => {
    setQuery("");
    setHits([]);
  }, [platform]);

  // 点击外部关闭结果
  useEffect(() => {
    if (!focused) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [focused]);

  const openRoom = (roomId: string) => {
    setFocused(false);
    setQuery("");
    navigate(`/player?platform=${platform}&roomId=${roomId}`);
  };

  const onSubmit = () => {
    const kw = query.trim();
    if (!kw) return;
    if (/^\d+$/.test(kw)) openRoom(kw);
  };

  const showPanel = focused && query.trim().length > 0;

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={cn(styles.shell, focused && styles.shellFocused)}>
        <input
          className={styles.input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit();
            if (e.key === "Escape") {
              setQuery("");
              setFocused(false);
            }
          }}
          placeholder={PLACEHOLDER[platform]}
          aria-label={PLACEHOLDER[platform]}
          spellCheck={false}
        />
        {query && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => setQuery("")}
            aria-label="清空搜索"
          >
            <X size={14} strokeWidth={2.4} />
          </button>
        )}
        {loading ? (
          <span className={styles.spinnerWrap}>
            <Spinner size={14} />
          </span>
        ) : (
          <button type="button" className={styles.iconBtn} onClick={onSubmit} aria-label="搜索">
            <Search size={15} strokeWidth={2.4} />
          </button>
        )}
      </div>

      {showPanel && (
        <div className={styles.panel}>
          {error ? (
            <p className={styles.meta}>{error}</p>
          ) : !loading && hits.length === 0 ? (
            <p className={styles.meta}>未找到结果，试试直接输入房间号</p>
          ) : (
            <ul className={styles.list}>
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    className={styles.item}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => openRoom(hit.id)}
                  >
                    <span className={styles.avatar}>
                      <SmoothImage src={hit.avatar} alt={hit.nickname} rounded />
                    </span>
                    <span className={styles.itemMain}>
                      <span className={styles.itemName}>{hit.nickname}</span>
                      <span className={styles.itemTitle}>{hit.title}</span>
                    </span>
                    <span className={cn(styles.dot, hit.isLive && styles.dotLive)} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.hint}>共在{PLATFORM_LABEL[platform]}搜索</p>
        </div>
      )}
    </div>
  );
}
