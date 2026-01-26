import { listen, type Event as TauriEvent } from "@tauri-apps/api/event";
import { Ref } from "vue";
import { Platform } from "../../../types/app/platform";
import type {
  DanmakuMessage,
  DanmuOverlayInstance,
  DanmuRenderOptions,
  RustGetStreamUrlPayload,
} from "../../../types/models/danmaku";
import { v4 as uuidv4 } from "uuid";
import { startDouyinDanmaku } from "../../../api/danmaku";

export interface DouyinRustDanmakuPayload {
  room_id?: string;
  user: string; // Nickname from Rust's DanmakuFrontendPayload
  content: string;
  user_level: number; // from Rust's i64
  fans_club_level: number; // from Rust's i32
}

// 直播流获取已迁移到后端统一接口 get_live_stream_v2

export async function startDouyinDanmakuListener(
  roomId: string,
  danmuOverlay: DanmuOverlayInstance | null, // For emitting danmaku to overlay
  danmakuMessagesRef: Ref<DanmakuMessage[]>, // For updating DanmuList
  renderOptions?: DanmuRenderOptions,
): Promise<() => void> {
  const rustPayload: RustGetStreamUrlPayload = {
    args: { room_id_str: roomId },
    platform: Platform.DOUYIN,
  };
  await startDouyinDanmaku(rustPayload);

  const eventName = "danmaku-message";

  const unlisten = await listen<DouyinRustDanmakuPayload>(
    eventName,
    (event: TauriEvent<DouyinRustDanmakuPayload>) => {
      if (event.payload) {
        const rustP = event.payload;
        const frontendDanmaku: DanmakuMessage = {
          id: uuidv4(),
          nickname: rustP.user || "未知用户",
          content: rustP.content || "",
          level: String(rustP.user_level || 0),
          badgeLevel:
            rustP.fans_club_level > 0
              ? String(rustP.fans_club_level)
              : undefined,
          room_id: rustP.room_id || roomId, // Ensure room_id is present
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
              "[DouyinPlayerHelper] Failed emitting danmu.js comment:",
              emitError,
            );
          }
        }
        danmakuMessagesRef.value.push(frontendDanmaku);
        if (danmakuMessagesRef.value.length > 200) {
          // Manage danmaku array size
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

export async function stopDouyinDanmaku(
  currentUnlistenFn: (() => void) | null,
): Promise<void> {
  if (currentUnlistenFn) {
    currentUnlistenFn();
  }
  try {
    const rustPayload: RustGetStreamUrlPayload = {
      args: { room_id_str: "stop_listening" },
      platform: Platform.DOUYIN,
    };
    await startDouyinDanmaku(rustPayload);
  } catch (error) {
    console.error(
      "[DouyinPlayerHelper] Error stopping Douyin danmaku listener:",
      error,
    );
  }
}
