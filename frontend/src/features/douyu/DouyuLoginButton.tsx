import { LogOut, QrCode } from "lucide-react";
import { cn } from "@/lib/cn";
import { useDouyuAuth } from "@/state/DouyuAuthProvider";
import styles from "./DouyuLoginButton.module.css";

interface Props {
  /** compact 用于播放页顶栏（深色背景），默认用于首页排版 */
  variant?: "default" | "compact";
  className?: string;
}

/**
 * 斗鱼登录入口。
 *
 * 未登录：显示"扫码登录"，点击打开二维码弹窗。
 * 已登录：显示昵称（能取到的话）+ 退出按钮。
 */
export function DouyuLoginButton({ variant = "default", className }: Props) {
  const { loggedIn, userName, openLogin, logout } = useDouyuAuth();

  if (loggedIn) {
    return (
      <div className={cn(styles.wrap, variant === "compact" && styles.compact, className)}>
        <span className={styles.user} title={userName ?? "已登录斗鱼"}>
          <span className={styles.dot} />
          <span className={styles.userName}>{userName ?? "已登录"}</span>
        </span>
        <button
          type="button"
          className={styles.logoutBtn}
          onClick={logout}
          title="退出登录"
          aria-label="退出斗鱼登录"
        >
          <LogOut size={13} strokeWidth={2.4} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(styles.loginBtn, variant === "compact" && styles.compact, className)}
      onClick={openLogin}
      title="扫码登录斗鱼（部分房间登录后可看更高清晰度）"
    >
      <QrCode size={14} strokeWidth={2.4} />
      <span>扫码登录</span>
    </button>
  );
}
