<template>
  <div
    class="relative z-[2] w-full flex-shrink-0 overflow-hidden rounded-b-none px-6 pt-5 pb-5 max-lg:mb-[-18px] max-lg:rounded-b-[22px] max-lg:px-5 max-lg:pt-5 max-lg:pb-6 max-md:mb-[-14px] max-md:rounded-b-[18px] max-md:px-4 max-md:pt-4 max-md:pb-5"
  >
    <div
      class="relative z-[1] grid [grid-template-columns:auto_minmax(0,1fr)_auto] items-center gap-5 max-lg:gap-[18px] max-md:gap-4"
    >
      <div
        class="h-12 w-12 flex-shrink-0 overflow-hidden rounded-2xl border border-border-main bg-surface-mid shadow-md transition-all hover:-translate-y-1"
      >
        <img
          v-if="avatarUrl && !showAvatarText"
          :src="avatarUrl"
          :alt="computedNickname"
          @error="handleAvatarError"
          class="h-full w-full object-cover"
        />
        <div
          v-else
          class="flex h-full w-full items-center justify-center bg-brand text-lg text-white"
        >
          {{ computedNickname.charAt(0).toUpperCase() }}
        </div>
      </div>

      <div class="flex min-w-0 flex-col gap-2.5">
        <h3
          class="line-clamp-2 text-left text-[1.05rem] leading-[1.35] font-bold tracking-[0.25px] text-text-main"
          :title="computedRoomTitle"
        >
          {{ computedRoomTitle }}
        </h3>
        <div class="flex flex-wrap items-center gap-4 text-text-dim">
          <span
            class="text-[0.88rem] font-medium tracking-[0.03em] text-text-main"
            >{{ computedNickname }}</span
          >
          <span
            class="inline-flex items-center rounded-full border border-border-main bg-surface-high/50 px-2.5 py-[3px] text-[0.72rem] leading-[1.3] tracking-[0.05em] text-text-main"
            :class="{
              'border-green-500/50 bg-green-500/10 text-green-600 dark:text-green-400':
                statusClass === 'live',
              'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400':
                statusClass === 'looping',
            }"
            >{{ getStatusText }}</span
          >
          <!-- Bilibili login button -->
          <span
            v-if="props.platform === Platform.BILIBILI"
            class="inline-flex items-center gap-2"
          >
            <button
              class="inline-flex items-center gap-1.5 rounded-md bg-surface-high/50 px-2.5 py-1 text-[0.75rem] text-text-muted transition-colors hover:bg-surface-high hover:text-text-main active:scale-95"
              @click="handleBilibiliLogin"
              :disabled="isLoggingIn"
              :title="
                hasRequiredBilibiliCookie ? '点击重新登录' : '登录以同步 Cookie'
              "
            >
              <span v-if="isLoggingIn">登录中...</span>
              <span
                v-else-if="hasRequiredBilibiliCookie"
                class="inline-flex items-center gap-1"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="1em"
                  height="1em"
                  viewBox="0 0 24 24"
                >
                  <path
                    fill="currentColor"
                    d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
                  />
                </svg>
                已登录
              </span>
              <span v-else> 登录 </span>
            </button>
            <button
              v-if="hasRequiredBilibiliCookie && !isLoggingIn"
              class="rounded-md border-transparent bg-transparent px-2 py-1 text-[0.75rem] text-text-muted transition-colors hover:text-text-main active:scale-95"
              @click="handleBilibiliLogout"
            >
              退出
            </button>
            <span v-if="loginError" class="text-[0.72rem] text-red-500">{{
              loginError
            }}</span>
          </span>
          <span
            v-if="computedViewerCount > 0"
            class="inline-flex items-center gap-1.5 rounded-full border border-border-main bg-surface-high/80 px-3 py-1 text-[0.78rem] text-text-main shadow-sm backdrop-blur-sm"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="1em"
              height="1em"
              viewBox="0 0 24 24"
              class="h-[13px] w-[13px] text-brand"
            >
              <path
                fill="currentColor"
                d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5M12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5s5 2.24 5 5s-2.24 5-5 5m0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3s3-1.34 3-3s-1.34-3-3-3"
              />
            </svg>
            {{ formattedViewerCount }}
          </span>
        </div>
      </div>

      <div class="ml-auto flex flex-shrink-0 items-center justify-end">
        <div
          class="relative flex min-w-[210px] items-stretch overflow-hidden rounded-[14px] border border-border-main bg-surface-mid/90 p-0.5 shadow-md backdrop-blur-md"
          ref="idFollowContainerRef"
        >
          <span
            class="absolute top-[3px] bottom-[3px] rounded-[12px] bg-brand/90 transition-all duration-300"
          ></span>
          <span
            class="relative z-[1] flex max-w-[140px] min-w-[90px] flex-1 items-center justify-center overflow-hidden rounded-[12px] px-3.5 py-2 text-[0.78rem] text-ellipsis whitespace-nowrap text-text-muted transition-colors duration-300"
            ref="streamerIdRef"
            :class="{ 'font-bold text-white dark:text-app-bg': isFollowing }"
            >ID:{{ props.roomId }}</span
          >
          <button
            class="relative z-[1] flex min-w-[92px] items-center justify-center gap-2 rounded-[12px] px-3.5 py-2 text-[0.82rem] font-bold whitespace-nowrap text-text-main transition-colors duration-300"
            ref="followBtnRef"
            :class="{ 'text-white dark:text-app-bg': !isFollowing }"
            @click="toggleFollow"
          >
            <span class="relative flex h-4 w-4 items-center justify-center">
              <span
                class="absolute inset-0 flex items-center justify-center transition-all"
                :class="
                  isFollowing
                    ? 'scale-50 -rotate-90 opacity-0'
                    : 'scale-100 rotate-0 opacity-100'
                "
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="1em"
                  height="1em"
                  viewBox="0 0 24 24"
                >
                  <path
                    fill="currentColor"
                    d="M19 12.998h-6v6h-2v-6H5v-2h6v-6h2v6h6z"
                  />
                </svg>
              </span>
              <span
                class="absolute inset-0 flex items-center justify-center transition-all"
                :class="
                  isFollowing
                    ? 'scale-100 rotate-0 opacity-100'
                    : 'scale-50 rotate-90 opacity-0'
                "
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="1em"
                  height="1em"
                  viewBox="0 0 24 24"
                >
                  <path
                    fill="currentColor"
                    d="M18.3 5.71a.996.996 0 0 0-1.41 0L12 10.59L7.11 5.7A.996.996 0 1 0 5.7 7.11L10.59 12L5.7 16.89a.996.996 0 1 0 1.41 1.41L12 13.41l4.89 4.89a.996.996 0 1 0 1.41-1.41L13.41 12l4.89-4.89c.38-.38.38-1.02 0-1.4z"
                  />
                </svg>
              </span>
            </span>
            <span>{{ isFollowing ? "取关" : "关注" }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, onUpdated, nextTick } from "vue";
