import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import styles from "./CustomHomePage.module.css";
import { useCustomCategories } from "@/state/CustomCategoriesProvider";

/**
 * 自定义分区页。
 *
 * 旧项目这块是完整功能（分组 + 主播 + 拖拽排序），并且首屏有一个
 * "sessionStorage 魔法键 + effect 里 router.replace 到 /custom" 的隐式跳转，
 * 很难维护。骨架阶段先实现"分组增删"，跳转逻辑改成显式：
 * 有自定义分区时，平台 tab 里会多出「自定义」入口（由 Navbar 渲染）。
 */
export function CustomHomePage() {
  const { entries, addCategory, removeCategory } = useCustomCategories();
  const [draft, setDraft] = useState("");

  const submit = () => {
    addCategory(draft);
    setDraft("");
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>自定义分区</h1>
          <p className={styles.subtitle}>把喜欢的直播归类到一起，不受平台分区限制</p>
        </div>
        <form
          className={styles.addForm}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            className={styles.input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="例如：深夜助眠、FPS 集锦"
            aria-label="新分区名称"
          />
          <button type="submit" className={styles.addBtn} disabled={!draft.trim()}>
            <Plus size={16} strokeWidth={2.4} />
            添加分区
          </button>
        </form>
      </header>

      {entries.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>还没有自定义分区</p>
          <p className={styles.emptyHint}>在上面输入一个名字即可创建第一个分区</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {entries.map((entry) => (
            <div key={entry.id} className={styles.card}>
              <span className={styles.icon}>{entry.icon}</span>
              <span className={styles.name}>{entry.name}</span>
              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => removeCategory(entry.id)}
                aria-label={`删除分区 ${entry.name}`}
              >
                <Trash2 size={14} strokeWidth={2.2} />
              </button>
              <p className={styles.cardHint}>主播添加功能将在接入后端后开放</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
