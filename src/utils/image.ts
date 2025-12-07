export const proxyBilibiliImage = (url?: string | null) => {
  if (!url) return url ?? undefined;
  try {
    const stripped = url.replace(/^https?:\/\//i, "");
    return `https://images.weserv.nl/?url=${encodeURIComponent(stripped)}`;
  } catch {
    return url;
  }
};

export const normalizeAvatarUrl = (platform: string, url?: string | null) => {
  if (!url) return undefined;
  return platform.toUpperCase() === "BILIBILI" ? proxyBilibiliImage(url) : url;
};