import { Platform } from "../../platforms/common/types";
import type { StreamerDetails } from "../../platforms/common/types";
import { fetchDouyuStreamerDetails } from "../../platforms/douyu/streamerInfoParser";
import { getDouyinStreamerDetails } from "../../platforms/douyin/streamerInfoParser";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  ensureBilibiliLoginWindow,
  extractRequiredFlags,
  getBilibiliCookies,
  hasRequiredCookies,
  sleep,
} from "../../platforms/bilibili/cookieHelper";

// Helper: normalize avatar URL (strip wrappers/backticks, fix protocol)
const normalizeAvatarUrl = (input: string | null | undefined): string => {
  if (!input) return "";
  let url = String(input).trim();
  // strip wrapping backticks or quotes
  const startsWithWrapper =
    url.startsWith("`") || url.startsWith('"') || url.startsWith("'");
  const endsWithWrapper =
    url.endsWith("`") || url.endsWith('"') || url.endsWith("'");
  if (startsWithWrapper && endsWithWrapper) {
    url = url.slice(1, -1).trim();
  }
  // handle protocol-relative URLs
  if (url.startsWith("//")) {
    url = "https:" + url;
  }
  // upgrade http to https
  if (url.startsWith("http://")) {
    url = "https://" + url.slice("http://".length);
  }
  // remove any whitespace inside the URL
  url = url.replace(/\s+/g, "");
  return url;
};
const emit = defineEmits<{
  (
    e: "follow",
    data: {
      id: string;
      platform: Platform;
      nickname: string;
      avatarUrl: string | null;
      roomTitle?: string;
    },
  ): void;
  (e: "unfollow", roomId: string): void;
}>();

