<template>
  <div
    class="flex h-full w-full flex-1 flex-col items-stretch justify-center bg-app-bg text-center text-text-main"
  >
    <!-- UniversalPlayerView is now a marker component. 
         The actual player is rendered globally in App.vue via PlayerManager 
         to keep the DOM persistent for background playback. -->
    
    <!-- Loading State for Metadata -->
    <div
      v-if="isLoadingDetails"
      class="flex flex-1 items-center justify-center"
    >
      <LoadingDots />
    </div>

    <!-- Error State -->
    <div
      v-else-if="detailsError"
      class="flex flex-1 flex-col items-center justify-center gap-3"
    >
      <p class="px-5 text-[1.1em] font-medium text-text-main">
        错误: {{ detailsError }}
      </p>
      <button
        class="mt-2 rounded-md bg-brand px-5 py-2.5 text-base text-white shadow-lg shadow-brand/20 hover:bg-brand-hover"
        @click="handleClosePlayer"
      >
        返回
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { useRouter } from "vue-router";
import LoadingDots from "../components/ui/LoadingDots.vue";
import { usePlayerStore } from "../store/playerStore";
import { Platform } from "../types/app/platform";
import type {
  StreamerDetails,
} from "../types/models/streamer";

// Platform-specific parsers/helpers
import { fetchDouyuStreamerDetails } from "../services/platforms/douyu/streamerInfoParser";
import { getDouyinStreamerDetails } from "../services/platforms/douyin/streamerInfoParser";
import { ensureBilibiliCookieBootstrap } from "../services/platforms/bilibili/cookieHelper";

defineOptions({
  name: "UniversalPlayerView",
});

const props = defineProps<{
  roomId: string;
  platform: Platform;
}>();

const emit = defineEmits(["fullscreen-change"]);

const router = useRouter();
const playerStore = usePlayerStore();

// State
const streamerDetails = ref<StreamerDetails | null>(null);
const isLoadingDetails = ref(false);
const detailsError = ref<string | null>(null);
const cookieInput = ref<string>("");

// Logic to load streamer details based on platform
const loadStreamerDetails = async (currentRoomId: string) => {
  if (!currentRoomId) {
    resetState("Room ID is invalid.");
    return;
  }

  // Skip fetching if we already have data for this room in store
  if (playerStore.isActive(props.platform, currentRoomId) && !detailsError.value) {
    return;
  }

  // Platforms without detail fetchers (yet)
  if (
    props.platform === Platform.HUYA ||
    props.platform === Platform.BILIBILI
  ) {
    // For these platforms, we still want to "register" them in the store 
    // even if we don't have metadata yet. VideoPlayer will fetch more.
    playerStore.setStreamerInfo({
      roomId: currentRoomId,
      platform: props.platform,
      title: "正在加载...",
      anchorName: "加载中",
      avatar: "",
      isLive: true
    });
    isLoadingDetails.value = false;
    return;
  }

  isLoadingDetails.value = true;
  detailsError.value = null;
  streamerDetails.value = null;

  try {
    let result: StreamerDetails | null = null;

    if (props.platform === Platform.DOUYU) {
      result = await fetchDouyuStreamerDetails(currentRoomId);
    } else if (props.platform === Platform.DOUYIN) {
      result = await getDouyinStreamerDetails({ roomId: currentRoomId });
    }

    if (result?.errorMessage) {
      detailsError.value = result.errorMessage;
    } else if (
      !result ||
      (!result.nickname && props.platform === Platform.DOUYU)
    ) {
      detailsError.value = "获取到的主播信息无效或不完整。";
    } else {
      streamerDetails.value = result;
      // Sync to global store to trigger PlayerManager rendering
      playerStore.setStreamerInfo({
        roomId: result.roomId,
        platform: props.platform,
        title: result.roomTitle,
        anchorName: result.nickname,
        avatar: result.avatarUrl || "",
        isLive: result.isLive
      });
    }
  } catch (e: any) {
    console.error(
      `[UniversalPlayerView] Exception loading details for ${currentRoomId} on ${props.platform}:`,
      e,
    );
    detailsError.value = e.message || "加载主播详情时发生未知错误。";
  } finally {
    isLoadingDetails.value = false;
  }
};

const resetState = (error: string | null = null) => {
  streamerDetails.value = null;
  detailsError.value = error;
  isLoadingDetails.value = false;
};

const handleClosePlayer = () => {
  router.replace("/");
};

// Watchers & Lifecycle
watch(
  () => props.roomId,
  (newId) => {
    if (newId) loadStreamerDetails(newId);
  },
  { immediate: true },
);

onMounted(async () => {
  // Platform-specific setup
  if (props.platform === Platform.BILIBILI) {
    if (typeof localStorage !== "undefined") {
      let stored = (localStorage.getItem("bilibili_cookie") || "").trim();
      if (stored) cookieInput.value = stored;

      const result = await ensureBilibiliCookieBootstrap();
      if (!stored && result?.cookie) {
        stored = result.cookie.trim();
        if (stored) {
          localStorage.setItem("bilibili_cookie", stored);
          cookieInput.value = stored;
        }
      }
    }
  }
});
</script>
