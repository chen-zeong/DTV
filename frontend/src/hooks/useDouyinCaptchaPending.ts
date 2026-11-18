import { useEffect, useState } from "react";
import { Events } from "@wailsio/runtime";

import * as Captcha from "../../bindings/dtv/internal/platforms/douyin/captcha/captchaservice";
import { isWailsRuntime } from "../lib/window";

/**
 * 抖音人机验证挑战状态。
 *
 * 后端 (Go)在有人正在进行人机验证挑战时发出 `douyin-captcha-pending`
 * 事件，payload 为 boolean:
 *   - true:  有人正在过验证码 (前端暂停关注列表的后台刷新)
 *   - false: 挑战结束 (前端恢复刷新)
 */

/** 后端发来的事件名 (对应 Go 侧 captcha.EventCaptchaPending) */
export const DOUYIN_CAPTCHA_PENDING_EVENT = "douyin-captcha-pending";

/**
 * useDouyinCaptchaPending 抖音人机验证挑战状态
 *
 * @returns 当前是否有人机验证挑战正在进行
 */
export function useDouyinCaptchaPending(): boolean {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!isWailsRuntime()) return;

    void (async () => {
      try {
        const current = await Captcha.IsPending();
        setPending(Boolean(current));
      } catch (err) {
        console.warn("[captcha] 查询人机验证状态失败", err);
      }
    })();

    let off: (() => void) | undefined;
    try {
      off = Events.On(DOUYIN_CAPTCHA_PENDING_EVENT, (ev: { data: boolean }) => {
        setPending(Boolean(ev?.data));
      });
    } catch (err) {
      console.warn("[captcha] 订阅人机验证事件失败", err);
    }

    return () => {
      try {
        off?.();
      } catch {
        /* 忽略重复取消 */
      }
    };
  }, []);

  return pending;
}
