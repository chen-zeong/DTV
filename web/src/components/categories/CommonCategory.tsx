"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { AnimatePresence, m } from "framer-motion";

import styles from "./CommonCategory.module.css";
import type { Category1, Category2, CategorySelectedEvent } from "@/platforms/common/categoryTypes";

export function CommonCategory({
  categoriesData,
  onCategorySelected,
  actions
}: {
  categoriesData: Category1[];
  onCategorySelected: (event: CategorySelectedEvent) => void;
  actions?: React.ReactNode;
}) {
  const [cate1List, setCate1List] = useState<Category1[]>([]);
  const [selectedCate1Href, setSelectedCate1Href] = useState<string | null>(null);
  const [selectedCate2Href, setSelectedCate2Href] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const cate2ShellRef = useRef<HTMLDivElement | null>(null);
  const [overlayMaxHeight, setOverlayMaxHeight] = useState<number | null>(null);

  useEffect(() => {
    setCate1List(Array.isArray(categoriesData) ? categoriesData : []);
    setExpanded(false);
  }, [categoriesData]);

  useLayoutEffect(() => {
    if (!expanded) {
      setOverlayMaxHeight(null);
      return;
    }

    const update = () => {
      const anchor = cate2ShellRef.current;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const top = r.bottom + 8; // align with .cate2Overlay margin-top
      const viewportH = window.innerHeight || 0;
      const maxH = Math.max(180, viewportH - top - 16);
      setOverlayMaxHeight(Number.isFinite(maxH) ? maxH : null);
    };

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", onScroll, true);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [expanded]);

  const currentCate2List = useMemo(() => {
    if (!selectedCate1Href) return [];
    const selected = cate1List.find((c1) => c1.href === selectedCate1Href);
    return selected?.subcategories ?? [];
  }, [cate1List, selectedCate1Href]);

  const emitCate2 = (cate2: Category2) => {
    setSelectedCate2Href(cate2.href);
    const selectedCate1 = cate1List.find((c1) => c1.href === selectedCate1Href);
    if (!selectedCate1) return;
    onCategorySelected({
      type: "cate2",
      cate1Href: selectedCate1.href,
      cate2Href: cate2.href,
      cate1Name: selectedCate1.title,
      cate2Name: cate2.title
    });
  };

  useEffect(() => {
    if (cate1List.length === 0) return;
    if (!selectedCate1Href) {
      setSelectedCate1Href(cate1List[0].href);
      return;
    }
    if (!cate1List.some((x) => x.href === selectedCate1Href)) {
      setSelectedCate1Href(cate1List[0].href);
    }
  }, [cate1List, selectedCate1Href]);

  useEffect(() => {
    if (!selectedCate1Href) return;
    if (currentCate2List.length === 0) return;
    if (!selectedCate2Href || !currentCate2List.some((x) => x.href === selectedCate2Href)) {
      emitCate2(currentCate2List[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCate2List, selectedCate1Href]);

  return (
    <div className={`${styles.categoryList} ${expanded ? styles.categoryListExpanded : ""}`}>
      {cate1List.length > 0 ? (
        <>
          <div className={styles.cate1ListContainer}>
            <div className={styles.cate1Row}>
              <ul className={styles.cate1List}>
                {cate1List.map((c1) => {
                  const selected = c1.href === selectedCate1Href;
                  return (
                    <li
                      key={c1.href}
                      className={`${styles.cate1Item} ${selected ? styles.cate1ItemSelected : ""}`}
                      onClick={() => {
                        if (selectedCate1Href === c1.href) return;
                        setSelectedCate1Href(c1.href);
                        setSelectedCate2Href(null);
                        setExpanded(false);
                      }}
                    >
                      {c1.title}
                    </li>
                  );
                })}
              </ul>
              <div className={styles.cate1Actions}>{actions}</div>
            </div>
          </div>

          {currentCate2List.length > 0 ? (
            <div className={styles.cate2Container}>
              <div className={styles.cate2Shell} ref={cate2ShellRef}>
                <div className={styles.cate2Grid}>
                  {currentCate2List.slice(0, 9).map((c2) => {
                    const active = c2.href === selectedCate2Href;
                    return (
                      <button
                        key={c2.href}
                        type="button"
                        className={`${styles.cate2Card} ${active ? styles.cate2CardActive : ""}`}
                        aria-pressed={active}
                        onClick={() => {
                          emitCate2(c2);
                          setExpanded(false);
                        }}
                        aria-label={c2.title}
                        title={c2.title}
                      >
                        <div className={styles.cate2Name}>{c2.title}</div>
                      </button>
                    );
                  })}

                  {currentCate2List.length > 9 ? (
                    <button
                      type="button"
                      className={styles.cate2ExpandBtn}
                      onClick={() => {
                        setExpanded((v) => !v);
                      }}
                    >
                      {expanded ? (
                        <>
                          关闭 <ChevronUp size={14} />
                        </>
                      ) : (
                        <>
                          展开 <ChevronDown size={14} />
                        </>
                      )}
                    </button>
                  ) : null}
                </div>
              </div>

              <AnimatePresence>
                {currentCate2List.length > 9 && expanded ? (
                  <m.div
                    className={styles.cate2Overlay}
                    ref={overlayRef}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    style={overlayMaxHeight ? { maxHeight: overlayMaxHeight } : undefined}
                  >
                    <div className={styles.cate2OverlayHeader}>
                      <span className={styles.cate2OverlayTitle}>所有子分类</span>
                      <button type="button" className={styles.cate2OverlayClose} onClick={() => setExpanded(false)} aria-label="收起">
                        <ChevronUp size={16} />
                      </button>
                    </div>
                    <div className={styles.cate2OverlayBody}>
                      <div className={styles.cate2OverlayGrid}>
                        {currentCate2List.slice(9).map((c2) => {
                          const active = c2.href === selectedCate2Href;
                          return (
                            <button
                              key={`overlay_${c2.href}`}
                              type="button"
                              className={`${styles.cate2Card} ${active ? styles.cate2CardActive : ""}`}
                              aria-pressed={active}
                              onClick={() => {
                                emitCate2(c2);
                                setExpanded(false);
                              }}
                              aria-label={c2.title}
                              title={c2.title}
                            >
                              <div className={styles.cate2Name}>{c2.title}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </m.div>
                ) : null}
              </AnimatePresence>
            </div>
          ) : null}
        </>
      ) : (
        <div className={styles.loadingState}>
          <div className={styles.loadingText}>正在加载分类数据...</div>
        </div>
      )}
    </div>
  );
}
