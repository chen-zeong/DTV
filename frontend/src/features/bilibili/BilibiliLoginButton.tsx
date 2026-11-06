import { LogOut, QrCode } from "lucide-react";
import { cn } from "@/lib/cn";
import { useBilibiliAuth } from "@/state/BilibiliAuthProvider";
import styles from "./BilibiliLoginButton.module.css";

interface Props {
  /** compact 用于播放页顶栏（深色背景），默认用于首页排版 */
  variant?: "default" | "compact";
  className?: string;
}

/**
 * B 站登录入口。
 *
 * 未登录：显示"扫码登录"，点击打开二维码弹窗。
 * 已登录：显示昵称 + 退出按钮（退出后回到未登录态）。
 */
export function BilibiliLoginButton({ variant = "default", className }: Props) {
  const { loggedIn, userName, openLogin, logout } = useBilibiliAuth();

  if (loggedIn) {
    return (
      <div className={cn(styles.wrap, variant === "compact" && styles.compact, className)}>
        <span className={styles.user} title={userName ?? "已登录"}>
          <span className={styles.dot} />
          <span className={styles.userName}>{userName ?? "已登录"}</span>
        </span>
        <button
          type="button"
          className={styles.logoutBtn}
          onClick={logout}
          title="退出登录"
          aria-label="退出 B 站登录"
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
      title="扫码登录 B 站（登录后可看更高清晰度）"
    >
      <QrCode size={14} strokeWidth={2.4} />
      <span>扫码登录</span>
    </button>
  );
}
