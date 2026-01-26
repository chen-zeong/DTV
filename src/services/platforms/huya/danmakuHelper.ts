import { listen, type Event as TauriEvent } from "@tauri-apps/api/event";
import { Ref } from "vue";
import type {
  DanmakuMessage,
  DanmuOverlayInstance,
  DanmuRenderOptions,
} from "../../../types/models/danmaku";
import { v4 as uuidv4 } from "uuid";
import { startHuyaDanmaku, stopHuyaDanmaku as stopHuyaDanmakuApi } from "../../../api/danmaku";

export interface HuyaUnifiedEntry {
  quality: string;
  bitRate: number;
  url: string;
}

// 统一的 Rust 弹幕事件负载（与 Douyin/Douyu 保持一致）
interface UnifiedRustDanmakuPayload {
  room_id: string;
  user: string;
  content: string;
  user_level: number;
  fans_club_level: number;
}
let currentHuyaRoomId: string | null = null;

export async function startHuyaDanmakuListener(
  roomId: string,
  danmuOverlay: DanmuOverlayInstance | null,
  danmakuMessagesRef: Ref<DanmakuMessage[]>,
  renderOptions?: DanmuRenderOptions,
): Promise<() => void> {
  console.log(
    "[HuyaPlayerHelper] Starting Huya danmaku listener for room:",
    roomId,
  );
  currentHuyaRoomId = roomId;

  try {
    // 调用后端虎牙弹幕监听命令
    await startHuyaDanmaku({ args: { room_id_str: roomId } });
    console.log("[HuyaPlayerHelper] Backend Huya danmaku listener started");
  } catch (error) {
    console.error(
      "[HuyaPlayerHelper] Failed to start backend Huya danmaku listener:",
      error,
    );
    throw error;
  }

  // 监听弹幕事件
  const eventName = "danmaku-message";

  const unlisten = await listen<UnifiedRustDanmakuPayload>(
    eventName,
    (event: TauriEvent<UnifiedRustDanmakuPayload>) => {
      console.log("[HuyaPlayerHelper] Received danmaku event:", event.payload);

      // 只处理当前房间的弹幕（后端 payload 字段为 room_id/user/content/...）
      if (!event.payload || event.payload.room_id !== roomId) {
        return;
      }

      const frontendDanmaku: DanmakuMessage = {
        id: uuidv4(),
        nickname: event.payload.user || "未知用户",
        content: event.payload.content,
        level: String(event.payload.user_level ?? 0),
        badgeLevel:
          event.payload.fans_club_level != null
            ? String(event.payload.fans_club_level)
            : undefined,
        room_id: roomId,
      };

      const shouldDisplay = renderOptions?.shouldDisplay
        ? renderOptions.shouldDisplay()
        : true;

      if (shouldDisplay && danmuOverlay?.sendComment) {
        try {
          const commentOptions =
            renderOptions?.buildCommentOptions?.(frontendDanmaku) ?? {};
          const styleFromOptions = commentOptions.style ?? {};
          const preferredColor =
            styleFromOptions.color ||
            (frontendDanmaku as any).color ||
            "#FFFFFF";
          danmuOverlay.sendComment({
            id: frontendDanmaku.id,
            txt: frontendDanmaku.content,
            duration: commentOptions.duration ?? 12000,
            mode: commentOptions.mode ?? "scroll",
            style: {
              ...styleFromOptions,
              color: preferredColor,
            },
          });
        } catch (emitError) {
          console.warn(
            "[HuyaPlayerHelper] Failed emitting danmu.js comment:",
            emitError,
          );
        }
      }

      // 添加到弹幕消息列表
      danmakuMessagesRef.value.push(frontendDanmaku);
      if (danmakuMessagesRef.value.length > 200) {
        danmakuMessagesRef.value.splice(
          0,
          danmakuMessagesRef.value.length - 200,
        );
      }
    },
  );

  console.log("[HuyaPlayerHelper] Event listener registered for:", eventName);

  return unlisten;
}

export async function stopHuyaDanmaku(
  currentUnlistenFn: (() => void) | null,
): Promise<void> {
  if (currentUnlistenFn) {
    try {
      currentUnlistenFn();
      console.log("[HuyaPlayerHelper] Event listener unregistered");
    } catch (e) {
      console.warn("[HuyaPlayerHelper] stopHuyaDanmaku cleanup error:", e);
    }
  }

  // 停止后端虎牙弹幕监听
  try {
    const roomIdToStop = currentHuyaRoomId || "";
    await stopHuyaDanmakuApi(roomIdToStop);
  } catch (e) {
    console.warn(
      "[HuyaPlayerHelper] stopHuyaDanmaku: backend stop encountered error (ignored):",
      e,
    );
  }
  currentHuyaRoomId = null;
  console.log("[HuyaPlayerHelper] Huya danmaku stopped");
}

// 直播流获取已迁移到后端统一接口 get_live_stream_v2
