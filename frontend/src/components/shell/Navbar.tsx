import { MonitorSmartphone, Moon, Sun, ThumbsUp, X } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { LivePlatform } from "@/api";
import { SmoothImage } from "@/components/common/SmoothImage";
import { PlatformTabs } from "@/components/shell/PlatformTabs";
import { SearchBox } from "@/components/shell/SearchBox";
import { WindowControls } from "@/components/shell/WindowControls";
import { cn } from "@/lib/cn";
import { APP_VERSION } from "@/lib/appInfo";
import { useCustomCategories } from "@/state/CustomCategoriesProvider";
import { useFollow } from "@/state/FollowProvider";
import { usePlayerUi } from "@/state/PlayerUiProvider";
import { useTheme } from "@/state/ThemeProvider";
import styles from "./Navbar.module.css";

type ModalKind = "donate" | "sync" | null;

function platformFromPath(pathname: string): LivePlatform | "custom" {
  if (pathname.startsWith("/custom")) return "custom";
  if (pathname.startsWith("/huya")) return "huya";
  if (pathname.startsWith("/douyin")) return "douyin";
  if (pathname.startsWith("/bilibili")) return "bilibili";
  return "douyu";
}

/**
 * 顶栏。
 *
 * 旧版是 815 行单文件（tab + 搜索 + 主播岛 + 版本 + 打赏 + 更新 + 窗口控制 +
 * 两个内联弹层 + 20 个 useState）。这里只负责"组装"，每个部件各自独立：
 * PlatformTabs / SearchBox / WindowControls / PlayerIsland。
 */
export function Navbar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { island } = usePlayerUi();
  const { entries } = useCustomCategories();
  const { isFollowing, toggleFollow } = useFollow();
  const [modal, setModal] = useState<ModalKind>(null);

  const platform = platformFromPath(pathname);
  const isPlayerRoute = pathname.startsWith("/player");

  const followed = island
    ? isFollowing(island.platform, island.roomId)
    : false;

  return (
    <nav className={cn(styles.navbar, styles.drag)}>
      <div className={styles.tabsWrap}>
        <PlatformTabs hasCustomCategories={entries.length > 0} />
      </div>

      {island && isPlayerRoute && (
        <div className={cn(styles.island, styles.noDrag)}>
          <span className={styles.islandAvatar}>
            <SmoothImage src={island.avatar} alt={island.nickname} rounded />
          </span>
          <span className={styles.islandMeta}>
            <span className={styles.islandName}>{island.nickname}</span>
            <span className={styles.islandTitle}>{island.title}</span>
          </span>
          <button
            type="button"
            className={cn(styles.islandFollow, followed && styles.islandFollowed)}
            onClick={() =>
              toggleFollow({
                id: island.roomId,
                platform: island.platform,
                nickname: island.nickname,
                title: island.title,
                avatar: island.avatar,
                cover: "",
                viewers: 0,
                categoryName: "",
                isLive: island.isLive,
              })
            }
          >
            {followed ? "已关注" : "关注"}
          </button>
          <button
            type="button"
            className={styles.islandExpand}
            onClick={() => navigate(-1)}
            aria-label="返回"
          >
            <X size={14} strokeWidth={2.4} />
          </button>
        </div>
      )}

      <div className={cn(styles.actions, styles.drag)}>
        {platform !== "custom" && <SearchBox platform={platform} />}

        <button type="button" className={styles.versionBtn} title={`DTV ${APP_VERSION}`}>
          <span className={styles.versionText}>v{APP_VERSION}</span>
        </button>

        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => setModal("donate")}
          aria-label="赞赏支持"
        >
          <ThumbsUp size={18} strokeWidth={2.2} />
        </button>

        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => setModal("sync")}
          aria-label="多端同步"
        >
          <MonitorSmartphone size={18} strokeWidth={2.2} />
        </button>

        <button
          type="button"
          className={cn(styles.themeToggle, theme === "dark" ? styles.themeDark : styles.themeLight)}
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "切换到亮色" : "切换到暗色"}
        >
          {theme === "dark" ? <Sun size={18} strokeWidth={2.2} /> : <Moon size={18} strokeWidth={2.2} />}
        </button>

        <WindowControls />
      </div>

      {modal && (
        <div className={cn(styles.backdrop, styles.noDrag)} onClick={() => setModal(null)}>
          <div className={styles.card} onClick={(e) => e.stopPropagation()}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>{modal === "donate" ? "赞赏支持" : "多端同步"}</h2>
              <button
                type="button"
                className={styles.cardClose}
                onClick={() => setModal(null)}
                aria-label="关闭"
              >
                <X size={16} strokeWidth={2.4} />
              </button>
            </div>
            <div className={styles.cardBody}>
              {modal === "donate" ? (
                <>
                  <img className={styles.qrImage} src="/wechat.jpg" alt="微信赞赏码" />
                  <p className={styles.cardHint}>如果 DTV 对你有帮助，欢迎请我喝一杯 ☕</p>
                </>
              ) : (
                <p className={styles.cardHint}>
                  局域网同步（导出/导入配置）将在接入 Go 后端后开放。
                  <br />
                  当前版本为纯前端骨架，数据全部来自本地假数据。
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
