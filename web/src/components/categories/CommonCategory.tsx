"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import styles from "./CommonCategory.module.css";
import type { Category1, Category2, CategorySelectedEvent } from "@/platforms/common/categoryTypes";

const CARD_ACTUAL_HEIGHT = 36;
const GRID_VERTICAL_GAP = 12;
const CONTENT_PADDING_BOTTOM = 6;
const GRID_INTERNAL_PADDING_BOTTOM = 12;

const TARGET_ONE_ROW = CARD_ACTUAL_HEIGHT + GRID_INTERNAL_PADDING_BOTTOM + CONTENT_PADDING_BOTTOM;
const TARGET_TWO_ROWS = 2 * CARD_ACTUAL_HEIGHT + GRID_VERTICAL_GAP + GRID_INTERNAL_PADDING_BOTTOM + CONTENT_PADDING_BOTTOM - 14;
const EXPANDED_MAX_ROWS = 7;
const TARGET_EXPANDED_MAX_ROWS =
  EXPANDED_MAX_ROWS * CARD_ACTUAL_HEIGHT + (EXPANDED_MAX_ROWS - 1) * GRID_VERTICAL_GAP + GRID_INTERNAL_PADDING_BOTTOM + CONTENT_PADDING_BOTTOM;

function computeTargetHeight(natural: number, expanded: boolean, hasMoreRows: boolean) {
  if (expanded) {
    return hasMoreRows ? TARGET_EXPANDED_MAX_ROWS : Math.max(natural, GRID_INTERNAL_PADDING_BOTTOM + CONTENT_PADDING_BOTTOM);
  }
  if (natural <= TARGET_ONE_ROW) return natural;
  return TARGET_TWO_ROWS;
}

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
  const [heightTransitionEnabled, setHeightTransitionEnabled] = useState(false);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const [naturalHeight, setNaturalHeight] = useState(0);
  const [hasMoreRows, setHasMoreRows] = useState(false);

  useEffect(() => {
    setCate1List(Array.isArray(categoriesData) ? categoriesData : []);
    // 平台切换 / 数据刷新时，默认保持折叠（避免加载后先展开再折叠的闪烁）
    setExpanded(false);
    setHeightTransitionEnabled(false);
  }, [categoriesData]);

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

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    const update = () => {
      const scrollH = el.scrollHeight || GRID_INTERNAL_PADDING_BOTTOM;
      const required = scrollH + CONTENT_PADDING_BOTTOM;
      setNaturalHeight(required);
      setHasMoreRows(required > TARGET_EXPANDED_MAX_ROWS);
    };

    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, [currentCate2List.length]);

  const showExpandButton = naturalHeight > TARGET_TWO_ROWS;
  const targetHeight = computeTargetHeight(naturalHeight, expanded, hasMoreRows);

  return (
    <div className={`${styles.categoryList} ${expanded ? styles.categoryListExpanded : ""}`}>
      {cate1List.length > 0 ? (
        <>
          <div className={styles.cate1ListContainer}>
            <ul className={styles.cate1List}>
              {cate1List.map((c1) => {
                const selected = c1.href === selectedCate1Href;
                return (
                  <li
                    key={c1.href}
                    className={`${styles.cate1Item} ${selected ? styles.cate1ItemSelected : ""}`}
                    onClick={() => {
                      if (selectedCate1Href === c1.href) return;
                      setHeightTransitionEnabled(false);
                      setSelectedCate1Href(c1.href);
                      setSelectedCate2Href(null);
                      if (expanded) setExpanded(false);
                    }}
                  >
                    {c1.title}
                  </li>
                );
              })}
            </ul>
            <div className={styles.cate1Actions}>{actions}</div>
          </div>

          {currentCate2List.length > 0 ? (
            <div className={styles.cate2Container}>
              <div
                className={`${styles.cate2Content} ${heightTransitionEnabled ? styles.cate2ContentAnimated : ""}`}
                style={{ height: targetHeight }}
              >
                <div className={`${styles.cate2ScrollWrapper} ${expanded && hasMoreRows ? styles.cate2ScrollWrapperAllow : ""}`}>
                  <div className={styles.cate2Grid} ref={gridRef}>
                    {currentCate2List.map((c2) => {
                      const active = c2.href === selectedCate2Href;
                      return (
                        <button
                          key={c2.href}
                          type="button"
                          className={`${styles.cate2Card} ${active ? styles.cate2CardActive : ""}`}
                          aria-pressed={active}
                          onClick={() => {
                            emitCate2(c2);
                            if (expanded) setExpanded(false);
                          }}
                          aria-label={c2.title}
                        >
                          <div className={styles.cate2Name} title={c2.title}>
                            {c2.title}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {showExpandButton ? (
                <div
                  className={styles.expandButton}
                  onClick={() => {
                    setHeightTransitionEnabled(true);
                    setExpanded((v) => !v);
                  }}
                >
                  <span>{expanded ? "收起" : "展开"}</span>
                  <svg
                    className={`${styles.expandIcon} ${expanded ? styles.expandIconExpanded : ""}`}
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                  >
                    <path d="M6 9l6 6 6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              ) : null}
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
