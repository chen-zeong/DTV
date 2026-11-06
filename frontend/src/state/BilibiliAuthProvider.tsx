import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { bilibiliAuth } from "@/api/bilibiliAuth";
import type { BilibiliProfile, QRLoginCode, QRLoginStatus } from "@/api/types";
import { BilibiliLoginModal } from "@/features/bilibili/BilibiliLoginModal";
import { STORAGE_KEYS } from "@/lib/storage";
import { isWailsRuntime } from "@/lib/window";

/**
 * B 站登录态。
 *
 * 流程（对应老项目的"弹一个登录窗口 + 轮询读 Cookie"）：
 *   1. 点登录 → 向 Go 后端申请二维码内容
 *   2. 前端把二维码内容渲染成 QR（uqr），用户手机 B 站扫码
 *   3. 前端每 1.5s 问一次扫码状态：pending → scanned → success
 *   4. success 时后端已经拿到 Cookie 并应用到 HTTP 客户端，
 *      前端只负责把 Cookie 存进 localStorage，下次启动恢复
 *
 * 和旧版的区别：不再需要开一个 webview 去登录页（Wails v3 拿不到 WebView2
 * 的 Cookie，而且 SESSDATA 是 HttpOnly 页面 JS 也读不到）。
 */

export interface BilibiliAuthValue {
  /** 已保存的 Cookie（空串 = 未登录） */
  cookie: string;
  /** 后端确认过的登录态 */
  loggedIn: boolean;
  userName: string | null;
  avatar: string | null;
  /** 登录弹窗是否打开 */
  modalOpen: boolean;
  openLogin: () => void;
  closeLogin: () => void;
  logout: () => void;
}

const BilibiliAuthContext = createContext<BilibiliAuthValue | null>(null);

const POLL_INTERVAL_MS = 1500;

/**
 * 登录态变化事件。
 *
 * 播放页收到后会重新取流：登录/退出会改变服务端下发的清晰度档位，
 * 不重新取流的话界面会一直停在登录前的档位。
 */
export const BILIBILI_AUTH_EVENT = "dtv:bilibili-auth-changed";

function notifyAuthChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BILIBILI_AUTH_EVENT));
}

function writeLocalCookie(next: string) {
  try {
    if (next) window.localStorage.setItem(STORAGE_KEYS.bilibiliCookie, next);
    else window.localStorage.removeItem(STORAGE_KEYS.bilibiliCookie);
  } catch {
    /* 隐私模式：忽略 */
  }
}