const props = defineProps<{
  roomId: string;
  platform: Platform;
  isFollowed: boolean;
  title?: string | null;
  anchorName?: string | null;
  avatar?: string | null;
  isLive?: boolean | null;
  initialViewerCount?: number | null;
}>();

const roomDetails = ref<StreamerDetails | null>(null);
const isLoading = ref(false);
const error = ref<string | null>(null);
const showAvatarText = ref(false);

const computedRoomTitle = computed(
  () => roomDetails.value?.roomTitle ?? props.title ?? "直播间标题加载中...",
);
const computedNickname = computed(
  () => roomDetails.value?.nickname ?? props.anchorName ?? "主播昵称加载中...",
);
const avatarUrl = ref(props.avatar || "");
const computedViewerCount = computed(() => roomDetails.value?.viewerCount ?? 0);
const isFollowing = computed(() => props.isFollowed);
const computedStreamStatus = computed(() => {
  if (roomDetails.value) {
    if (roomDetails.value.isLive && roomDetails.value.isLooping) {
      return "looping";
    }
    if (roomDetails.value.isLive) {
      return "live";
    }
  } else if (props.isLive) {
    return "live";
  }
  return "offline";
});

const statusClass = computed(() => {
  return computedStreamStatus.value;
});

const getStatusText = computed(() => {
  if (error.value) return "信息加载失败";
  const status = computedStreamStatus.value;
  if (status === "live") return "直播中";
  if (status === "looping") return "轮播中";
  return "未开播";
});

const formattedViewerCount = computed(() => {
  const count = computedViewerCount.value;
  if (count >= 10000) {
    return (count / 10000).toFixed(1) + "万";
  }
  return count.toString();
});

// Proxy support for Bilibili avatar images
const proxyBase = ref<string | null>(null);
const ensureProxyStarted = async () => {
  if (!proxyBase.value) {
    try {
      const base = await invoke<string>("start_static_proxy_server");
      proxyBase.value = base;
    } catch (e) {
      console.error("[StreamerInfo] Failed to start static proxy server", e);
    }
  }
};
const proxify = (url?: string): string => {
  if (!url) return "";
  if (proxyBase.value) {
    return `${proxyBase.value}/image?url=${encodeURIComponent(url)}`;
  }
  return url;
};

// Bilibili login state
const bilibiliCookie = ref<string>("");
const hasRequiredBilibiliCookie = ref(false);
const isLoggingIn = ref(false);
const loginError = ref<string | null>(null);

const updateBilibiliCookieState = (raw: string | null | undefined) => {
  const value = (raw ?? "").trim();
  bilibiliCookie.value = value;
  const { hasSessdata, hasBiliJct } = extractRequiredFlags(value);
  hasRequiredBilibiliCookie.value = hasSessdata && hasBiliJct;
};

const persistBilibiliCookie = (raw: string | null | undefined) => {
  if (typeof localStorage === "undefined") return;
  const value = (raw ?? "").trim();
  if (value) {
    localStorage.setItem("bilibili_cookie", value);
  } else {
    localStorage.removeItem("bilibili_cookie");
  }
  updateBilibiliCookieState(value);
};

const loadBilibiliCookieFromStorage = () => {
  if (typeof localStorage === "undefined") return;
  const saved = localStorage.getItem("bilibili_cookie");
  updateBilibiliCookieState(saved);
};

const handleBilibiliLogout = async () => {
  loginError.value = null;
  persistBilibiliCookie(null);
  if (props.platform === Platform.BILIBILI) {
    await fetchRoomDetails();
  }
};

const handleBilibiliLogin = async () => {
  if (isLoggingIn.value) return;
  loginError.value = null;
  isLoggingIn.value = true;

  let unlisten: UnlistenFn | null = null;

  try {
    const loginWindow = await ensureBilibiliLoginWindow();
    let windowClosed = false;

    unlisten = await loginWindow.listen("tauri://close-requested", () => {
      windowClosed = true;
    });

    const timeoutMs = 120_000;
    const intervalMs = 1_500;
    const deadline = Date.now() + timeoutMs;

    while (!windowClosed && Date.now() < deadline) {
      const result = await getBilibiliCookies([loginWindow.label]);
      if (hasRequiredCookies(result)) {
        persistBilibiliCookie(result.cookie);
        try {
          await loginWindow.close();
        } catch (closeErr) {
          console.warn(
            "[StreamerInfo] Failed to close bilibili login window:",
            closeErr,
          );
        }
        if (props.platform === Platform.BILIBILI) {
          await fetchRoomDetails();
        }
        return;
      }
      await sleep(intervalMs);
    }

    if (windowClosed) {
      throw new Error("登录窗口已关闭，未完成登录");
    }

    throw new Error("登录超时，请重试");
  } catch (e: any) {
    loginError.value = e?.message || "登录失败，请重试";
    console.error("[StreamerInfo] handleBilibiliLogin error:", e);
  } finally {
    if (unlisten) {
      try {
        unlisten();
      } catch (_) {
        /* no-op */
      }
    }
    isLoggingIn.value = false;
  }
};

