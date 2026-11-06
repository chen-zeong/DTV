import * as Bilibili from "../../bindings/dtv/internal/services/bilibiliservice";

import type { BilibiliProfile, QRLoginCode, QRLoginResult } from "./types";

/**
 * B 站扫码登录 / 登录态管理。
 *
 * 封装成独立模块（而不是塞进 `api/index.ts` 的平台适配器）是因为它
 * 不属于"平台数据"接口：只有 B 站有账号体系，其它三个平台看完即走。
 *
 * 协议与 Go 侧一一对应（internal/platforms/bilibili/qrlogin.go）：
 *   generateQrLogin() → 二维码内容 + 轮询 key
 *   pollQrLogin(key)  → pending / scanned / expired / success(+cookie)
 *   setCookie(cookie) → 把登录态推给 Go 客户端，后续取流/搜索都会带上
 */

export const bilibiliAuth = {
  /** 申请登录二维码 */
  async generateQrLogin(): Promise<QRLoginCode> {
    const code = await Bilibili.QrLoginGenerate();
    if (!code) throw new Error("申请登录二维码失败");
    return code as unknown as QRLoginCode;
  },

  /** 查询一次扫码状态（前端按 1.5s 轮询） */
  async pollQrLogin(key: string): Promise<QRLoginResult> {
    const result = await Bilibili.QrLoginPoll(key);
    if (!result) throw new Error("查询扫码状态失败");
    return result as unknown as QRLoginResult;
  },

  /** 把 Cookie 同步给 Go 客户端（空串表示退出登录） */
  async setCookie(cookie: string): Promise<void> {
    await Bilibili.SetBilibiliCookie(cookie);
  },

  /**
   * 退出登录：调用 B 站 passport 的退出接口让服务端会话失效，
   * 同时清空 Go 侧 Cookie 与 cookie jar。
   */
  async logout(): Promise<void> {
    await Bilibili.BilibiliLogout();
  },

  /** 读取 Go 侧当前生效的 Cookie（一般用前端 localStorage 即可） */
  async getCookie(): Promise<string> {
    return String((await Bilibili.BilibiliCookie()) ?? "");
  },

  /** 让后端向 B 站确认一次登录态 */
  async validate(): Promise<BilibiliProfile> {
    const profile = await Bilibili.BilibiliCookieValid();
    if (!profile) return { loggedIn: false };
    return profile as unknown as BilibiliProfile;
  },
};
