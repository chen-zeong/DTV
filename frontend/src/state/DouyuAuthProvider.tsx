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
import { douyuAuth } from "@/api/douyuAuth";
import type { DouyuProfile, QRLoginCode, QRLoginStatus } from "@/api/types";
import { DouyuLoginModal } from "@/features/douyu/DouyuLoginModal";
import { STORAGE_KEYS } from "@/lib/storage";
import { isWailsRuntime } from "@/lib/window";

/**
 * 斗鱼登录态。
 *
 * 与 B 站登录同一套交互：扫码 → 轮询 → 后端拿到 Cookie 并应用 →
 * 前端持久化，下次启动恢复。
 *
 * 斗鱼特殊点：登录 Cookie 里的 dy_did 会被后端用作签名设备号；
 * Cookie 变更后播放器需要重新取流，所以这里广播
 * `dtv:douyu-auth-changed`，播放页收到后会自动刷新当前房间。
 */

export const DOUYU_AUTH_EVENT = "dtv:douyu-auth-changed";

export interface DouyuAuthValue {
  cookie: string;
  loggedIn: boolean;
  userName: string | null;
  avatar: string | null;
  modalOpen: boolean;
  openLogin: () => void;
  closeLogin: () => void;
  logout: () => void;
}

const DouyuAuthContext = createContext<DouyuAuthValue | null>(null);

const POLL_INTERVAL_MS = 2000;

function notifyAuthChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DOUYU_AUTH_EVENT));
}

export function DouyuAuthProvider({ children }: { children: ReactNode }) {
  const [cookie, setCookie] = useState<string>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEYS.douyuCookie) ?? "";
    } catch {
      return "";
    }
  });
  const [profile, setProfile] = useState<DouyuProfile>({ loggedIn: false });
  const [modalOpen, setModalOpen] = useState(false);

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

  const persistCookie = useCallback(async (next: string) => {
    setCookie(next);
    try {
      if (next) window.localStorage.setItem(STORAGE_KEYS.douyuCookie, next);
      else window.localStorage.removeItem(STORAGE_KEYS.douyuCookie);
    } catch {
      /* 隐私模式：忽略 */
    }
    if (isWailsRuntime()) {
      try {
        await douyuAuth.setCookie(next);
      } catch (err) {
        console.warn("[DouyuAuth] 同步 Cookie 失败：", err);
      }
    }
    // 等 Go 侧真正应用后再通知播放页重新取流，避免用旧 Cookie 抢跑。
    notifyAuthChanged();
  }, []);

  /* 启动时恢复登录态：先推 Cookie，再判断/续期 */
  useEffect(() => {
    if (!isWailsRuntime()) return;
    let cancelled = false;
    const saved = cookie;

    void (async () => {
      try {
        await douyuAuth.setCookie(saved);
      } catch (err) {
        console.warn("[DouyuAuth] 恢复 Cookie 失败：", err);
      }
      notifyAuthChanged();
      if (!saved) {
        if (!cancelled) setProfile({ loggedIn: false });
        return;
      }
      try {
        const next = await douyuAuth.validate();
        if (cancelled) return;
        setProfile(next);
        if (!next.loggedIn) {
          await persistCookie("");
          return;
        }
        // 斗鱼登录态约 7 天；启动时顺手续期一次，失败保留旧 Cookie。
        try {
          const refreshed = await douyuAuth.refresh();
          if (!cancelled && refreshed && refreshed !== saved) {
            await persistCookie(refreshed);
          }
        } catch (err) {
          console.warn("[DouyuAuth] Cookie 续期失败，继续使用旧 Cookie：", err);
        }
      } catch (err) {
        console.warn("[DouyuAuth] 校验登录态失败：", err);
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
        const result = await douyuAuth.pollQrLogin(key);
        setStatus(result.status);
        setMessage(result.message);

        if (result.status === "success" && result.cookie) {
          stopPolling();
          await persistCookie(result.cookie);
          setProfile({
            loggedIn: true,
            userName: result.userName,
            avatar: result.avatar,
          });
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
      const code = await douyuAuth.generateQrLogin();
      setQr(code);
      setStatus("pending");
      setMessage("请用斗鱼 App 扫码");
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

  const logout = useCallback(() => {
    stopPolling();
    void persistCookie("");
    setProfile({ loggedIn: false });
    setModalOpen(false);
    setQr(null);
    setStatus("idle");
  }, [persistCookie, stopPolling]);

  const value = useMemo<DouyuAuthValue>(
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
    <DouyuAuthContext.Provider value={value}>
      {children}
      {modalOpen && (
        <DouyuLoginModal
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
    </DouyuAuthContext.Provider>
  );
}

export function useDouyuAuth(): DouyuAuthValue {
  const ctx = useContext(DouyuAuthContext);
  if (!ctx) throw new Error("useDouyuAuth 必须在 DouyuAuthProvider 内使用");
  return ctx;
}
