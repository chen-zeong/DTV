import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { renderSVG } from "uqr";
import { Modal } from "@/components/ui/Modal";
import styles from "./BilibiliLoginModal.module.css";

export type LoginUIStatus =
  | "idle"
  | "loading"
  | "pending"
  | "scanned"
  | "expired"
  | "success"
  | "error";

interface Props {
  qrURL: string;
  status: LoginUIStatus;
  message: string;
  error: string | null;
  userName: string | null;
  loggedIn: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onLogout: () => void;
}

/**
 * B 站扫码登录弹窗。
 *
 * 二维码在前端用 uqr 生成（纯 SVG 字符串，无 canvas / 无网络请求），
 * 这样不需要把二维码图片过一遍后端，隐私也更好。
 * 外壳使用共享 <Modal>：Esc、焦点陷阱、遮罩点击、关闭后焦点归还统一处理。
 */
export function BilibiliLoginModal(props: Props) {
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
      console.warn("[BilibiliLoginModal] 生成二维码失败：", err);
      return "";
    }
  }, [qrURL]);

  const expired = status === "expired" || status === "error";
  const showQr = !loggedIn && Boolean(svg) && !expired;

  return (
    <Modal title="B 站扫码登录" onClose={onClose} width={400}>
      <div className={styles.body}>
        {loggedIn ? (
          <div className={styles.successBlock}>
            <CheckCircle2 size={40} strokeWidth={1.8} className={styles.successIcon} />
            <p className={styles.successText}>已登录{userName ? `：${userName}` : ""}</p>
            <p className={styles.hint}>登录后可以观看更高清晰度，弹幕也会带上账号身份。</p>
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

            <p className={styles.statusText}>{error ?? message ?? "请用 B 站客户端扫码"}</p>
            <p className={styles.hint}>打开手机 B 站 → 我的 → 扫一扫</p>

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
