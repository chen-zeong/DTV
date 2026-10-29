import type { CategoryGroup } from "@/api";
import { cn } from "@/lib/cn";
import styles from "./CategoryBar.module.css";

interface CategoryBarProps {
  groups: CategoryGroup[];
  activeId: string;
  onSelect: (id: string) => void;
}

/**
 * 分区选择条。
 *
 * 旧版的 CommonCategory（437 行 CSS）实现了"一级分区横滑 + 二级分区展开 + 悬浮高亮"，
 * 逻辑与样式耦合很重且难以维护。这里改成一层结构：分组标题 + chip 横滑，
 * 选中态用 accent 描边，滚动区用 `scrollbar-width: none` 隐藏滚动条。
 */
export function CategoryBar({ groups, activeId, onSelect }: CategoryBarProps) {
  return (
    <div className={styles.root}>
      {groups.map((group) => (
        <div key={group.id} className={styles.group}>
          <span className={styles.groupLabel}>{group.name}</span>
          <div className={styles.chips}>
            {group.categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={cn(styles.chip, cat.id === activeId && styles.chipActive)}
                onClick={() => onSelect(cat.id)}
                aria-pressed={cat.id === activeId}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
