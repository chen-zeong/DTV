import { Check, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import type { Category, CategoryGroup } from "@/api";
import { cn } from "@/lib/cn";
import styles from "./CategoryBar.module.css";

interface CategoryBarProps {
  groups: CategoryGroup[];
  /** 当前一级分区 id */
  activeGroupId: string;
  /** 当前二级分区 id */
  activeCategoryId: string;
  onSelectGroup: (id: string) => void;
  onSelectCategory: (category: Category) => void;
  /** 三级分区（目前只有斗鱼有）；为空则不渲染第三行 */
  subCategories?: Category[];
  /** 三级分区 id；null 表示"全部"（即二级分区维度） */
  activeSubCategoryId?: string | null;
  onSelectSubCategory?: (id: string | null) => void;
  /** 订阅当前二级分区（入口与二级分区同一行，不额外占用竖向空间） */
  canSubscribe?: boolean;
  subscribed?: boolean;
  onToggleSubscribe?: () => void;
  /** 列表滚动时收成一行，给内容让出高度 */
  compact?: boolean;
}

/**
 * 分区选择栏。
 *
 * 旧项目（CommonCategory）的排布是：一级分区一行横滑 + 二级分区一行 9 格 + 更多
 * 走浮层。新的骨架版曾经把**每个一级分组**都各占一行、行内横滑，竖向空间被吃掉
 * 一大截（抖音 8 组就是 8 行）。现在回到两级结构，并省掉一半竖向空间：
 *
 *   第一行  一级分区（文字 tab + 下划线指示器）
 *   第二行  二级分区（chip 横滑；放不下时出现「全部分区」）＋ 右侧订阅按钮
 *   第三行  三级分区（仅当平台提供时出现，例如斗鱼的"赛事直播"）
 *
 * 订阅入口在主播列表页，不在播放器页面；按钮与二级分区同一行，
 * 不额外占用一行高度。
 */
export function CategoryBar({
  groups,
  activeGroupId,
  activeCategoryId,
  onSelectGroup,
  onSelectCategory,
  subCategories = [],
  activeSubCategoryId = null,
  onSelectSubCategory,
  canSubscribe = false,
  subscribed = false,
  onToggleSubscribe,
  compact = false,
}: CategoryBarProps) {
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0];
  const categories = activeGroup?.categories ?? [];

  const [chipsEl, setChipsEl] = useState<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [forceOpen, setForceOpen] = useState(false);

  /* 滚动回顶部时收起"强制展开" */
  useEffect(() => {
    if (!compact) setForceOpen(false);
  }, [compact]);

  /* 二级分区是否溢出：用真实 DOM 节点作为依赖。
   * 滚动收成一行再展开时组件没有卸载，但 chipScroll 节点会重建；
   * 用 callback ref + state 保证每次挂载都重新测量，避免「全部」按钮偶发消失。 */
  useLayoutEffect(() => {
    if (!chipsEl) {
      setOverflow((prev) => (prev ? false : prev));
      return;
    }
    const check = () => setOverflow(chipsEl.scrollWidth - chipsEl.clientWidth > 2);
    check();
    const raf = window.requestAnimationFrame(check);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(check);
      observer.observe(chipsEl);
    }
    const onResize = () => check();
    window.addEventListener("resize", onResize);
    // 字体加载完成后宽度可能变化，再量一次
    void document.fonts?.ready.then(check).catch(() => undefined);
    return () => {
      window.cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [chipsEl, categories.length, activeGroupId]);

  /* 换一级分区时收起浮层 */
  useEffect(() => setPanelOpen(false), [activeGroupId]);

  /* Esc / 点击外部关闭浮层 */
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]);

  const pickCategory = useCallback(
    (category: Category) => {
      onSelectCategory(category);
      setPanelOpen(false);
      // 紧凑模式里点完分区后回到一行高度
      setForceOpen(false);
    },
    [onSelectCategory],
  );

  if (groups.length === 0) return null;

  const tertiaryRow =
    subCategories.length > 0 && onSelectSubCategory ? (
      <div className={styles.tertiaryRow}>
        <div className={styles.chipScroll}>
          <button
            type="button"
            className={cn(styles.subChip, activeSubCategoryId === null && styles.subChipActive)}
            onClick={() => onSelectSubCategory(null)}
          >
            全部
          </button>
          {subCategories.map((sub) => {
            const active = sub.id === activeSubCategoryId;
            return (
              <button
                key={sub.id}
                type="button"
                className={cn(styles.subChip, active && styles.subChipActive)}
                onClick={() => onSelectSubCategory(sub.id)}
                title={sub.name}
              >
                {sub.name}
              </button>
            );
          })}
        </div>
      </div>
    ) : null;

  /* 滚动后的紧凑模式：一级/二级收成面包屑，但三级分类保持完整，方便随时切换 */
  if (compact && !forceOpen) {
    return (
      <div className={cn(styles.root, styles.rootCompact)}>
        <div className={styles.compactRow}>
          <button
            type="button"
            className={styles.compactCrumb}
            onClick={() => {
              setForceOpen(true);
              setPanelOpen(true);
            }}
            title="展开全部分区"
          >
            <span className={styles.compactGroup}>{activeGroup?.name ?? "分区"}</span>
            <ChevronRight size={12} strokeWidth={2.6} className={styles.compactSep} />
            <span className={styles.compactCategory}>
              {categories.find((c) => c.id === activeCategoryId)?.name ?? "全部"}
            </span>
            <ChevronDown size={13} strokeWidth={2.6} />
          </button>
          <button
            type="button"
            className={styles.compactExpand}
            onClick={() => setForceOpen(true)}
          >
            全部分区
          </button>
        </div>
        {tertiaryRow}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {/* ------------------------------------------------------ 一级分区 */}
      <div className={styles.primaryRow}>
        <div className={styles.groupScroll}>
          {groups.map((group) => {
            const active = group.id === activeGroup?.id;
            return (
              <button
                key={group.id}
                type="button"
                className={cn(styles.groupTab, active && styles.groupTabActive)}
                onClick={() => onSelectGroup(group.id)}
                aria-pressed={active}
              >
                {group.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------------ 二级分区 */}
      <div className={styles.secondaryRow}>
        <div className={styles.chipScroll} ref={setChipsEl}>
          {categories.map((category) => {
            const active = category.id === activeCategoryId;
            return (
              <button
                key={category.id}
                type="button"
                className={cn(styles.chip, active && styles.chipActive)}
                onClick={() => pickCategory(category)}
                aria-pressed={active}
                title={category.name}
              >
                {category.name}
              </button>
            );
          })}
        </div>

        {overflow && (
          <button
            type="button"
            className={cn(styles.moreBtn, panelOpen && styles.moreBtnOpen)}
            onClick={() => setPanelOpen((v) => !v)}
            aria-expanded={panelOpen}
            title="展开该分组的全部分区"
          >
            全部
            <ChevronDown size={12} strokeWidth={2.6} className={styles.moreCaret} />
          </button>
        )}

        {onToggleSubscribe && (
          <button
            type="button"
            className={cn(styles.subscribeBtn, subscribed && styles.subscribeBtnOn)}
            onClick={onToggleSubscribe}
            disabled={!canSubscribe}
            aria-pressed={subscribed}
            title={subscribed ? "取消订阅该分区" : "订阅该分区，之后可在「订阅」里直接进入"}
          >
            {subscribed ? (
              <Check size={13} strokeWidth={2.6} />
            ) : (
              <Plus size={13} strokeWidth={2.6} />
            )}
            <span>{subscribed ? "已订阅" : "订阅分区"}</span>
          </button>
        )}

        {panelOpen && (
          <>
            <div className={styles.panelBackdrop} onClick={() => setPanelOpen(false)} />
            <div className={styles.panel}>
              <div className={styles.panelHead}>
                <span className={styles.panelTitle}>{activeGroup?.name}</span>
                <span className={styles.panelCount}>{categories.length} 个分区</span>
              </div>
              <div className={styles.panelGrid}>
                {categories.map((category) => {
                  const active = category.id === activeCategoryId;
                  return (
                    <button
                      key={category.id}
                      type="button"
                      className={cn(styles.panelItem, active && styles.panelItemActive)}
                      onClick={() => pickCategory(category)}
                    >
                      {category.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ------------------------------------------------------ 三级分区 */}
      {tertiaryRow}
    </div>
  );
}
