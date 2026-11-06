import {
  Check,
  ChevronRight,
  Folder,
  FolderMinus,
  FolderPlus,
  ListCollapse,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RotateCw,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SmoothImage } from "@/components/common/SmoothImage";
import { RingProgress } from "@/components/ui/RingProgress";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/cn";
import { useOpenPlayer } from "@/lib/navigation";
import { PLATFORM_LABEL, type LivePlatform } from "@/api";
import { followKey, useFollow, type FollowRecord } from "@/state/FollowProvider";
import { useToast } from "@/state/ToastProvider";
import styles from "./FollowsList.module.css";

type StreamerMenuTarget = {
  kind: "streamer";
  key: string;
  record: FollowRecord;
  /** 该主播当前所在的文件夹（不在文件夹里时为 undefined） */
  folderId?: string;
};

type FolderMenuTarget = { kind: "folder"; folderId: string };

type MenuTarget = StreamerMenuTarget | FolderMenuTarget;

type MenuState = { x: number; y: number; target: MenuTarget } | null;

type DialogState =
  | { mode: "create"; value: string }
  | { mode: "rename"; folderId: string; value: string }
  | { mode: "delete"; folderId: string; folderName: string }
  | null;

/**
 * 关注列表（侧栏主体）——含"文件夹分组"。
 *
 * 旧版把新建文件夹 / 拖拽移入 / 重命名删除 / 全屏大列表 / 手动 hover 高亮条
 * 全塞在一个 1241 行组件里（还依赖 framer-motion 的 useSpring 做高亮）。
 * 这里的取舍：
 *   - 保留文件夹的完整能力（新建、重命名、删除、折叠、移入、移出）
 *   - 拖拽用原生 HTML5 drag & drop，不引入 framer-motion 那套 pointer 状态机
 *   - hover 高亮直接用 CSS :hover，去掉 motion 弹簧动画
 *   - 追加"移入文件夹"菜单项，不想拖拽的人也能用（旧版只能拖）
 */