const fetchRoomDetails = async () => {
  if (props.platform === Platform.DOUYIN) {
    showAvatarText.value = !props.avatar;
    isLoading.value = false;
    roomDetails.value = null;
    avatarUrl.value = props.avatar || "";
    return;
  }

  if (props.platform === Platform.HUYA) {
    try {
      isLoading.value = true;
      error.value = null;
      roomDetails.value = null;
      showAvatarText.value = false;

      const res: any = await invoke("get_huya_unified_cmd", {
        roomId: props.roomId,
        quality: "原画",
      });
      const mapped: StreamerDetails = {
        roomId: props.roomId,
        platform: "huya",
        roomTitle:
          res && res.title ? res.title : (props.title ?? "直播间标题加载中..."),
        nickname:
          res && res.nick ? res.nick : (props.anchorName ?? props.roomId),
        avatarUrl: res && res.avatar ? res.avatar : (props.avatar ?? null),
        isLive: !!(res && res.is_live),
      };
      roomDetails.value = mapped;
      await ensureProxyStarted();
      avatarUrl.value = proxify(normalizeAvatarUrl(mapped.avatarUrl));
      showAvatarText.value = !avatarUrl.value;
    } catch (e: any) {
      console.error(
        `[StreamerInfo] HUYA fetchRoomDetails error for ${props.roomId}:`,
        e,
      );
      error.value = e?.message || "获取虎牙房间信息失败";
      roomDetails.value = null;
      await ensureProxyStarted();
      avatarUrl.value = proxify(normalizeAvatarUrl(props.avatar || ""));
      showAvatarText.value = !props.avatar;
    } finally {
      isLoading.value = false;
    }
    return;
  }

  // 新增：B 站主播信息
  if (props.platform === Platform.BILIBILI) {
    try {
      isLoading.value = true;
      error.value = null;
      roomDetails.value = null;
      showAvatarText.value = false;

      const payload = { args: { room_id_str: props.roomId } };
      const savedCookie =
        typeof localStorage !== "undefined"
          ? localStorage.getItem("bilibili_cookie") || null
          : null;
      const res: any = await invoke("fetch_bilibili_streamer_info", {
        payload,
        cookie: savedCookie,
      });

      const mapped: StreamerDetails = {
        roomId: props.roomId,
        platform: "bilibili",
        roomTitle:
          res && res.title ? res.title : (props.title ?? "直播间标题加载中..."),
        nickname:
          res && res.anchor_name
            ? res.anchor_name
            : (props.anchorName ?? props.roomId),
        avatarUrl: res && res.avatar ? res.avatar : (props.avatar ?? null),
        isLive: !!(res && res.status === 1),
      };
      roomDetails.value = mapped;
      await ensureProxyStarted();
      avatarUrl.value = proxify(normalizeAvatarUrl(mapped.avatarUrl));
      showAvatarText.value = !avatarUrl.value;
    } catch (e: any) {
      console.error(
        `[StreamerInfo] BILIBILI fetchRoomDetails error for ${props.roomId}:`,
        e,
      );
      error.value = e?.message || "获取 B 站房间信息失败";
      roomDetails.value = null;
      await ensureProxyStarted();
      avatarUrl.value = proxify(normalizeAvatarUrl(props.avatar || ""));
      showAvatarText.value = !props.avatar;
    } finally {
      isLoading.value = false;
    }
    return;
  }

  isLoading.value = true;
  error.value = null;
  roomDetails.value = null;
  showAvatarText.value = false;

  try {
    if (props.platform === Platform.DOUYU) {
      roomDetails.value = await fetchDouyuStreamerDetails(props.roomId);
      avatarUrl.value = normalizeAvatarUrl(
        roomDetails.value?.avatarUrl || avatarUrl.value,
      );
    } else {
      console.warn(`[StreamerInfo] Unsupported platform: ${props.platform}`);
      throw new Error(`Unsupported platform: ${props.platform}`);
    }

    if (!avatarUrl.value) {
      showAvatarText.value = true;
    }
  } catch (e: any) {
    console.error(
      `[StreamerInfo] Error in fetchRoomDetails for ${props.platform}/${props.roomId}:`,
      e,
    );
    error.value = e.message || "Failed to load streamer details";
    showAvatarText.value = true;
  } finally {
    isLoading.value = false;
  }
};

