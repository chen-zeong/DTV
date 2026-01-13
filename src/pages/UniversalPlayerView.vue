<template>
  <div class="flex h-full w-full flex-1 flex-col items-stretch justify-center bg-transparent text-center">
    <!-- Main Player Component -->
    <MainPlayer v-if="roomId && !isLoadingDetails" :room-id="roomId" :platform="platform" :is-followed="isFollowed"
      :title="streamerDetails?.roomTitle ?? undefined" :anchor-name="streamerDetails?.nickname ?? undefined"
      :avatar="streamerDetails?.avatarUrl ?? undefined" :is-live="streamerDetails?.isLive ?? undefined"
      :initial-error="detailsError" :cookie="cookieInput" @follow="handleFollow" @unfollow="handleUnfollow"
      @close-player="handleClosePlayer" @fullscreen-change="handlePlayerFullscreenChange"
      @request-refresh-details="handleRefreshDetails" @request-player-reload="handlePlayerReload" />

    <!-- Loading State -->
    <div v-else-if="roomId && isLoadingDetails" class="flex flex-1 items-center justify-center">
      <LoadingDots />
    </div>

    <!-- Error State -->
    <div v-else-if="detailsError" class="flex flex-1 flex-col items-center justify-center gap-3">
      <p class="px-5 text-[1.1em]">错误: {{ detailsError }}</p>
      <button class="mt-2 rounded-md  px-5 py-2.5 text-base text-white" @click="handleClosePlayer">返回</button>
    </div>

    <!-- Invalid ID State -->
    <div v-else class="flex flex-1 flex-col items-center justify-center gap-3">
      <p class="px-5 text-[1.1em]">无效的房间ID。</p>
      <button class="mt-2 rounded-md  px-5 py-2.5 text-base text-white" @click="handleClosePlayer">返回</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import MainPlayer from '../components/player/index.vue';
import LoadingDots from '../components/Common/LoadingDots.vue';
import { useFollowStore } from '../stores/followStore';
import { Platform, type FollowedStreamer, type StreamerDetails } from '../platforms/common/types';

// Platform-specific parsers/helpers
import { fetchDouyuStreamerDetails } from '../platforms/douyu/streamerInfoParser';
import { getDouyinStreamerDetails } from '../platforms/douyin/streamerInfoParser';
import { ensureBilibiliCookieBootstrap } from '../platforms/bilibili/cookieHelper';

const props = defineProps<{
  roomId: string;
  platform: Platform;
}>();

const emit = defineEmits(['fullscreen-change']);

const router = useRouter();
const followStore = useFollowStore();

// State
const streamerDetails = ref<StreamerDetails | null>(null);
const isLoadingDetails = ref(false);
const detailsError = ref<string | null>(null);
const playerKey = ref(0);
const cookieInput = ref<string>('');

// Follow State
const isFollowed = computed(() => {
  return followStore.isFollowed(props.platform, props.roomId);
});

// Logic to load streamer details based on platform
const loadStreamerDetails = async (currentRoomId: string) => {
  if (!currentRoomId) {
    resetState('Room ID is invalid.');
    return;
  }

  // Skip fetching if we already have data for this room (unless it's a reload)
  if (streamerDetails.value?.roomId === currentRoomId && !detailsError.value) {
    return;
  }

  // Platforms without detail fetchers (yet)
  if (props.platform === Platform.HUYA || props.platform === Platform.BILIBILI) {
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
      // Douyin parser requires an object
      result = await getDouyinStreamerDetails({ roomId: currentRoomId });
    }

    if (result?.errorMessage) {
      detailsError.value = result.errorMessage;
    } else if (!result || (!result.nickname && props.platform === Platform.DOUYU)) {
      // Douyu specifically checks for nickname validity
      detailsError.value = '获取到的主播信息无效或不完整。';
    } else {
      streamerDetails.value = result;
    }
  } catch (e: any) {
    console.error(`[UniversalPlayerView] Exception loading details for ${currentRoomId} on ${props.platform}:`, e);
    detailsError.value = e.message || '加载主播详情时发生未知错误。';
  } finally {
    isLoadingDetails.value = false;
  }
};

const resetState = (error: string | null = null) => {
  streamerDetails.value = null;
  detailsError.value = error;
  isLoadingDetails.value = false;
};

// Event Handlers
interface MainPlayerFollowEventData {
  nickname: string;
  avatarUrl: string;
  roomTitle?: string;
}

const handleFollow = (data: MainPlayerFollowEventData) => {
  // Use data from fetcher if available, otherwise fallback to player event data (or defaults)
  const nickname = streamerDetails.value?.nickname || data.nickname || `主播${props.roomId}`;
  const avatarUrl = streamerDetails.value?.avatarUrl || data.avatarUrl || '';
  const roomTitle = streamerDetails.value?.roomTitle || data.roomTitle;

  const streamerToFollow: FollowedStreamer = {
    id: props.roomId,
    platform: props.platform,
    nickname,
    avatarUrl,
    roomTitle,
  };
  followStore.followStreamer(streamerToFollow);
};

const handleUnfollow = () => {
  followStore.unfollowStreamer(props.platform, props.roomId);
};

const handleClosePlayer = () => {
  // Route back to the specific platform home
  const homeRoutes: Record<Platform, string> = {
    [Platform.DOUYU]: '/',
    [Platform.DOUYIN]: '/douyin',
    [Platform.HUYA]: '/huya',
    [Platform.BILIBILI]: '/bilibili',
  };
  router.replace(homeRoutes[props.platform] || '/');
};

const handlePlayerFullscreenChange = (isFullscreen: boolean) => {
  emit('fullscreen-change', isFullscreen);
};

const handleRefreshDetails = () => {
  loadStreamerDetails(props.roomId);
};

const handlePlayerReload = () => {
  playerKey.value++;
  loadStreamerDetails(props.roomId);
};

// Watchers & Lifecycle
watch(() => props.roomId, (newId) => {
  if (newId) loadStreamerDetails(newId);
}, { immediate: true });

onMounted(async () => {
  // Platform-specific setup
  if (props.platform === Platform.BILIBILI) {
    if (typeof localStorage !== 'undefined') {
      let stored = (localStorage.getItem('bilibili_cookie') || '').trim();
      if (stored) cookieInput.value = stored;

      const result = await ensureBilibiliCookieBootstrap();
      if (!stored && result?.cookie) {
        stored = result.cookie.trim();
        if (stored) {
          localStorage.setItem('bilibili_cookie', stored);
          cookieInput.value = stored;
        }
      }
    }
  }
});
</script>
