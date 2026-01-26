import { listen, type Event as TauriEvent } from "@tauri-apps/api/event";
import { Ref } from "vue";
import type {
  DanmakuMessage,
  DanmuOverlayInstance,
  DanmuRenderOptions,
} from "../../../types/models/danmaku";
import { v4 as uuidv4 } from "uuid";
import { startDouyuDanmaku, stopDouyuDanmaku as stopDouyuDanmakuApi } from "../../../api/danmaku";

// 统一的 Rust 弹幕事件负载（与 Douyin/Huya 保持一致）
export interface UnifiedRustDanmakuPayload {
  room_id?: string;
  user: string;
  content: string;
  user_level: number;
  fans_club_level: number;
}

export async function startDouyuDanmakuListener(
  roomId: string,
  danmuOverlay: DanmuOverlayInstance | null,
  danmakuMessagesRef: Ref<DanmakuMessage[]>,
  renderOptions?: DanmuRenderOptions,
): Promise<() => void> {
  await startDouyuDanmaku(roomId);

  const eventName = "danmaku-message";

  const unlisten = await listen<UnifiedRustDanmakuPayload>(
    eventName,
    (event: TauriEvent<UnifiedRustDanmakuPayload>) => {
      if (event.payload) {
        const rustP = event.payload;

        // 仅处理当前 roomId 的消息，避免跨房间干扰
        if (rustP.room_id && rustP.room_id !== roomId) return;

        const frontendDanmaku: DanmakuMessage = {
          id: uuidv4(),
          nickname: rustP.user || "未知用户",
          content: rustP.content || "",
          level: String(rustP.user_level || 0),
          badgeLevel:
            rustP.fans_club_level > 0
              ? String(rustP.fans_club_level)
              : undefined,
          room_id: rustP.room_id || roomId,
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
              styleFromOptions.color || frontendDanmaku.color || "#FFFFFF";

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
              "[DouyuPlayerHelper] Failed emitting danmu.js comment:",
              emitError,
            );
          }
        }
        danmakuMessagesRef.value.push(frontendDanmaku);
        if (danmakuMessagesRef.value.length > 200) {
          danmakuMessagesRef.value.splice(
            0,
            danmakuMessagesRef.value.length - 200,
          );
        }
      }
    },
  );

  return unlisten;
}

export async function stopDouyuDanmaku(
  roomId: string,
  currentUnlistenFn: (() => void) | null,
): Promise<void> {
  if (currentUnlistenFn) {
    currentUnlistenFn();
  }
  try {
    if (roomId) {
      await stopDouyuDanmakuApi(roomId);
    }
  } catch (error) {
    console.error(
      "[DouyuPlayerHelper] Error invoking stop_danmaku_listener for Douyu:",
      error,
    );
  }
}

// 直播流获取/代理已迁移到后端统一接口 get_live_stream_v2
