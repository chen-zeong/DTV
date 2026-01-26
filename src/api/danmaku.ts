import { invoke } from "@tauri-apps/api/core";

export async function startDouyuDanmaku(roomId: string): Promise<void> {
  return invoke<void>("start_danmaku_listener", { roomId });
}

export async function stopDouyuDanmaku(roomId: string): Promise<void> {
  return invoke<void>("stop_danmaku_listener", { roomId });
}

export async function startBilibiliDanmaku(payload: any, cookie: string | null): Promise<void> {
  return invoke<void>("start_bilibili_danmaku_listener", { payload, cookie });
}

export async function stopBilibiliDanmaku(): Promise<void> {
  return invoke<void>("stop_bilibili_danmaku_listener");
}

export async function startHuyaDanmaku(payload: any): Promise<void> {
  return invoke<void>("start_huya_danmaku_listener", { payload });
}

export async function stopHuyaDanmaku(roomId: string): Promise<void> {
  return invoke<void>("stop_huya_danmaku_listener", { roomId });
}

export async function startDouyinDanmaku(payload: any): Promise<void> {
  return invoke<void>("start_douyin_danmu_listener", { payload });
}
