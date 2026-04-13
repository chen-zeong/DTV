"use client";

import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { CommonCategory } from "@/components/categories/CommonCategory";
import { CommonStreamerList } from "@/components/streamers/CommonStreamerList";
import type { Category1 } from "@/platforms/common/categoryTypes";
import type { CategorySelectedEvent } from "@/platforms/common/categoryTypes";
import type { CommonPlatformCategory } from "@/platforms/common/types";
import { useCustomCategories } from "@/state/customCategories/CustomCategoriesProvider";

import styles from "./DouyuHomePage.module.css";

interface FrontendCate3Item {
  id: string;
  name: string;
}
interface FrontendCate2Item {
  id: string;
  name: string;
  short_name: string;
  icon: string;
  cate3List: FrontendCate3Item[];
}
interface FrontendCate1Item {
  id: string;
  name: string;
  cate2List: FrontendCate2Item[];
}
interface FrontendCategoryResponse {
  cate1List: FrontendCate1Item[];
}

async function fetchDouyuCategories(): Promise<{
  categories: Category1[];
  cate2IdMap: Record<string, string>;
}> {
  const response = (await invoke("fetch_categories")) as FrontendCategoryResponse;
  const cate1List = response?.cate1List ?? [];
  const cate2IdMap: Record<string, string> = {};
  const categories = cate1List.map((c1) => ({
    title: c1.name,
    href: c1.id,
    subcategories: (c1.cate2List ?? [])
      .filter((c2) => !!c2.short_name)
      .map((c2) => {
        cate2IdMap[c2.short_name] = c2.id;
        return { title: c2.name, href: c2.short_name };
      })
  }));
  return { categories, cate2IdMap };
}

export function DouyuHomePage() {
  const custom = useCustomCategories();
  const [categories, setCategories] = useState<Category1[]>([]);
  const [cate2IdMap, setCate2IdMap] = useState<Record<string, string>>({});
  const [cate3Map, setCate3Map] = useState<Record<string, FrontendCate3Item[]>>({});
  const [selected, setSelected] = useState<CategorySelectedEvent | null>(null);
  const [selectedCate3Id, setSelectedCate3Id] = useState<string | null>(null);
  const [selectedCate3Name, setSelectedCate3Name] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchDouyuCategories()
      .then((payload) => {
        if (!mounted) return;
        setCategories(payload.categories);
        setCate2IdMap(payload.cate2IdMap);
      })
      .catch((e) => {
        console.error("[DouyuHomePage] fetch_categories failed:", e);
        if (!mounted) return;
        setCategories([]);
        setCate2IdMap({});
        setCate3Map({});
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const canSubscribe = !!selected?.cate2Href;
  const isSubscribed = useMemo(() => {
    const id = selected?.cate2Href;
    return !!id && custom.isSubscribed("douyu", id);
  }, [custom, selected?.cate2Href]);

  useEffect(() => {
    // 切换二级分类时：默认回到“全部”（即 cate2 维度）
    setSelectedCate3Id(null);
    setSelectedCate3Name(null);
  }, [selected?.cate2Href]);

  useEffect(() => {
    const cate2ShortName = selected?.cate2Href ?? null;
    if (!cate2ShortName) return;
    if (Object.prototype.hasOwnProperty.call(cate3Map, cate2ShortName)) return;

    const cate2Id = cate2IdMap[cate2ShortName] ?? null;
    if (!cate2Id) return;
    const tagId = Number.parseInt(cate2Id, 10);
    if (!Number.isFinite(tagId)) return;

    let mounted = true;
    invoke<CommonPlatformCategory[]>("fetch_three_cate", { tagId })
      .then((list) => {
        if (!mounted) return;
        const mapped: FrontendCate3Item[] = (Array.isArray(list) ? list : []).map((x) => ({
          id: String(x.id ?? ""),
          name: String(x.name ?? "")
        }));
        setCate3Map((prev) => ({ ...prev, [cate2ShortName]: mapped.filter((x) => !!x.id && !!x.name) }));
      })
      .catch((e) => {
        console.error("[DouyuHomePage] fetch_three_cate failed:", e);
        if (!mounted) return;
        setCate3Map((prev) => ({ ...prev, [cate2ShortName]: [] }));
      });

    return () => {
      mounted = false;
    };
  }, [cate2IdMap, cate3Map, selected?.cate2Href]);

  const cate3List = useMemo(() => {
    const key = selected?.cate2Href ?? null;
    if (!key) return [];
    return cate3Map[key] ?? [];
  }, [cate3Map, selected?.cate2Href]);

  const douyuCategory = selectedCate3Id
    ? { type: "cate3" as const, id: selectedCate3Id, name: selectedCate3Name ?? undefined }
    : selected?.cate2Href
      ? { type: "cate2" as const, id: selected.cate2Href, name: selected.cate2Name }
      : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "transparent" }}>
      <div style={{ flexShrink: 0, background: "transparent", zIndex: 10 }}>
        <CommonCategory
          categoriesData={categories}
          onCategorySelected={(e) => setSelected(e)}
          actions={
            <button
              type="button"
              className="category-subscribe-btn"
              disabled={!canSubscribe || loading}
              onClick={() => {
                if (!selected?.cate2Href) return;
                const id = selected.cate2Href;
                if (custom.isSubscribed("douyu", id)) custom.removeByKey(`douyu:${id}`);
                else custom.addDouyuCate2(id, selected.cate2Name);
              }}
            >
              {isSubscribed ? "取消订阅" : "订阅分区"}
            </button>
          }
        />
        {selected?.cate2Href && cate3List.length > 0 ? (
          <div className={styles.cate3List}>
            <button
              type="button"
              className={`${styles.cate3Item} ${!selectedCate3Id ? styles.cate3ItemActive : ""}`}
              onClick={() => {
                setSelectedCate3Id(null);
                setSelectedCate3Name(null);
              }}
            >
              全部
            </button>
            {cate3List.map((c3) => {
              const active = selectedCate3Id === c3.id;
              return (
                <button
                  key={c3.id}
                  type="button"
                  className={`${styles.cate3Item} ${active ? styles.cate3ItemActive : ""}`}
                  onClick={() => {
                    setSelectedCate3Id(c3.id);
                    setSelectedCate3Name(c3.name);
                  }}
                  title={c3.name}
                >
                  {c3.name}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <div style={{ flex: 1, overflow: "hidden", background: "transparent" }}>
        <CommonStreamerList platformName="douyu" douyuCategory={douyuCategory} />
      </div>
    </div>
  );
}
