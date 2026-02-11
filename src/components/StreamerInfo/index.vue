<template>
    <div class="streamer-info">
      <div class="streamer-layout">
        <div class="avatar-wrapper">
          <img v-if="avatarUrl && !showAvatarText" :src="avatarUrl" :alt="computedNickname" @error="handleAvatarError" class="avatar-img">
          <div v-else class="avatar-fallback">{{ computedNickname.charAt(0).toUpperCase() }}</div>
        </div>
  
        <div class="streamer-details-main">
          <h3 class="room-title" :title="computedRoomTitle">{{ computedRoomTitle }}</h3>
          <div class="streamer-meta-row">
            <span class="streamer-name">{{ computedNickname }}</span>
            <span :class="['status-tag', statusClass]">{{ getStatusText }}</span>
            <!-- Bilibili login button -->
            <span v-if="props.platform === Platform.BILIBILI" class="cookie-status">
              <button
                class="cookie-status-btn"
                @click="handleBilibiliLogin"
                :disabled="isLoggingIn"
                :title="hasRequiredBilibiliCookie ? '点击重新登录' : '登录以同步 Cookie'"
              >
                <span v-if="isLoggingIn" class="cookie-pending">登录中...</span>
                <span v-else-if="hasRequiredBilibiliCookie" class="cookie-configured">
                  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                  已登录
                </span>
                <span v-else class="cookie-unset">
                  登录
                </span>
              </button>
              <button
                v-if="hasRequiredBilibiliCookie && !isLoggingIn"
                class="cookie-clear-btn"
                @click="handleBilibiliLogout"
              >
                退出
              </button>
              <span v-if="loginError" class="cookie-error">{{ loginError }}</span>
            </span>
            <span v-if="computedViewerCount > 0" class="viewers-tag">
              <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5M12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5s5 2.24 5-5s-2.24 5-5 5m0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3s3-1.34 3-3s-1.34-3-3-3"/></svg>
              {{ formattedViewerCount }}
            </span>
          </div>
        </div>
  
        <div class="streamer-actions">
          <div class="id-follow-container" ref="idFollowContainerRef" :class="{ 'highlight-moves-to-id': isFollowing }">
            <span class="streamer-id" ref="streamerIdRef" :class="{ 'text-active-on-highlight': isFollowing }">ID:{{ props.roomId }}</span>
            <button class="follow-btn" ref="followBtnRef" :class="{ 'text-active-on-highlight': !isFollowing, 'is-following': isFollowing }" @click="toggleFollow">
              <span class="follow-icon-wrapper">
                <span class="follow-icon icon-add" v-if="!isFollowing">
                  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M19 12.998h-6v6h-2v-6H5v-2h6v-6h2v6h6z"/></svg>
                </span>
                <span class="follow-icon icon-check" v-else>
                  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M18.3 5.71a.996.996 0 0 0-1.41 0L12 10.59L7.11 5.7A.996.996 0 1 0 5.7 7.11L10.59 12L5.7 16.89a.996.996 0 1 0 1.41 1.41L12 13.41l4.89 4.89a.996.996 0 1 0 1.41-1.41L13.41 12l4.89-4.89c.38-.38.38-1.02 0-1.4z"/></svg>
                </span>
              </span>
              <span class="follow-text">{{ isFollowing ? '取关' : '关注' }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </template>
  
  <style scoped>
.streamer-info {
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 28px 34px 26px;
  box-sizing: border-box;
  position: relative;
  color: var(--primary-text, rgba(244, 247, 255, 0.96));
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  overflow: hidden;
  margin-bottom: 0;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  z-index: 2;
  flex-shrink: 0;
}

.streamer-info::before,
.streamer-info::after {
  display: none;
}

.streamer-info::before {
  background: radial-gradient(120% 85% at -6% -10%, rgba(92, 140, 226, 0.18), transparent 68%);
}

.streamer-info::after {
  background: radial-gradient(110% 65% at 105% 120%, rgba(202, 116, 210, 0.16), transparent 72%);
}

.streamer-layout {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 20px;
  z-index: 1;
}
  
.avatar-wrapper {
  width: 48px;
  height: 48px;
  border-radius: 16px;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: 0 14px 28px rgba(9, 12, 24, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: linear-gradient(135deg, rgba(96, 156, 255, 0.5), rgba(219, 134, 255, 0.34));
  transition: transform 0.25s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.avatar-wrapper:hover {
  transform: translateY(-3px);
  border-color: rgba(255, 255, 255, 0.38);
  box-shadow: 0 18px 32px rgba(9, 12, 24, 0.62);
}
  
  .avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  
  .avatar-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 600;
    color: #ffffff;
    background: linear-gradient(135deg, #ff4757, #ff6b81);
  }
  
.streamer-details-main {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.room-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: rgba(250, 251, 255, 0.98);
  margin: 0;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  letter-spacing: 0.25px;
  text-align: left;
  text-shadow: 0 8px 20px rgba(8, 11, 20, 0.5);
}

.streamer-meta-row {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  color: rgba(202, 210, 232, 0.82);
}

.streamer-name {
  font-size: 0.88rem;
  color: rgba(214, 223, 255, 0.9);
  font-weight: 600;
  letter-spacing: 0.03em;
}

  /* Cookie / login status */
  .cookie-status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  /* Cookie status button */
  .cookie-status-btn {
    font-size: 0.75rem;
    padding: 4px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--secondary-text);
    background: rgba(255, 255, 255, 0.06);
    transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease, transform 0.1s ease;
  }
  .cookie-status-btn:hover {
    background: var(--hover-bg);
    color: var(--primary-text);
    border-color: var(--border-color-light);
    transform: translateY(-1px);
  }
  .cookie-status-btn:active { transform: scale(0.98); }
  .cookie-configured { color: var(--success-color); display: inline-flex; align-items: center; gap: 4px; }
  .cookie-unset { color: var(--secondary-text); }
  .cookie-pending { color: var(--secondary-text); }

  .cookie-clear-btn {
    font-size: 0.75rem;
    padding: 4px 8px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--secondary-text);
    cursor: pointer;
    transition: color 0.2s ease, transform 0.1s ease;
  }
  .cookie-clear-btn:hover {
    color: var(--primary-text);
    transform: translateY(-1px);
  }
  .cookie-clear-btn:active { transform: scale(0.97); }

  .cookie-error {
    font-size: 0.72rem;
    color: var(--error-color, #f87171);
  }
  
  .streamer-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    margin-left: auto;
    flex-shrink: 0;
  }
  
.id-follow-container {
  display: flex;
  align-items: stretch;
  position: relative;
  border-radius: 14px;
  overflow: hidden;
  padding: 2px;
  background: rgba(15, 18, 28, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 14px 28px rgba(9, 12, 24, 0.5);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  --id-width: 110px;
  --button-width: 92px;
  --highlight-left: calc(110px + 2px);
  --highlight-width: calc(92px - 4px);
  min-width: 210px;
}

.id-follow-container::before {
  content: '';
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: var(--highlight-left);
  width: var(--highlight-width);
  background: rgba(114, 169, 255, 0.92);
  border-radius: 12px;
  transition: left 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275), width 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  z-index: 0;
}

  .streamer-id,
  .follow-btn {
    position: relative;
    z-index: 1;
    background: none;
    border: none;
    padding: 8px 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 12px;
    transition: color 0.2s ease-in-out;
  }
  
.follow-btn {
  cursor: pointer;
  min-width: 92px;
  white-space: nowrap; 
  color: rgba(230, 235, 255, 0.92); 
  font-size: 0.82rem; 
  gap: 8px;
}

.streamer-id {
  color: rgba(210, 220, 246, 0.85); 
  font-size: 0.78rem; 
  flex: 1 1 auto; 
  min-width: 90px; 
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap; 
  cursor: default; 
}
  
  .streamer-id.text-active-on-highlight,
  .follow-btn.text-active-on-highlight .follow-text, 
  .follow-btn.text-active-on-highlight .follow-icon-wrapper svg {
    color: white !important;
  }
  
  /* Icon animation styles - preserved */
  .follow-btn .follow-icon-wrapper {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    position: relative; 
    width: 16px; 
    height: 16px; 
  }
  
  .follow-btn .follow-icon {
    display: inline-flex;
    align-items: center; 
    justify-content: center;
    transition: opacity 0.2s ease-in-out, transform 0.2s ease-in-out;
    position: absolute; 
    top: 0; left: 0; width: 100%; height: 100%; 
  }
  
  .follow-btn .follow-icon.icon-add {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }
  .follow-btn.is-following .follow-icon.icon-add {
    opacity: 0;
    transform: scale(0.5) rotate(-90deg);
  }
  
  .follow-btn .follow-icon.icon-check {
    opacity: 0;
    transform: scale(0.5) rotate(90deg);
  }
  .follow-btn.is-following .follow-icon.icon-check {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }
  
  /* .follow-text transition is now part of the general .follow-btn color transition */
  
.status-tag {
  font-size: 0.72rem; 
  padding: 3px 10px; 
  border-radius: 999px; 
  color: #ffffff;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  line-height: 1.3; 
  letter-spacing: 0.05em;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow: none;
  transition: background 0.3s ease, color 0.3s ease, border-color 0.3s ease;
}

.status-tag.live {
  background: linear-gradient(135deg, #35d27a, #23b263);
  border-color: rgba(53, 210, 122, 0.5);
}

.status-tag.replay {
  background: linear-gradient(135deg, #5a7aff, #7c5dff);
  border-color: rgba(96, 118, 255, 0.45);
}

.status-tag.looping {
  background: linear-gradient(135deg, #8091ff, #a071ff);
  border-color: rgba(128, 145, 255, 0.4);
}

.status-tag.offline {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(225, 229, 243, 0.78);
  border-color: rgba(255, 255, 255, 0.12);
}

.viewers-tag {
  font-size: 0.78rem;
  color: rgba(216, 224, 253, 0.88);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(12, 16, 28, 0.65);
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 12px 24px rgba(8, 10, 20, 0.35);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.viewers-tag svg {
  width: 13px;
  height: 13px;
  opacity: 0.9;
}

@media (max-width: 1024px) {
  .streamer-info {
    max-width: 100%;
    padding: 24px 26px 30px;
    margin-bottom: -18px;
    border-bottom-left-radius: 22px;
    border-bottom-right-radius: 22px;
  }

  .streamer-layout {
    gap: 18px;
  }
}

@media (max-width: 768px) {
  .streamer-info {
    max-width: 100%;
    padding: 22px 20px 26px;
    margin-bottom: -14px;
    border-bottom-left-radius: 18px;
    border-bottom-right-radius: 18px;
  }

  .streamer-layout {
    gap: 16px;
  }

  .avatar-wrapper {
    width: 48px;
    height: 48px;
  }

  .room-title {
    font-size: 0.95rem;
  }

  .streamer-name {
    font-size: 0.82rem;
  }
}

  @keyframes idPulse {
    0% { text-shadow: 0 0 2px rgba(251, 114, 153, 0); }
    50% { text-shadow: 0 0 6px rgba(251, 114, 153, 0.7); }
    100% { text-shadow: 0 0 2px rgba(251, 114, 153, 0); }
  }

  :root[data-theme="light"] .streamer-info {
    color: var(--primary-text-light, #1f2937);
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
  }

  :root[data-theme="light"] .streamer-name {
    color: rgba(55, 65, 81, 0.95);
  }

  :root[data-theme="light"] .room-title {
    color: var(--primary-text-light, #1f2937);
    text-shadow: none;
  }

  :root[data-theme="light"] .streamer-meta-row {
    color: rgba(71, 85, 105, 0.85);
  }

  :root[data-theme="light"] .avatar-wrapper {
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12);
    border: 1px solid rgba(189, 200, 224, 0.6);
    background: linear-gradient(135deg, rgba(136, 188, 255, 0.5), rgba(213, 157, 255, 0.38));
  }

  :root[data-theme="light"] .avatar-wrapper:hover {
    border-color: rgba(136, 188, 255, 0.65);
  }

  :root[data-theme="light"] .avatar-fallback {
    color: var(--primary-text-light, #1f2937);
    background: linear-gradient(135deg, #dae4ff, #f2f5ff);
  }

  :root[data-theme="light"] .id-follow-container {
    background: rgba(255, 255, 255, 0.94);
    border: 1px solid rgba(189, 200, 224, 0.6);
    box-shadow: 0 14px 24px rgba(15, 23, 42, 0.1);
  }

  :root[data-theme="light"] .id-follow-container::before {
    background: rgba(132, 192, 255, 0.92);
  }

  :root[data-theme="light"] .streamer-id {
    color: rgba(71, 85, 105, 0.85);
  }

  :root[data-theme="light"] .follow-btn {
    color: rgba(33, 45, 68, 0.9);
  }

  :root[data-theme="light"] .streamer-id.text-active-on-highlight,
  :root[data-theme="light"] .follow-btn.text-active-on-highlight .follow-text,
  :root[data-theme="light"] .follow-btn.text-active-on-highlight .follow-icon-wrapper svg {
    color: #ffffff !important;
  }

  :root[data-theme="light"] .status-tag {
    background: rgba(15, 23, 42, 0.07);
    color: rgba(31, 41, 55, 0.95);
    border-color: rgba(15, 23, 42, 0.12);
  }

  :root[data-theme="light"] .status-tag.live {
    background: linear-gradient(135deg, #27c169, #44d980);
    color: #ffffff;
    border-color: rgba(39, 193, 105, 0.45);
  }

  :root[data-theme="light"] .status-tag.replay {
    background: linear-gradient(135deg, #5d7dff, #7485ff);
    color: #ffffff;
    border-color: rgba(93, 125, 255, 0.38);
  }

  :root[data-theme="light"] .status-tag.looping {
    background: linear-gradient(135deg, #8a98ff, #a588ff);
    color: #ffffff;
    border-color: rgba(138, 152, 255, 0.36);
  }

  :root[data-theme="light"] .status-tag.offline {
    background: rgba(15, 23, 42, 0.08);
    color: rgba(71, 85, 105, 0.85);
    border-color: rgba(15, 23, 42, 0.12);
  }

  :root[data-theme="light"] .viewers-tag {
    color: rgba(55, 65, 81, 0.88);
    background: rgba(15, 23, 42, 0.06);
    border-color: rgba(15, 23, 42, 0.08);
    box-shadow: 0 10px 20px rgba(15, 23, 42, 0.08);
  }

  :root[data-theme="light"] .viewers-tag svg {
    color: rgba(71, 85, 105, 0.85);
    opacity: 1;
  }

  :root[data-theme="light"] .success-icon {
    fill: var(--system-success-text-light, #2f8f46);
  }

  :root[data-theme="light"] .connection-status-placeholder.success {
    color: var(--system-success-text-light, #2f8f46);
  }
  </style>
  
  <script setup lang="ts">
  import { ref, computed, onBeforeUnmount, onMounted, watch, onUpdated, nextTick } from 'vue'
  import { Platform } from '../../platforms/common/types'
  import type { StreamerDetails } from '../../platforms/common/types'
  import { fetchDouyuStreamerDetails } from '../../platforms/douyu/streamerInfoParser'
  import { getDouyinStreamerDetails } from '../../platforms/douyin/streamerInfoParser'
  import { invoke } from '@tauri-apps/api/core'
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import {
    ensureBilibiliLoginWindow,
    extractRequiredFlags,
    getBilibiliCookies,
    hasRequiredCookies,
    sleep,
  } from '../../platforms/bilibili/cookieHelper'

  // Helper: normalize avatar URL (strip wrappers/backticks, fix protocol)
  const normalizeAvatarUrl = (input: string | null | undefined): string => {
    if (!input) return ''
    let url = String(input).trim()
    // strip wrapping backticks or quotes
    const startsWithWrapper = url.startsWith('`') || url.startsWith('"') || url.startsWith("'")
    const endsWithWrapper = url.endsWith('`') || url.endsWith('"') || url.endsWith("'")
    if (startsWithWrapper && endsWithWrapper) {
      url = url.slice(1, -1).trim()
    }
    // handle protocol-relative URLs
    if (url.startsWith('//')) {
      url = 'https:' + url
    }
    // upgrade http to https
    if (url.startsWith('http://')) {
      url = 'https://' + url.slice('http://'.length)
    }
    // remove any whitespace inside the URL
    url = url.replace(/\s+/g, '')
    return url
  }
  const emit = defineEmits<{
    (e: 'follow', data: { id: string; platform: Platform; nickname: string; avatarUrl: string | null; roomTitle?: string }): void
    (e: 'unfollow', roomId: string): void
    (e: 'details', data: { title: string; nickname: string; avatarUrl: string | null; isLive: boolean | null }): void
  }>()
  
  const props = defineProps<{
    roomId: string
    platform: Platform
    isFollowed: boolean
    title?: string | null
    anchorName?: string | null
    avatar?: string | null
    isLive?: boolean | null
    initialViewerCount?: number | null
  }>()
  
  const roomDetails = ref<StreamerDetails | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const showAvatarText = ref(false)
  
  const computedRoomTitle = computed(() => roomDetails.value?.roomTitle ?? props.title ?? '直播间标题加载中...')
  const computedNickname = computed(() => roomDetails.value?.nickname ?? props.anchorName ?? '主播昵称加载中...')
  const avatarUrl = ref(props.avatar || '')
  const computedViewerCount = computed(() => roomDetails.value?.viewerCount ?? 0)
  const isFollowing = computed(() => props.isFollowed)
  const computedStreamStatus = computed(() => {
    if (roomDetails.value) {
      if (roomDetails.value.isLive && roomDetails.value.isLooping) {
        return 'looping';
      }
      if (roomDetails.value.isLive) {
        return 'live';
      }
    } else if (props.isLive) { 
      return 'live';
    }
    return 'offline';
  });

  const statusClass = computed(() => {
    return computedStreamStatus.value;
  })
  
  const getStatusText = computed(() => {
    if (error.value) return '信息加载失败';
    const status = computedStreamStatus.value;
    if (status === 'live') return '直播中';
    if (status === 'looping') return '轮播中';
    return '未开播';
  })
  
  const formattedViewerCount = computed(() => {
    const count = computedViewerCount.value
    if (count >= 10000) {
      return (count / 10000).toFixed(1) + '万'
    }
    return count.toString()
  })

  // Proxy support for Bilibili avatar images
  const proxyBase = ref<string | null>(null)
  const ensureProxyStarted = async () => {
    if (!proxyBase.value) {
      try {
        const base = await invoke<string>('start_static_proxy_server')
        proxyBase.value = base
      } catch (e) {
        console.error('[StreamerInfo] Failed to start static proxy server', e)
      }
    }
  }
  const proxify = (url?: string): string => {
    if (!url) return ''
    if (proxyBase.value) {
      return `${proxyBase.value}/image?url=${encodeURIComponent(url)}`
    }
    return url
  }

  // Bilibili login state
  const bilibiliCookie = ref<string>('')
  const hasRequiredBilibiliCookie = ref(false)
  const isLoggingIn = ref(false)
  const loginError = ref<string | null>(null)

  const updateBilibiliCookieState = (raw: string | null | undefined) => {
    const value = (raw ?? '').trim()
    bilibiliCookie.value = value
    const { hasSessdata, hasBiliJct } = extractRequiredFlags(value)
    hasRequiredBilibiliCookie.value = hasSessdata && hasBiliJct
  }

  const persistBilibiliCookie = (raw: string | null | undefined) => {
    if (typeof localStorage === 'undefined') return
    const value = (raw ?? '').trim()
    if (value) {
      localStorage.setItem('bilibili_cookie', value)
    } else {
      localStorage.removeItem('bilibili_cookie')
    }
    updateBilibiliCookieState(value)
  }

  const loadBilibiliCookieFromStorage = () => {
    if (typeof localStorage === 'undefined') return
    const saved = localStorage.getItem('bilibili_cookie')
    updateBilibiliCookieState(saved)
  }

  const handleBilibiliLogout = async () => {
    loginError.value = null
    persistBilibiliCookie(null)
    if (props.platform === Platform.BILIBILI) {
      await fetchRoomDetails()
    }
  }

  const handleBilibiliLogin = async () => {
    if (isLoggingIn.value) return
    loginError.value = null
    isLoggingIn.value = true

    let unlisten: UnlistenFn | null = null

    try {
      const loginWindow = await ensureBilibiliLoginWindow()
      let windowClosed = false

      unlisten = await loginWindow.listen('tauri://close-requested', () => {
        windowClosed = true
      })

      const timeoutMs = 120_000
      const intervalMs = 1_500
      const deadline = Date.now() + timeoutMs

      while (!windowClosed && Date.now() < deadline) {
        const result = await getBilibiliCookies([loginWindow.label])
        if (hasRequiredCookies(result)) {
          persistBilibiliCookie(result.cookie)
          try {
            await loginWindow.close()
          } catch (closeErr) {
            console.warn('[StreamerInfo] Failed to close bilibili login window:', closeErr)
          }
          if (props.platform === Platform.BILIBILI) {
            await fetchRoomDetails()
          }
          return
        }
        await sleep(intervalMs)
      }

      if (windowClosed) {
        throw new Error('登录窗口已关闭，未完成登录')
      }

      throw new Error('登录超时，请重试')
    } catch (e: any) {
      loginError.value = e?.message || '登录失败，请重试'
      console.error('[StreamerInfo] handleBilibiliLogin error:', e)
    } finally {
      if (unlisten) {
        try {
          unlisten()
        } catch (_) {
          /* no-op */
        }
      }
      isLoggingIn.value = false
    }
  }

  const emitDetails = (details: StreamerDetails | null) => {
    if (!details) {
      return
    }
    emit('details', {
      title: details.roomTitle || props.title || '',
      nickname: details.nickname || props.anchorName || '',
      avatarUrl: avatarUrl.value || details.avatarUrl || props.avatar || null,
      isLive: typeof details.isLive === 'boolean' ? details.isLive : (props.isLive ?? null),
    })
  }
  
  const fetchRoomDetails = async () => {
    if (props.platform === Platform.DOUYIN) {
      showAvatarText.value = !props.avatar;
      isLoading.value = false;
      roomDetails.value = null;
      avatarUrl.value = props.avatar || '';
      return;
    }

    if (props.platform === Platform.HUYA) {
      try {
        isLoading.value = true;
        error.value = null;
        roomDetails.value = null;
        showAvatarText.value = false;

        const res: any = await invoke('get_huya_unified_cmd', { roomId: props.roomId, quality: '原画' });
        const mapped: StreamerDetails = {
          roomId: props.roomId,
          platform: 'huya',
          roomTitle: (res && res.title) ? res.title : (props.title ?? '直播间标题加载中...'),
          nickname: (res && res.nick) ? res.nick : (props.anchorName ?? props.roomId),
          avatarUrl: (res && res.avatar) ? res.avatar : (props.avatar ?? null),
          isLive: !!(res && res.is_live),
        };
        roomDetails.value = mapped;
        await ensureProxyStarted();
        avatarUrl.value = proxify(normalizeAvatarUrl(mapped.avatarUrl));
        showAvatarText.value = !avatarUrl.value;
        emitDetails(mapped);
      } catch (e: any) {
        console.error(`[StreamerInfo] HUYA fetchRoomDetails error for ${props.roomId}:`, e);
        error.value = e?.message || '获取虎牙房间信息失败';
        roomDetails.value = null;
        await ensureProxyStarted();
        avatarUrl.value = proxify(normalizeAvatarUrl(props.avatar || ''));
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
        const savedCookie = (typeof localStorage !== 'undefined') ? (localStorage.getItem('bilibili_cookie') || null) : null;
        const res: any = await invoke('fetch_bilibili_streamer_info', {
          payload,
          cookie: savedCookie,
        });

        const mapped: StreamerDetails = {
          roomId: props.roomId,
          platform: 'bilibili',
          roomTitle: (res && res.title) ? res.title : (props.title ?? '直播间标题加载中...'),
          nickname: (res && res.anchor_name) ? res.anchor_name : (props.anchorName ?? props.roomId),
          avatarUrl: (res && res.avatar) ? res.avatar : (props.avatar ?? null),
          isLive: !!(res && res.status === 1),
        };
        roomDetails.value = mapped;
        await ensureProxyStarted();
        avatarUrl.value = proxify(normalizeAvatarUrl(mapped.avatarUrl));
        showAvatarText.value = !avatarUrl.value;
        emitDetails(mapped);
      } catch (e: any) {
        console.error(`[StreamerInfo] BILIBILI fetchRoomDetails error for ${props.roomId}:`, e);
        error.value = e?.message || '获取 B 站房间信息失败';
        roomDetails.value = null;
        await ensureProxyStarted();
        avatarUrl.value = proxify(normalizeAvatarUrl(props.avatar || ''));
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
        avatarUrl.value = normalizeAvatarUrl(roomDetails.value?.avatarUrl || avatarUrl.value);
        emitDetails(roomDetails.value);
      } else {
        console.warn(`[StreamerInfo] Unsupported platform: ${props.platform}`);
        throw new Error(`Unsupported platform: ${props.platform}`);
      }

      if (!avatarUrl.value) {
        showAvatarText.value = true
      }

    } catch (e: any) {
      console.error(`[StreamerInfo] Error in fetchRoomDetails for ${props.platform}/${props.roomId}:`, e)
      error.value = e.message || 'Failed to load streamer details'
      showAvatarText.value = true
    } finally {
      isLoading.value = false
    }
  }
  
  const toggleFollow = () => {
    if (isFollowing.value) {
      emit('unfollow', props.roomId)
    } else {
      const followData = {
        id: props.roomId,
        platform: props.platform,
        nickname: computedNickname.value === '主播昵称加载中...' ? props.roomId : computedNickname.value,
        avatarUrl: avatarUrl.value,
        roomTitle: computedRoomTitle.value === '直播间标题加载中...' ? undefined : computedRoomTitle.value,
      }
      emit('follow', followData)
    }
  }
  
  const handleAvatarError = () => {
    console.warn(`[StreamerInfo] Avatar image failed to load for ${computedNickname.value} (URL: ${avatarUrl.value}). Displaying fallback.`);
    showAvatarText.value = true;
  };
  
  const idFollowContainerRef = ref<HTMLElement | null>(null);
  const streamerIdRef = ref<HTMLElement | null>(null);
  const followBtnRef = ref<HTMLElement | null>(null);
  
  let highlightUpdateRaf: number | null = null
  const scheduleHighlightUpdate = () => {
    if (typeof window === 'undefined') return
    if (highlightUpdateRaf !== null) return
    highlightUpdateRaf = window.requestAnimationFrame(() => {
      highlightUpdateRaf = null
      updateHighlightVars()
    })
  }

  const updateHighlightVars = () => {
    if (idFollowContainerRef.value && streamerIdRef.value && followBtnRef.value) {
      const idWidth = streamerIdRef.value.offsetWidth;
      const buttonWidth = followBtnRef.value.offsetWidth;

      idFollowContainerRef.value.style.setProperty('--id-width', `${idWidth}px`);
      idFollowContainerRef.value.style.setProperty('--button-width', `${buttonWidth}px`);

      if (isFollowing.value) {
        idFollowContainerRef.value.style.setProperty('--highlight-left', '2px');
        idFollowContainerRef.value.style.setProperty('--highlight-width', `calc(${idWidth}px - 4px)`);
      } else {
        idFollowContainerRef.value.style.setProperty('--highlight-left', `calc(${idWidth}px + 2px)`);
        idFollowContainerRef.value.style.setProperty('--highlight-width', `calc(${buttonWidth}px - 4px)`);
      }
    }
  };
  
  onMounted(() => {
    loadBilibiliCookieFromStorage()
    fetchRoomDetails()
    nextTick(() => {
      scheduleHighlightUpdate();
    });
  })
  
  watch(() => [props.roomId, props.platform], (newValues, oldValues) => {
    if (newValues[0] !== oldValues[0] || newValues[1] !== oldValues[1]) {
      fetchRoomDetails()
    }
  }, { deep: true })

  watch(() => [props.title, props.anchorName, props.avatar], async (newValues, oldValues) => {
    if (props.platform === Platform.DOUYIN) {
      const hasChanged = newValues.some((val, index) => val !== oldValues[index])
      if (hasChanged) {
        roomDetails.value = await getDouyinStreamerDetails({
          roomId: props.roomId,
          initialTitle: props.title,
          initialAnchorName: props.anchorName,
          initialAvatar: props.avatar,
        })
        avatarUrl.value = normalizeAvatarUrl(roomDetails.value?.avatarUrl || avatarUrl.value)
        showAvatarText.value = !avatarUrl.value
      }
    } else {
      // For non-Douyin platforms, if parent updates avatar prop, reflect it
      if (newValues[2] !== oldValues[2]) {
        avatarUrl.value = normalizeAvatarUrl(props.avatar || '')
        showAvatarText.value = !avatarUrl.value
      }
    }
  })

  watch([() => props.roomId, () => props.platform, isFollowing], () => {
    nextTick(() => {
      scheduleHighlightUpdate();
    });
  }, { deep: true })

  watch(() => props.avatar, (newAvatar, oldAvatar) => {
    if (newAvatar !== oldAvatar) {
      showAvatarText.value = false; // Reset error state if avatar URL changes
    }
    if (newAvatar && showAvatarText.value) {
      showAvatarText.value = false;
    }
  });

  onUpdated(() => {
    nextTick(() => {
      scheduleHighlightUpdate();
    });
  })

  onBeforeUnmount(() => {
    if (highlightUpdateRaf !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(highlightUpdateRaf)
      highlightUpdateRaf = null
    }
  })
  </script>