const toggleFollow = () => {
  if (isFollowing.value) {
    emit("unfollow", props.roomId);
  } else {
    const followData = {
      id: props.roomId,
      platform: props.platform,
      nickname:
        computedNickname.value === "主播昵称加载中..."
          ? props.roomId
          : computedNickname.value,
      avatarUrl: avatarUrl.value,
      roomTitle:
        computedRoomTitle.value === "直播间标题加载中..."
          ? undefined
          : computedRoomTitle.value,
    };
    emit("follow", followData);
  }
};

const handleAvatarError = () => {
  console.warn(
    `[StreamerInfo] Avatar image failed to load for ${computedNickname.value} (URL: ${avatarUrl.value}). Displaying fallback.`,
  );
  showAvatarText.value = true;
};

const idFollowContainerRef = ref<HTMLElement | null>(null);
const streamerIdRef = ref<HTMLElement | null>(null);
const followBtnRef = ref<HTMLElement | null>(null);

const updateHighlightVars = () => {
  if (idFollowContainerRef.value && streamerIdRef.value && followBtnRef.value) {
    const idWidth = streamerIdRef.value.offsetWidth;
    const buttonWidth = followBtnRef.value.offsetWidth;

    idFollowContainerRef.value.style.setProperty("--id-width", `${idWidth}px`);
    idFollowContainerRef.value.style.setProperty(
      "--button-width",
      `${buttonWidth}px`,
    );

    if (isFollowing.value) {
      idFollowContainerRef.value.style.setProperty("--highlight-left", "2px");
      idFollowContainerRef.value.style.setProperty(
        "--highlight-width",
        `calc(${idWidth}px - 4px)`,
      );
    } else {
      idFollowContainerRef.value.style.setProperty(
        "--highlight-left",
        `calc(${idWidth}px + 2px)`,
      );
      idFollowContainerRef.value.style.setProperty(
        "--highlight-width",
        `calc(${buttonWidth}px - 4px)`,
      );
    }
  }
};

onMounted(() => {
  loadBilibiliCookieFromStorage();
  fetchRoomDetails();
  nextTick(() => {
    updateHighlightVars();
  });
});

watch(
  () => [props.roomId, props.platform],
  (newValues, oldValues) => {
    if (newValues[0] !== oldValues[0] || newValues[1] !== oldValues[1]) {
      fetchRoomDetails();
    }
  },
  { deep: true },
);

watch(
  () => [props.title, props.anchorName, props.avatar],
  async (newValues, oldValues) => {
    if (props.platform === Platform.DOUYIN) {
      const hasChanged = newValues.some(
        (val, index) => val !== oldValues[index],
      );
      if (hasChanged) {
        roomDetails.value = await getDouyinStreamerDetails({
          roomId: props.roomId,
          initialTitle: props.title,
          initialAnchorName: props.anchorName,
          initialAvatar: props.avatar,
        });
        avatarUrl.value = normalizeAvatarUrl(
          roomDetails.value?.avatarUrl || avatarUrl.value,
        );
        showAvatarText.value = !avatarUrl.value;
      }
    } else {
      // For non-Douyin platforms, if parent updates avatar prop, reflect it
      if (newValues[2] !== oldValues[2]) {
        avatarUrl.value = normalizeAvatarUrl(props.avatar || "");
        showAvatarText.value = !avatarUrl.value;
      }
    }
  },
);

watch(
  [() => props.roomId, () => props.platform, isFollowing],
  () => {
    nextTick(() => {
      updateHighlightVars();
    });
  },
  { deep: true },
);

watch(
  () => props.avatar,
  (newAvatar, oldAvatar) => {
    if (newAvatar !== oldAvatar) {
      showAvatarText.value = false; // Reset error state if avatar URL changes
    }
    if (newAvatar && showAvatarText.value) {
      showAvatarText.value = false;
    }
  },
);

onUpdated(() => {
  nextTick(() => {
    updateHighlightVars();
  });
});
</script>