export function BilibiliAuthProvider({ children }: { children: ReactNode }) {
  const [cookie, setCookie] = useState<string>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEYS.bilibiliCookie) ?? "";
    } catch {
      return "";
    }
  });
  const [profile, setProfile] = useState<BilibiliProfile>({ loggedIn: false });
  const [modalOpen, setModalOpen] = useState(false);

  // 弹窗内部状态
  const [qr, setQr] = useState<QRLoginCode | null>(null);
  const [status, setStatus] = useState<QRLoginStatus | "loading" | "idle">("idle");
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const pollTimer = useRef<number | null>(null);
  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const persistCookie = useCallback((next: string) => {
    setCookie(next);
    writeLocalCookie(next);
    // 同步给 Go 客户端（失败不影响 UI，后端会退回未登录请求）
    if (isWailsRuntime()) {
      void bilibiliAuth.setCookie(next).catch((err) => {
        console.warn("[BilibiliAuth] 同步 Cookie 失败：", err);
      });
    }
    notifyAuthChanged();
  }, []);

  /* 启动时恢复登录态：先推 Cookie，再向后端确认是否还有效 */
  useEffect(() => {
    // 浏览器预览没有 Go 侧，跳过 IPC，避免控制台出现无意义的失败。
    if (!isWailsRuntime()) return;
    let cancelled = false;
    const saved = cookie;

    void (async () => {
      try {
        await bilibiliAuth.setCookie(saved);
      } catch (err) {
        console.warn("[BilibiliAuth] 恢复 Cookie 失败：", err);
      }
      if (!saved) {
        if (!cancelled) setProfile({ loggedIn: false });
        return;
      }
      try {
        const next = await bilibiliAuth.validate();
        if (cancelled) return;
        setProfile(next);
        // Cookie 过期了就直接清掉，避免 UI 一直显示"已登录"但实际请求都是匿名的
        if (!next.loggedIn) persistCookie("");
      } catch (err) {
        console.warn("[BilibiliAuth] 校验登录态失败：", err);
      }
    })();

    return () => {
      cancelled = true;
    };
    // 只在首次挂载时恢复；后续登录/退出由各自流程处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const poll = useCallback(
    async (key: string) => {
      try {
        const result = await bilibiliAuth.pollQrLogin(key);
        setStatus(result.status);
        setMessage(result.message);

        if (result.status === "success" && result.cookie) {
          stopPolling();
          persistCookie(result.cookie);
          setProfile({
            loggedIn: true,
            userName: result.userName,
            avatar: result.avatar,
          });
          // 让"登录成功"有一瞬间的可见反馈，再关掉弹窗
          window.setTimeout(() => {
            setModalOpen(false);
            setQr(null);
            setStatus("idle");
          }, 700);
        } else if (result.status === "expired" || result.status === "error") {
          stopPolling();
        }
      } catch (err) {
        stopPolling();
        setStatus("error");
        setError(err instanceof Error ? err.message : "查询扫码状态失败");
      }
    },
    [persistCookie, stopPolling],
  );

  const startFlow = useCallback(async () => {
    stopPolling();
    setQr(null);
    setStatus("loading");
    setMessage("正在获取二维码…");
    setError(null);

    try {
      const code = await bilibiliAuth.generateQrLogin();
      setQr(code);
      setStatus("pending");
      setMessage("请用 B 站客户端扫码");
      pollTimer.current = window.setInterval(() => void poll(code.key), POLL_INTERVAL_MS);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "获取二维码失败");
    }
  }, [poll, stopPolling]);

  const openLogin = useCallback(() => {
    setModalOpen(true);
    void startFlow();
  }, [startFlow]);

  const closeLogin = useCallback(() => {
    stopPolling();
    setModalOpen(false);
    setQr(null);
    setStatus("idle");
    setError(null);
  }, [stopPolling]);

  /**
   * 退出登录：先让 B 站服务端使当前会话失效，再清空本地状态。
   *
   * 本地 UI 立刻退出（不等网络），同时清 localStorage，避免用户再次启动时
   * 又把旧 Cookie 恢复回来。后端 BilibiliLogout 会清空 Go 侧 Cookie 与
   * cookie jar，保证后续取流/搜索请求确实回到匿名状态。
   */
  const logout = useCallback(async () => {
    stopPolling();
    setCookie("");
    writeLocalCookie("");
    setProfile({ loggedIn: false });
    setModalOpen(false);
    setQr(null);
    setStatus("idle");
    setError(null);

    if (!isWailsRuntime()) {
      notifyAuthChanged();
      return;
    }
    try {
      await bilibiliAuth.logout();
    } catch (err) {
      console.warn("[BilibiliAuth] 服务端退出登录失败，本地已清空：", err);
    }
    // 服务端退出失败时也要确保 Go 侧不再带着旧 Cookie。
    try {
      await bilibiliAuth.setCookie("");
    } catch (err) {
      console.warn("[BilibiliAuth] 清空后端 Cookie 失败：", err);
    }
    // 等 Go 侧真正清空后再通知播放页重新取流，避免用旧 Cookie 抢跑。
    notifyAuthChanged();
  }, [stopPolling]);

  const value = useMemo<BilibiliAuthValue>(
    () => ({
      cookie,
      loggedIn: profile.loggedIn,
      userName: profile.userName ?? null,
      avatar: profile.avatar ?? null,
      modalOpen,
      openLogin,
      closeLogin,
      logout,
    }),
    [closeLogin, cookie, logout, modalOpen, openLogin, profile],
  );

  return (
    <BilibiliAuthContext.Provider value={value}>
      {children}
      {modalOpen && (
        <BilibiliLoginModal
          qrURL={qr?.url ?? ""}
          status={status}
          message={message}
          error={error}
          userName={profile.userName ?? null}
          loggedIn={profile.loggedIn}
          onRefresh={() => void startFlow()}
          onClose={closeLogin}
          onLogout={logout}
        />
      )}
    </BilibiliAuthContext.Provider>
  );
}

export function useBilibiliAuth(): BilibiliAuthValue {
  const ctx = useContext(BilibiliAuthContext);
  if (!ctx) throw new Error("useBilibiliAuth 必须在 BilibiliAuthProvider 内使用");
  return ctx;
}
