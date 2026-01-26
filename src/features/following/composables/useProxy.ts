import { ref } from "vue";
import { startStaticProxyServer } from "../../../api/proxy";

export function useImageProxy() {
  const proxyBase = ref("");

  async function ensureProxyStarted(): Promise<void> {
    try {
      if (!proxyBase.value) {
        const base = await startStaticProxyServer();
        proxyBase.value = base || "";
      }
    } catch (e) {
      console.warn("[useImageProxy] ensureProxyStarted failed:", e);
    }
  }

  function proxify(url: string | null | undefined): string {
    const u = (url || "").trim();
    if (!u) return "";
    try {
      const parsed = new URL(u);
      if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
        return u;
      }
    } catch {}
    if (!proxyBase.value) return u;
    const base = proxyBase.value.endsWith("/")
      ? proxyBase.value.slice(0, -1)
      : proxyBase.value;
    return `${base}/image?url=${encodeURIComponent(u)}`;
  }

  function getAvatarSrc(platform: string, avatarUrl?: string | null) {
    const u = avatarUrl || "";
    if (!u) return "";
    // Proxy avatars for platforms that require it
    if (platform === "BILIBILI" || platform === "HUYA") {
      return proxify(u);
    }
    return u;
  }

  return { proxyBase, ensureProxyStarted, proxify, getAvatarSrc };
}
