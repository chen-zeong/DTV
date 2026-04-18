"use client";

import React, { useEffect, useMemo, useState } from "react";
import { m } from "framer-motion";

import styles from "./CustomHomePage.module.css";
import { CommonStreamerList } from "@/components/streamers/CommonStreamerList";
import { useCustomCategories, type CustomCategoryEntry } from "@/state/customCategories/CustomCategoriesProvider";
import { douyinCategoriesData } from "@/platforms/douyin/douyinCategoriesData";
import { huyaCategoriesData } from "@/platforms/huya/huyaCategoriesData";
import { biliCategoriesData } from "@/platforms/bilibili/biliCategoriesData";
import type { CategorySelectedEvent } from "@/platforms/common/categoryTypes";

function platformLabel(p: string) {
  if (p === "douyu") return "斗鱼";
  if (p === "douyin") return "抖音";
  if (p === "huya") return "虎牙";
  if (p === "bilibili") return "Bilibili";
  return p;
}

export function CustomHomePage() {
  const { entries } = useCustomCategories();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.sessionStorage.getItem("dtv_custom_selected_key_v1");
      if (saved) setSelectedKey(saved);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!entries.length) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !entries.some((e) => e.key === selectedKey)) {
      setSelectedKey(entries[0].key);
    }
  }, [entries, selectedKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedKey) return;
    try {
      window.sessionStorage.setItem("dtv_custom_selected_key_v1", selectedKey);
    } catch {
      // ignore
    }
  }, [selectedKey]);

  const selectedEntry: CustomCategoryEntry | null = useMemo(() => {
    return entries.find((e) => e.key === selectedKey) ?? null;
  }, [entries, selectedKey]);

  const selectedPlatform = selectedEntry?.platform ?? "douyu";

  const selectedCategoriesData = useMemo(() => {
    if (selectedPlatform === "douyin") return douyinCategoriesData as any;
    if (selectedPlatform === "huya") return huyaCategoriesData as any;
    if (selectedPlatform === "bilibili") return biliCategoriesData as any;
    return undefined;
  }, [selectedPlatform]);

  const selectedCategory: CategorySelectedEvent | null = useMemo(() => {
    if (!selectedEntry || selectedEntry.platform === "douyu") return null;
    return {
      type: "cate2",
      cate1Href: selectedEntry.cate1Href || "",
      cate2Href: selectedEntry.cate2Href || "",
      cate1Name: selectedEntry.cate1Name || "",
      cate2Name: selectedEntry.cate2Name
    };
  }, [selectedEntry]);

  const selectedDouyuCategory = useMemo(() => {
    if (!selectedEntry || selectedEntry.platform !== "douyu") return null;
    return { type: "cate2" as const, id: selectedEntry.douyuId || "", name: selectedEntry.cate2Name };
  }, [selectedEntry]);

  return (
    <div className={styles.customHome}>
      {!entries.length ? <div className={styles.emptyTip}>暂无收藏分区，去分类页订阅后会出现在这里。</div> : null}

      {entries.length ? (
        <div className={styles.list}>
          {entries.map((entry) => {
            const active = entry.key === selectedKey;
            const platformClass =
              entry.platform === "douyu"
                ? styles.platformDouyu
                : entry.platform === "douyin"
                  ? styles.platformDouyin
                  : entry.platform === "huya"
                    ? styles.platformHuya
                    : styles.platformBilibili;

            return (
              <m.button
                key={entry.key}
                type="button"
                className={`${styles.chip} ${platformClass} ${active ? styles.chipActive : ""}`}
                whileTap={{ scale: 0.98 }}
                onClick={() => setSelectedKey(entry.key)}
              >
                <span className={styles.chipPlatform}>{platformLabel(entry.platform)}</span>
                <span className={styles.chipName}>{entry.cate2Name}</span>
              </m.button>
            );
          })}
        </div>
      ) : null}

      <div className={styles.streamerList}>
        {selectedEntry ? (
          <CommonStreamerList
            selectedCategory={selectedCategory}
            categoriesData={selectedCategoriesData}
            douyuCategory={selectedDouyuCategory}
            platformName={selectedPlatform}
            defaultPageSize={selectedPlatform === "huya" ? 120 : undefined}
          />
        ) : null}
      </div>
    </div>
  );
}
