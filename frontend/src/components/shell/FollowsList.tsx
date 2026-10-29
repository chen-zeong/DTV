import { PanelLeftClose, PanelLeftOpen, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PLATFORM_LABEL, PLATFORM_TAB_ORDER } from "@/api";
import { SmoothImage } from "@/components/common/SmoothImage";
import { cn } from "@/lib/cn";
import { formatViewers } from "@/lib/format";
import { useFollow } from "@/state/FollowProvider";
import { loadJSON, saveJSON } from "@/lib/storage";
import styles from "./FollowsList.module.css";

/**
 * 关注列表（侧栏主体）。
 *
 * 旧版 935 行 CSS + 一个"全屏展开大列表"，还带拖拽排序、文件夹分组、
 * 手动锚点定位的 hover 高亮条。骨架阶段保留信息结构与视觉层级，
 * 但去掉拖拽排序与文件夹（等后端接上后再决定是否真需要）。
 */
export function FollowsList() {
  const navigate = useNavigate();
  const { byPlatform, follows } = useFollow();
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    loadJSON<boolean>("dtv_sidebar_collapsed_v1", false),
  );

  useEffect(() => {
    saveJSON("dtv_sidebar_collapsed_v1", collapsed);
  }, [collapsed]);

  const groups = useMemo(
    () =>
      PLATFORM_TAB_ORDER.map((platform) => ({
        platform,
        records: byPlatform[platform],
      })).filter((g) => g.records.length > 0),
    [byPlatform],
  );

  return (
    <div className={cn(styles.root, collapsed && styles.collapsed)}>
      <div className={cn(styles.header, styles.drag)}>
        <div className={styles.headerLeft}>
          <Users size={18} strokeWidth={2.2} className={styles.headerIcon} />
          {!collapsed && <h3 className={styles.headerTitle}>关注</h3>}
          {!collapsed && follows.length > 0 && (
            <span className={styles.count}>{follows.length}</span>
          )}
        </div>
        <button
          type="button"
          className={styles.actionBtn}
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <div className={styles.content}>
        {groups.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>还没有关注的主播</p>
            {!collapsed && (
              <p className={styles.emptyHint}>在列表页点击卡片右上角的 ☆ 即可关注</p>
            )}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.platform} className={styles.group}>
              {!collapsed && (
                <p className={styles.groupTitle}>{PLATFORM_LABEL[group.platform]}</p>
              )}
              <ul className={styles.list}>
                {group.records.map((record) => (
                  <li key={`${record.platform}-${record.id}`}>
                    <button
                      type="button"
                      className={cn(styles.row, collapsed && styles.rowCollapsed)}
                      onClick={() =>
                        navigate(`/player?platform=${record.platform}&roomId=${record.id}`)
                      }
                      title={collapsed ? `${record.nickname}｜${record.title}` : undefined}
                    >
                      <span className={styles.avatar}>
                        <SmoothImage src={record.avatar} alt={record.nickname} rounded />
                      </span>
                      {!collapsed && (
                        <span className={styles.rowMain}>
                          <span className={styles.rowName}>{record.nickname}</span>
                          <span className={styles.rowTitle}>{record.title}</span>
                        </span>
                      )}
                      {!collapsed && (
                        <span className={styles.rowMeta}>{formatViewers(record.viewers)}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
