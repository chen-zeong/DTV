import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { renderSVG } from "uqr";
import { Modal } from "@/components/ui/Modal";
import styles from "./DouyuLoginModal.module.css";

export type DouyuLoginUIStatus =
  | "idle"
  | "loading"
  | "pending"
  | "scanned"
  | "expired"
  | "success"
  | "error";

interface Props {
  qrURL: string;
  status: DouyuLoginUIStatus;
  message: string;
  error: string | null;
  userName: string | null;
  loggedIn: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onLogout: () => void;
}

/**
 * 斗鱼扫码登录弹窗。
 *
 * 二维码内容是 passport 返回的 m.douyu.com 扫码中转页；前端用 uqr 渲染成
 * 纯 SVG，不经过后端图片。
 */
export function DouyuLoginModal(props: Props) {
  const { qrURL, status, message, error, userName, loggedIn, onRefresh, onClose, onLogout } = props;

  const svg = useMemo(() => {
    if (!qrURL) return "";
    try {
      return renderSVG(qrURL, {
        ecc: "M",
        border: 2,
        pixelSize: 6,
        whiteColor: "#ffffff",
        blackColor: "#111111",
      });
    } catch (err) {
      console.warn("[DouyuLoginModal] 生成二维码失败：", err);
      return "";
    }
  }, [qrURL]);

  const expired = status === "expired" || status === "error";
  const showQr = !loggedIn && Boolean(svg) && !expired;

  return (
    <Modal title="斗鱼扫码登录" onClose={onClose} width={400}>
      <div className={styles.body}>
        {loggedIn ? (
          <div className={styles.successBlock}>
            <CheckCircle2 size={40} strokeWidth={1.8} className={styles.successIcon} />
            <p className={styles.successText}>已登录{userName ? `：${userName}` : "斗鱼账号"}</p>
            <p className={styles.hint}>
              登录态已保存。部分房间的原画/蓝光档位需要登录账号，取流会自动带上 Cookie。
            </p>
            <button type="button" className={styles.dangerBtn} onClick={onLogout}>
              退出登录
            </button>
          </div>
        ) : (
          <>
            <div className={styles.qrBox}>
              {showQr ? (
                <div
                  className={styles.qrSvg}
                  // uqr 返回的是自生成的 SVG 字符串（无外部输入）
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              ) : (
                <div className={styles.qrPlaceholder}>
                  {status === "loading" ? (
                    <Loader2 size={26} className={styles.spin} />
                  ) : (
                    <RefreshCw size={26} strokeWidth={1.8} />
                  )}
                </div>
              )}
              {status === "scanned" && showQr && (
                <div className={styles.qrOverlay}>
                  <CheckCircle2 size={28} strokeWidth={2} />
                  <span>已扫码</span>
                </div>
              )}
            </div>

            <p className={styles.statusText}>{error ?? message ?? "请用斗鱼 App 扫码"}</p>
            <p className={styles.hint}>打开手机斗鱼 App → 我的 → 扫一扫</p>

            {expired && (
              <button type="button" className={styles.primaryBtn} onClick={onRefresh}>
                <RefreshCw size={14} strokeWidth={2.4} />
                刷新二维码
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
