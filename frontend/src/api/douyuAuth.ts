import * as Douyu from "../../bindings/dtv/internal/services/douyuservice";

import type { DouyuProfile, QRLoginCode, QRLoginResult } from "./types";

/**
 * 斗鱼扫码登录 / 登录态管理。
 *
 * 协议与 Go 侧一一对应（internal/platforms/douyu/qrlogin.go）：
 *   generateQrLogin() → 二维码内容 + 轮询 code
 *   pollQrLogin(key)  → pending / scanned / expired / success(+cookie)
 *   setCookie(cookie) → 把登录态推给 Go 客户端，后续取流会带上
 *   refresh()         → passport safeAuth 续期
 */
export const douyuAuth = {
  async generateQrLogin(): Promise<QRLoginCode> {
    const code = await Douyu.QrLoginGenerate();
    if (!code) throw new Error("申请斗鱼登录二维码失败");
    return code as unknown as QRLoginCode;
  },

  async pollQrLogin(key: string): Promise<QRLoginResult> {
    const result = await Douyu.QrLoginPoll(key);
    if (!result) throw new Error("查询斗鱼扫码状态失败");
    return result as unknown as QRLoginResult;
  },

  async setCookie(cookie: string): Promise<void> {
    await Douyu.SetDouyuCookie(cookie);
  },

  async getCookie(): Promise<string> {
    return String((await Douyu.DouyuCookie()) ?? "");
  },

  async validate(): Promise<DouyuProfile> {
    const profile = await Douyu.DouyuCookieValid();
    if (!profile) return { loggedIn: false };
    return profile as unknown as DouyuProfile;
  },

  /** passport 续期；失败时后端返回旧 Cookie（可能已过期） */
  async refresh(): Promise<string> {
    return String((await Douyu.RefreshDouyuCookie()) ?? "");
  },
};
