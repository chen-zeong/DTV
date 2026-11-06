import * as Relay from "../../bindings/dtv/internal/services/streamrelayservice";

/**
 * 本地直播流中继（斗鱼续流）。
 *
 * 斗鱼下发的 flv 直链寿命固定 300 秒，到点 CDN 主动 EOF（PR #154 的实测结论）。
 * Go 侧的中继会在到期前预取新流并在 FLV tag 边界接续，所以播放器应该播放
 * 本地中继地址，而不是 CDN 直链。
 *
 * 只对斗鱼登记；其它平台（虎牙 / 抖音 / B 站）的直链没有这个硬期限，
 * 继续直连即可，少一层中转还能更低延迟。
 */

/** 会走中继的平台。 */
export const RELAY_PLATFORMS = ["douyu"] as const;

export function supportsStreamRelay(platform: string): boolean {
  return (RELAY_PLATFORMS as readonly string[]).includes(platform);
}

/**
 * 登记一次续流会话并返回本地播放地址；失败返回 null（调用方回退直链）。
 *
 * 同一个 (房间, 清晰度, 线路) 在 Go 侧复用同一个会话，重复调用不会堆积。
 */
export async function prepareStreamRelay(
  roomId: string,
  quality: string,
  line: string,
): Promise<string | null> {
  const trimmed = roomId.trim();
  if (!trimmed) return null;
  try {
    const info = await Relay.PrepareDouyu(trimmed, quality, line);
    const url = String(info?.url ?? "").trim();
    return url || null;
  } catch (error) {
    // 中继不可用时不要让直播直接失败：回退到 CDN 直链，最多是 5 分钟后断开。
    console.warn("[stream-relay] 登记续流会话失败，回退直连", error);
    return null;
  }
}