export function FollowsList({
  collapsed,
  onToggleCollapsed,
}: {
  /** 折叠态由 Sidebar 持有 —— 侧栏宽度也要跟着变，状态不能只留在这里 */
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const openRoom = useOpenPlayer();
  const { toast } = useToast();
  const {
    follows,
    topLevel,
    folders,
    moveToFolder,
    removeFromFolder,
    removeFollow,
    createFolder,
    renameFolder,
    deleteFolder,
    toggleFolder,
    reorderTopLevel,
    reorderFolders,
    refreshStatuses,
    refreshing,
    refreshProgress,
  } = useFollow();

  const [menu, setMenu] = useState<MenuState>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [dragType, setDragType] = useState<"streamer" | "folder" | null>(null);
  const [dragSourceFolder, setDragSourceFolder] = useState<string | null>(null);
  const [dragFolderId, setDragFolderId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayFilter, setOverlayFilter] = useState<"ALL" | LivePlatform>("ALL");
  const [collapsedFolder, setCollapsedFolder] = useState<{
    folderId: string;
    left: number;
    top: number;
  } | null>(null);
  const collapsedCloseTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const listRefs = useRef<Map<string, HTMLUListElement>>(new Map());
  const [hoverBox, setHoverBox] = useState<{
    listId: string;
    top: number;
    height: number;
  } | null>(null);

  const showListHover = useCallback((listId: string, row: HTMLElement) => {
    const list = listRefs.current.get(listId);
    if (!list) return;
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    setHoverBox({
      listId,
      top: rowRect.top - listRect.top,
      height: rowRect.height,
    });
  }, []);

  const clearListHover = useCallback(() => setHoverBox(null), []);

  /* 菜单在任意点击 / 滚动 / Esc 后关闭 */
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    // 捕获阶段：xgplayer 的全局键盘插件会在 document 上 stopPropagation，
    // 冒泡阶段收不到 Escape。
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menu]);

  useEffect(() => {
    if (dialog) inputRef.current?.focus();
  }, [dialog]);

  /* 对话框统一支持 Esc 关闭（删除确认没有输入框，之前关不掉） */
  useEffect(() => {
    if (!dialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialog(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dialog]);

  useEffect(() => {
    if (!overlayOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOverlayOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [overlayOpen]);

  useEffect(() => {
    return () => {
      if (collapsedCloseTimer.current != null) {
        window.clearTimeout(collapsedCloseTimer.current);
      }
    };
  }, []);

  /** 该主播所在的文件夹 id（决定菜单里是否显示"移出文件夹"） */
  const folderOf = useCallback(
    (key: string) => folders.find((folder) => folder.keys.includes(key))?.id,
    [folders],
  );

  const openStreamerMenu = useCallback(
    (event: React.MouseEvent, record: FollowRecord) => {
      event.preventDefault();
      event.stopPropagation();
      const key = followKey(record.platform, record.id);
      setMenu({
        x: event.clientX,
        y: event.clientY,
        target: { kind: "streamer", key, record, folderId: folderOf(key) },
      });
    },
    [folderOf],
  );

  const openFolderMenu = useCallback((event: React.MouseEvent, folderId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, target: { kind: "folder", folderId } });
  }, []);

  const submitDialog = useCallback(() => {
    if (!dialog) return;
    if (dialog.mode === "create") {
      createFolder(dialog.value);
      // 新文件夹固定插在列表最前面；如果当前列表已经向下滚动，先回到顶部，
      // 否则新文件夹会停在视口上方，只露出底边像一根横线。
      // 第一次滚动只是立即响应，RAF 里再补一次 —— 这样即使列表高度在
      // React 提交后变化（例如新文件夹撑开布局）也能稳定停在顶部。
      contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      window.requestAnimationFrame(() => {
        contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      });
    } else if (dialog.mode === "rename") {
      renameFolder(dialog.folderId, dialog.value);
    } else if (dialog.mode === "delete") {
      deleteFolder(dialog.folderId);
    }
    setDialog(null);
  }, [createFolder, deleteFolder, dialog, renameFolder]);

  const openPlayer = useCallback(
    (record: FollowRecord) => {
      setOverlayOpen(false);
      setCollapsedFolder(null);
      // 已经在看 A 房间时，B 会替换掉 A 的历史记录：旧房间彻底销毁，
      // 从 B 退出时回到列表而不是自动重新进入 A（见 lib/navigation.ts）。
      openRoom(record.platform, record.id);
    },
    [openRoom],
  );

  const handleRefresh = useCallback(async () => {
    // 启动时的自动刷新也走同一条链路，这里顺手挡掉重复点击
    if (refreshing) return;
    try {
      const result = await refreshStatuses();
      if (result.skipped) return;
      if (result.total === 0) {
        toast("还没有关注任何主播", "info");
      } else if (result.failed === 0) {
        toast(`已刷新 ${result.updated} 位主播`, "success");
      } else if (result.updated > 0) {
        toast(`已刷新 ${result.updated} 位，${result.failed} 位暂时无法获取状态`, "info");
      } else {
        toast("刷新失败，请稍后重试", "error");
      }
    } catch (error) {
      console.warn("[follow-refresh] 手动刷新失败", error);
      toast("刷新失败，请稍后重试", "error");
    }
  }, [refreshing, refreshStatuses, toast]);

  const cancelCollapsedFolderClose = useCallback(() => {
    if (collapsedCloseTimer.current != null) {
      window.clearTimeout(collapsedCloseTimer.current);
      collapsedCloseTimer.current = null;
    }
  }, []);

  const scheduleCollapsedFolderClose = useCallback(() => {
    cancelCollapsedFolderClose();
    collapsedCloseTimer.current = window.setTimeout(() => {
      setCollapsedFolder(null);
      collapsedCloseTimer.current = null;
    }, 180);
  }, [cancelCollapsedFolderClose]);

  const openCollapsedFolder = useCallback(
    (folderId: string, el: HTMLElement) => {
      cancelCollapsedFolderClose();
      const rect = el.getBoundingClientRect();
      setCollapsedFolder({
        folderId,
        left: Math.min(rect.right + 10, Math.max(10, window.innerWidth - 272)),
        top: Math.min(Math.max(10, rect.top), Math.max(10, window.innerHeight - 360)),
      });
    },
    [cancelCollapsedFolderClose],
  );

  /* ------------------------------------------------------------- 拖拽处理 */
  const clearDrag = useCallback(() => {
    setDragKey(null);
    setDragType(null);
    setDragSourceFolder(null);
    setDragFolderId(null);
    setDragOverFolder(null);
    setDragOverKey(null);
  }, []);

  const onRowDragStart = useCallback(
    (event: React.DragEvent, record: FollowRecord, sourceFolderId?: string | null) => {
      const key = followKey(record.platform, record.id);
      setDragKey(key);
      setDragType("streamer");
      setDragSourceFolder(sourceFolderId ?? folderOf(key) ?? null);
      setDragFolderId(null);
      setDragOverKey(null);
      setDragOverFolder(null);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", key);
    },
    [folderOf],
  );

  const onRowDragEnd = useCallback(() => clearDrag(), [clearDrag]);

  const onRowDragOver = useCallback(
    (event: React.DragEvent, record: FollowRecord, targetFolderId?: string) => {
      if (targetFolderId) return;
      if (dragType !== "streamer" || !dragKey) return;
      const key = followKey(record.platform, record.id);
      if (key === dragKey) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDragOverFolder(null);
      setDragOverKey(key);
    },
    [dragKey, dragType],
  );

  const onRowDragLeave = useCallback(
    (_event: React.DragEvent, record: FollowRecord, targetFolderId?: string) => {
      if (targetFolderId) return;
      const key = followKey(record.platform, record.id);
      if (dragOverKey === key) setDragOverKey(null);
    },
    [dragOverKey],
  );

  const onRowDrop = useCallback(
    (event: React.DragEvent, record: FollowRecord, targetFolderId?: string) => {
      if (targetFolderId) {
        if (dragType === "folder") return;
        event.preventDefault();
        event.stopPropagation();
        if (dragType === "streamer" && dragKey) {
          moveToFolder(dragKey, targetFolderId);
        }
        clearDrag();
        return;
      }
      if (dragType === "folder") return;
      event.preventDefault();
      event.stopPropagation();
      const targetKey = followKey(record.platform, record.id);
      if (dragType === "streamer" && dragKey) {
        if (dragSourceFolder) {
          removeFromFolder(dragKey, dragSourceFolder);
          reorderTopLevel(dragKey, targetKey);
        } else if (dragKey !== targetKey) {
          reorderTopLevel(dragKey, targetKey);
        }
      }
      clearDrag();
    },
    [
      clearDrag,
      dragKey,
      dragSourceFolder,
      dragType,
      moveToFolder,
      removeFromFolder,
      reorderTopLevel,
    ],
  );

  const onFolderDragStart = useCallback((event: React.DragEvent, folderId: string) => {
    event.stopPropagation();
    setDragType("folder");
    setDragFolderId(folderId);
    setDragKey(null);
    setDragSourceFolder(null);
    setDragOverFolder(null);
    setDragOverKey(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `folder:${folderId}`);
  }, []);

  const onFolderDragEnd = useCallback(() => clearDrag(), [clearDrag]);

  const onFolderDragOver = useCallback(
    (event: React.DragEvent, folderId: string) => {
      if (!dragType) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (dragType === "folder" && dragFolderId === folderId) return;
      setDragOverKey(null);
      setDragOverFolder(folderId);
    },
    [dragFolderId, dragType],
  );

  const onFolderDragLeave = useCallback(
    (_event: React.DragEvent, folderId: string) => {
      if (dragOverFolder === folderId) setDragOverFolder(null);
    },
    [dragOverFolder],
  );

  const onFolderDrop = useCallback(
    (event: React.DragEvent, folderId: string) => {
      event.preventDefault();
      event.stopPropagation();
      if (dragType === "folder" && dragFolderId && dragFolderId !== folderId) {
        reorderFolders(dragFolderId, folderId);
      } else if (dragType === "streamer" && dragKey) {
        moveToFolder(dragKey, folderId);
      }
      clearDrag();
    },
    [clearDrag, dragFolderId, dragKey, dragType, moveToFolder, reorderFolders],
  );

  /* 拖到文件夹以外的空白区域 = 从文件夹移出 */
  const onMainDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (dragType === "streamer" && dragKey && dragSourceFolder) {
        removeFromFolder(dragKey, dragSourceFolder);
      }
      clearDrag();
    },
    [clearDrag, dragKey, dragSourceFolder, dragType, removeFromFolder],
  );

  const allFollows = useMemo(
    () => [...topLevel, ...folders.flatMap((folder) => folder.records)],
    [folders, topLevel],
  );

  const overlayFollows = useMemo(() => {
    const base =
      overlayFilter === "ALL"
        ? allFollows
        : allFollows.filter((record) => record.platform === overlayFilter);
    return [...base].sort((a, b) => Number(b.isLive) - Number(a.isLive));
  }, [allFollows, overlayFilter]);

  const overlayPlatforms = useMemo(() => {
    const present = new Set(allFollows.map((record) => record.platform));
    const order: LivePlatform[] = ["douyu", "huya", "douyin", "bilibili"];
    return order.filter((platform) => present.has(platform));
  }, [allFollows]);

  const liveCount = useMemo(
    () => allFollows.filter((record) => record.isLive).length,
    [allFollows],
  );

  // 绑成 const，TS 才能在下面的闭包里保持类型收窄（menu 是 state）
  const menuTarget: MenuTarget | null = menu?.target ?? null;

  /* 刷新按钮：展开态和折叠态共用一份实现。
   * 刷新中图标转圈，外面套一圈圆环进度（已完成 / 总数）。 */
  const refreshPercent =
    refreshProgress.total > 0 ? refreshProgress.done / refreshProgress.total : 0;
  const refreshHint = refreshing
    ? refreshProgress.total > 0
      ? `正在刷新 ${refreshProgress.done}/${refreshProgress.total}`
      : "正在刷新…"
    : "刷新关注状态";
  const refreshButton = (
    <button
      type="button"
      className={cn(styles.actionBtn, styles.noDrag, refreshing && styles.refreshBusy)}
      onClick={() => void handleRefresh()}
      disabled={refreshing}
      aria-busy={refreshing}
      aria-label={refreshHint}
      title={refreshHint}
    >
      <RotateCw size={16} strokeWidth={2.2} className={cn(refreshing && styles.spinning)} />
      {refreshing && (
        <RingProgress
          className={styles.refreshRing}
          value={refreshPercent}
          size={26}
          stroke={2}
          label={`刷新进度 ${refreshProgress.done}/${refreshProgress.total}`}
        />
      )}
    </button>
  );

  const renderRow = (
    record: FollowRecord,
    opts: { inFolderId?: string; forceExpanded?: boolean; plain?: boolean; listId?: string },
  ) => {
    const key = followKey(record.platform, record.id);
    const inFolder = Boolean(opts.inFolderId);
    const sourceFolderId = opts.inFolderId ?? folderOf(key) ?? null;
    const compact = collapsed && !opts.forceExpanded;
    const draggable = !opts.plain;
    return (
      <li key={`${key}@${opts.inFolderId ?? "top"}`} className={styles.rowWrap}>
        <div
          className={cn(
            styles.row,
            inFolder && styles.rowInFolder,
            compact && styles.rowCompact,
            dragKey === key && styles.rowDragging,
            dragOverKey === key && styles.rowDragOver,
          )}
          draggable={draggable}
          onDragStart={
            draggable ? (e) => onRowDragStart(e, record, sourceFolderId) : undefined
          }
          onDragEnd={draggable ? onRowDragEnd : undefined}
          onDragOver={draggable ? (e) => onRowDragOver(e, record, opts.inFolderId) : undefined}
          onDragLeave={
            draggable ? (e) => onRowDragLeave(e, record, opts.inFolderId) : undefined
          }
          onDrop={draggable ? (e) => onRowDrop(e, record, opts.inFolderId) : undefined}
          onMouseEnter={
            opts.listId && !opts.plain
              ? (event) => showListHover(opts.listId as string, event.currentTarget)
              : undefined
          }
          onClick={() => openPlayer(record)}
          onContextMenu={(e) => openStreamerMenu(e, record)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openPlayer(record);
            }
          }}
          title={compact ? `${record.nickname}｜${record.title}` : record.title || record.nickname}
        >
          <span className={styles.avatarWrap}>
            <span className={styles.avatar}>
              <SmoothImage src={record.avatar} alt={record.nickname} rounded />
            </span>
            <span
              className={cn(
                styles.liveDot,
                record.isLive ? styles.liveDotOn : styles.liveDotOff,
              )}
              title={record.isLive ? "正在直播" : "未开播"}
              aria-hidden="true"
            />
          </span>
          {!compact && (
            <span className={styles.rowMain}>
              <span className={styles.rowName}>{record.nickname}</span>
              <span className={styles.rowTitle}>{record.title || "暂无直播标题"}</span>
            </span>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className={cn(styles.root, collapsed && styles.collapsed)}>
      <div className={cn(styles.header, styles.drag, collapsed && styles.collapsedHeader)}>
        {collapsed ? (
          <>
            <button
              type="button"
              className={cn(styles.actionBtn, styles.noDrag)}
              onClick={onToggleCollapsed}
              aria-label="展开侧栏"
              title="展开侧栏"
            >
              <PanelLeftOpen size={16} />
            </button>
            {refreshButton}
            <button
              type="button"
              className={cn(styles.actionBtn, styles.noDrag)}
              onClick={() => {
                setCollapsedFolder(null);
                setOverlayFilter("ALL");
                setOverlayOpen(true);
              }}
              aria-label="展开全部主播"
              title="展开全部主播"
            >
              <ListCollapse size={16} />
            </button>
          </>
        ) : (
          <>
            <div className={styles.headerLeft}>
              <Users size={18} strokeWidth={2.2} className={styles.headerIcon} />
            </div>
            <div className={styles.headerActions}>
              {refreshButton}
              <button
                type="button"
                className={cn(styles.actionBtn, styles.noDrag)}
                onClick={() =>
                  setDialog({ mode: "create", value: `新文件夹 ${folders.length + 1}` })
                }
                aria-label="新建分组"
                title="新建分组"
              >
                <FolderPlus size={16} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                className={cn(styles.actionBtn, styles.noDrag)}
                onClick={() => {
                  setCollapsedFolder(null);
                  setOverlayFilter("ALL");
                  setOverlayOpen(true);
                }}
                aria-label="展开全部主播"
                title="展开全部主播"
              >
                <ListCollapse size={16} />
              </button>
              <button
                type="button"
                className={cn(styles.actionBtn, styles.noDrag)}
                onClick={onToggleCollapsed}
                aria-label="收起侧栏"
                title="收起侧栏"
              >
                <PanelLeftClose size={16} />
              </button>
            </div>
          </>
        )}
      </div>

      <div
        className={styles.content}
        ref={contentRef}
        onScroll={() => {
          clearListHover();
          setCollapsedFolder(null);
        }}
        onDragOver={(e) => {
          if (dragType === "streamer" && dragKey) e.preventDefault();
        }}
        onDrop={onMainDrop}
      >
        {follows.length === 0 ? (
          !collapsed && (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>暂无关注的主播</p>
            </div>
          )
        ) : (
          <>
            {!collapsed &&
              folders.map((folder) => {
                const expanded = !folder.collapsed;
                const online = folder.records.filter((record) => record.isLive).length;
                return (
                  <section
                    key={folder.id}
                    className={cn(
                      styles.folder,
                      !expanded && styles.folderCollapsed,
                      dragOverFolder === folder.id && styles.folderDragOver,
                      dragType === "folder" && dragFolderId === folder.id && styles.folderDragging,
                    )}
                    onDragOver={(e) => onFolderDragOver(e, folder.id)}
                    onDragLeave={(e) => onFolderDragLeave(e, folder.id)}
                    onDrop={(e) => onFolderDrop(e, folder.id)}
                  >
                    <div
                      className={styles.folderHeader}
                      draggable
                      onDragStart={(e) => onFolderDragStart(e, folder.id)}
                      onDragEnd={onFolderDragEnd}
                      onMouseEnter={clearListHover}
                      onContextMenu={(e) => openFolderMenu(e, folder.id)}
                      title="拖拽可排序；右键管理分组"
                    >
                      <button
                        type="button"
                        className={styles.folderToggle}
                        onClick={() => toggleFolder(folder.id)}
                        aria-expanded={expanded}
                        title={expanded ? "折叠" : "展开"}
                      >
                        <Folder
                          size={16}
                          strokeWidth={2.2}
                          className={cn(styles.folderIcon, expanded && styles.folderIconOpen)}
                        />
                        <span className={styles.folderName} title={folder.name}>
                          {folder.name}
                        </span>
                        <span className={styles.folderCount}>
                          {online}/{folder.records.length}
                        </span>
                        <ChevronRight
                          size={14}
                          strokeWidth={2.6}
                          className={cn(styles.chevron, expanded && styles.chevronOpen)}
                        />
                      </button>
                    </div>

                    <div
                      className={cn(
                        styles.folderContent,
                        !expanded && styles.folderContentCollapsed,
                      )}
                      aria-hidden={!expanded}
                    >
                      <div className={styles.folderContentInner}>
                        {folder.records.length > 0 && (
                          <ul
                            className={styles.list}
                            ref={(node) => {
                              if (node) listRefs.current.set(folder.id, node);
                              else listRefs.current.delete(folder.id);
                            }}
                            onMouseLeave={clearListHover}
                          >
                            {hoverBox?.listId === folder.id && (
                              <li
                                className={styles.listHover}
                                aria-hidden="true"
                                style={{
                                  transform: `translateY(${hoverBox.top}px)`,
                                  height: hoverBox.height,
                                }}
                              />
                            )}
                            {folder.records.map((record) =>
                              renderRow(record, {
                                inFolderId: folder.id,
                                listId: folder.id,
                              }),
                            )}
                          </ul>
                        )}
                      </div>
                    </div>
                  </section>
                );
              })}

            {collapsed ? (
              <>
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    className={styles.collapsedFolderBtn}
                    onMouseEnter={(e) => openCollapsedFolder(folder.id, e.currentTarget)}
                    onMouseLeave={scheduleCollapsedFolderClose}
                    onFocus={(e) => openCollapsedFolder(folder.id, e.currentTarget)}
                    onBlur={scheduleCollapsedFolderClose}
                    aria-label={`展开分组 ${folder.name}`}
                    title={folder.name}
                  >
                    <Folder size={17} strokeWidth={2.1} />
                    <span className={styles.collapsedFolderCount}>{folder.records.length}</span>
                  </button>
                ))}
                <ul className={styles.list}>
                  {topLevel.map((record) => renderRow(record, {}))}
                </ul>
              </>
            ) : (
              <ul
                className={styles.list}
                ref={(node) => {
                  if (node) listRefs.current.set("top", node);
                  else listRefs.current.delete("top");
                }}
                onMouseLeave={clearListHover}
              >
                {hoverBox?.listId === "top" && (
                  <li
                    className={styles.listHover}
                    aria-hidden="true"
                    style={{
                      transform: `translateY(${hoverBox.top}px)`,
                      height: hoverBox.height,
                    }}
                  />
                )}
                {topLevel.map((record) => renderRow(record, { listId: "top" }))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* ------------------------------------------------ 折叠态文件夹悬浮弹窗 */}
      {collapsed &&
        collapsedFolder &&
        (() => {
          const folder = folders.find((item) => item.id === collapsedFolder.folderId);
          if (!folder) return null;
          const online = folder.records.filter((record) => record.isLive).length;
          return createPortal(
            <div
              className={styles.folderPopup}
              style={{ left: collapsedFolder.left, top: collapsedFolder.top }}
              role="dialog"
              aria-label={`分组 ${folder.name}`}
              onMouseEnter={cancelCollapsedFolderClose}
              onMouseLeave={scheduleCollapsedFolderClose}
            >
              <div className={styles.folderPopupHeader}>
                <Folder size={15} strokeWidth={2.2} className={styles.folderPopupIcon} />
                <span className={styles.folderPopupName} title={folder.name}>
                  {folder.name}
                </span>
                <span className={styles.folderCount}>
                  {online}/{folder.records.length}
                </span>
              </div>
              {folder.records.length > 0 && (
                <ul className={styles.folderPopupList}>
                  {folder.records.map((record) =>
                    renderRow(record, {
                      inFolderId: folder.id,
                      forceExpanded: true,
                      plain: true,
                    }),
                  )}
                </ul>
              )}
            </div>,
            document.body,
          );
        })()}

      {/* ------------------------------------------------------ 全部主播弹层 */}
      {overlayOpen &&
        createPortal(
          <div
            className={styles.overlayBackdrop}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOverlayOpen(false);
            }}
          >
            <div
              className={styles.overlayPanel}
              role="dialog"
              aria-modal="true"
              aria-label="全部关注"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header className={styles.overlayHeader}>
                <div className={styles.overlayHeading}>
                  <h3 className={styles.overlayTitle}>全部关注</h3>
                  <p className={styles.overlaySubtitle}>
                    {follows.length} 位主播 · {liveCount} 正在直播
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.overlayClose}
                  onClick={() => setOverlayOpen(false)}
                  aria-label="关闭"
                >
                  <X size={16} strokeWidth={2.4} />
                </button>
              </header>

              {overlayPlatforms.length > 0 && (
                <div className={styles.overlayFilters}>
                  <button
                    type="button"
                    className={cn(styles.overlayFilter, overlayFilter === "ALL" && styles.overlayFilterActive)}
                    onClick={() => setOverlayFilter("ALL")}
                  >
                    全部
                  </button>
                  {overlayPlatforms.map((platform) => (
                    <button
                      key={platform}
                      type="button"
                      className={cn(
                        styles.overlayFilter,
                        overlayFilter === platform && styles.overlayFilterActive,
                      )}
                      onClick={() => setOverlayFilter(platform)}
                    >
                      {PLATFORM_LABEL[platform]}
                    </button>
                  ))}
                </div>
              )}

              {overlayFollows.length === 0 ? (
                <p className={styles.overlayEmpty}>还没有关注的主播</p>
              ) : (
                <div className={styles.overlayGrid}>
                  {overlayFollows.map((record) => (
                    <button
                      key={followKey(record.platform, record.id)}
                      type="button"
                      className={styles.overlayCard}
                      onClick={() => openPlayer(record)}
                      title={record.title || record.nickname}
                    >
                      <span className={styles.overlayAvatarWrap}>
                        <span className={styles.overlayAvatar}>
                          <SmoothImage src={record.avatar} alt={record.nickname} rounded />
                        </span>
                        <span
                          className={cn(
                            styles.liveDot,
                            record.isLive ? styles.liveDotOn : styles.liveDotOff,
                          )}
                          aria-hidden="true"
                        />
                      </span>
                      <span className={styles.overlayMeta}>
                        <span className={styles.overlayName}>{record.nickname}</span>
                        <span className={styles.overlayRoom}>
                          {record.title || "暂无直播标题"}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}

      {/* ------------------------------------------------------------ 右键菜单 */}
      {menu && menuTarget && (
        <div
          className={styles.menuBackdrop}
          onMouseDown={() => setMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu(null);
          }}
        >
          <div
            className={styles.menu}
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {menuTarget.kind === "streamer" ? (
              <>
                {folders.length > 0 ? (
                  <>
                    <p className={styles.menuLabel}>移入文件夹</p>
                    {folders.map((folder) => {
                      const already = folder.id === menuTarget.folderId;
                      return (
                        <button
                          key={folder.id}
                          type="button"
                          className={cn(styles.menuItem, already && styles.menuItemActive)}
                          disabled={already}
                          onClick={() => {
                            moveToFolder(menuTarget.key, folder.id);
                            setMenu(null);
                          }}
                        >
                          <Folder size={14} strokeWidth={2.2} />
                          <span className={styles.menuText}>{folder.name}</span>
                          {already && <Check size={13} strokeWidth={2.6} />}
                        </button>
                      );
                    })}
                  </>
                ) : (
                  <p className={styles.menuLabel}>还没有文件夹</p>
                )}

                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    setDialog({ mode: "create", value: `新文件夹 ${folders.length + 1}` });
                    setMenu(null);
                  }}
                >
                  <FolderPlus size={14} strokeWidth={2.2} />
                  <span className={styles.menuText}>新建文件夹…</span>
                </button>

                {menuTarget.folderId && (
                  <button
                    type="button"
                    className={styles.menuItem}
                    onClick={() => {
                      removeFromFolder(menuTarget.key, menuTarget.folderId as string);
                      setMenu(null);
                    }}
                  >
                    <FolderMinus size={14} strokeWidth={2.2} />
                    <span className={styles.menuText}>移出文件夹</span>
                  </button>
                )}

                <div className={styles.menuSep} />
                <button
                  type="button"
                  className={cn(styles.menuItem, styles.menuDanger)}
                  onClick={() => {
                    removeFollow(menuTarget.record.platform, menuTarget.record.id);
                    setMenu(null);
                  }}
                >
                  <X size={14} strokeWidth={2.4} />
                  <span className={styles.menuText}>取消关注</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    const folder = folders.find((f) => f.id === menuTarget.folderId);
                    setDialog({
                      mode: "rename",
                      folderId: menuTarget.folderId,
                      value: folder?.name ?? "",
                    });
                    setMenu(null);
                  }}
                >
                  <Pencil size={14} strokeWidth={2.2} />
                  <span className={styles.menuText}>重命名</span>
                </button>
                <button
                  type="button"
                  className={cn(styles.menuItem, styles.menuDanger)}
                  onClick={() => {
                    const folder = folders.find((f) => f.id === menuTarget.folderId);
                    setDialog({
                      mode: "delete",
                      folderId: menuTarget.folderId,
                      folderName: folder?.name ?? "",
                    });
                    setMenu(null);
                  }}
                >
                  <Trash2 size={14} strokeWidth={2.2} />
                  <span className={styles.menuText}>删除文件夹</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------- 弹窗 */}
      {dialog && (
        <Modal
          title={
            dialog.mode === "create"
              ? "新建文件夹"
              : dialog.mode === "rename"
                ? "重命名文件夹"
                : "删除文件夹"
          }
          onClose={() => setDialog(null)}
          width={380}
          footer={
            <>
              <button type="button" className={styles.btnGhost} onClick={() => setDialog(null)}>
                取消
              </button>
              <button
                type="button"
                className={cn(styles.btnPrimary, dialog.mode === "delete" && styles.btnDanger)}
                onClick={submitDialog}
                disabled={"value" in dialog && !dialog.value.trim()}
              >
                确定
              </button>
            </>
          }
        >
          {dialog.mode === "delete" ? (
            <p className={styles.dialogBody}>
              删除「{dialog.folderName}」后，里面的主播会回到主列表。
            </p>
          ) : (
            <div className={styles.dialogBody}>
              <input
                ref={inputRef}
                className={styles.input}
                value={dialog.value}
                placeholder="输入文件夹名称"
                onChange={(e) =>
                  setDialog((prev) =>
                    prev && "value" in prev ? { ...prev, value: e.target.value } : prev,
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitDialog();
                }}
              />
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
