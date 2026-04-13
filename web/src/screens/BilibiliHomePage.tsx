"use client";

import React, { useMemo, useState } from "react";

import { CommonCategory } from "@/components/categories/CommonCategory";
import { CommonStreamerList } from "@/components/streamers/CommonStreamerList";
import { biliCategoriesData } from "@/platforms/bilibili/biliCategoriesData";
import type { CategorySelectedEvent } from "@/platforms/common/categoryTypes";
import { useCustomCategories } from "@/state/customCategories/CustomCategoriesProvider";

export function BilibiliHomePage() {
  const [selected, setSelected] = useState<CategorySelectedEvent | null>(null);
  const custom = useCustomCategories();

  const canSubscribe = !!selected?.cate2Href;
  const isSubscribed = useMemo(() => {
    const href = selected?.cate2Href;
    return !!href && custom.isSubscribed("bilibili", href);
  }, [custom, selected?.cate2Href]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "transparent" }}>
      <div style={{ flexShrink: 0, background: "transparent", zIndex: 10 }}>
        <CommonCategory
          categoriesData={biliCategoriesData as any}
          onCategorySelected={(e) => setSelected(e)}
          actions={
            <button
              type="button"
              className="category-subscribe-btn"
              disabled={!canSubscribe}
              onClick={() => {
                if (!selected?.cate2Href) return;
                const href = selected.cate2Href;
                if (custom.isSubscribed("bilibili", href)) custom.removeByKey(`bilibili:${href}`);
                else custom.addCommonCate2("bilibili", href, selected.cate2Name, selected.cate1Name, selected.cate1Href);
              }}
            >
              {isSubscribed ? "取消订阅" : "订阅分区"}
            </button>
          }
        />
      </div>
      <div style={{ flex: 1, overflow: "hidden", background: "transparent" }}>
        <CommonStreamerList selectedCategory={selected} categoriesData={biliCategoriesData as any} platformName="bilibili" />
      </div>
    </div>
  );
}
