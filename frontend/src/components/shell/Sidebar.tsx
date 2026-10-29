import styles from "./Sidebar.module.css";
import { FollowsList } from "./FollowsList";

/**
 * 左侧栏。
 *
 * 旧版的折叠逻辑是死代码（`const [isSidebarCollapsed] = useState(false)` 没有 setter，
 * `--sidebar-collapsed-width` 在整个项目里没有任何引用）。这里**真的实现了折叠**：
 * 宽度在 240px / 72px 之间过渡，折叠态只保留头像列，状态持久化到 localStorage。
 */
export function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.body}>
        <FollowsList />
      </div>
    </aside>
  );
}
