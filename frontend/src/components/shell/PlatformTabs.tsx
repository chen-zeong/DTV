import { LayoutGrid } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { PLATFORM_LABEL, PLATFORM_TAB_ORDER, type PlatformTab } from "@/api";
import { cn } from "@/lib/cn";
import styles from "./PlatformTabs.module.css";

const TAB_PATH: Record<PlatformTab, string> = {
  douyu: "/",
  huya: "/huya",
  douyin: "/douyin",
  bilibili: "/bilibili",
  custom: "/custom",
};

interface PlatformTabsProps {
  /** 是否显示"自定义分区"tab */
  hasCustomCategories: boolean;
}

/**
 * 平台切换胶囊。
 *
 * 旧版用 framer-motion 的 `m.div` + getBoundingClientRect 手算高亮块位置
 * （useLayoutEffect + resize 监听 + spring）。这里用同等的视觉，但高亮元素
 * 只依赖 index 计算，避免读 DOM：每个 tab 宽度由内容决定，改用 CSS
 * `grid` 等宽布局，高亮块用 transform: translateX(index * 100%) —— 没有测量，
 * 也就不会在字体加载/缩放后错位。
 */
export function PlatformTabs({ hasCustomCategories }: PlatformTabsProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const tabs: PlatformTab[] = hasCustomCategories
    ? ["custom", ...PLATFORM_TAB_ORDER]
    : PLATFORM_TAB_ORDER;

  const active: PlatformTab =
    pathname.startsWith("/custom")
      ? "custom"
      : pathname.startsWith("/huya")
        ? "huya"
        : pathname.startsWith("/douyin")
          ? "douyin"
          : pathname.startsWith("/bilibili")
            ? "bilibili"
            : "douyu";

  const activeIndex = Math.max(0, tabs.indexOf(active));

  return (
    <div className={cn(styles.tabs, styles.drag)}>
      <span
        className={styles.highlight}
        style={{
          width: `calc((100% - 8px) / ${tabs.length})`,
          transform: `translateX(calc(${activeIndex} * 100%))`,
        }}
        aria-hidden="true"
      />
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          className={cn(styles.tab, styles.noDrag, tab === active && styles.tabActive)}
          onClick={() => navigate(TAB_PATH[tab])}
          aria-current={tab === active ? "page" : undefined}
        >
          {tab === "custom" ? <LayoutGrid size={16} strokeWidth={2.2} /> : PLATFORM_LABEL[tab]}
        </button>
      ))}
    </div>
  );
}
