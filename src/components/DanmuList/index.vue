<template>
  <div
    class="flex h-full max-h-full w-full flex-col overflow-hidden rounded-tr-2xl rounded-br-2xl border  border-l-0   max-lg:rounded-[12px] max-lg:border-l">
    <div class="relative flex-1 min-h-0 max-h-full overflow-y-auto px-3 py-2.5 scroll-smooth" ref="danmakuListEl"
      @scroll="handleScroll" @pointerdown="onPointerDown">
      <!-- Empty/Loading Placeholder -->
      <div v-if="(!renderMessages || renderMessages.length === 0)"
        class="absolute left-1/2 top-1/2 w-full -translate-x-1/2 -translate-y-1/2 text-center">
        <p v-if="!props.roomId" class="my-1">请先选择一个直播间</p>
        <p v-else class="my-1">暂无弹幕或连接中...</p> <!-- Simplified placeholder -->
      </div>

      <div v-for="(danmaku, idx) in renderMessages"
        :key="danmaku.id || `${danmaku.room_id || ''}-${danmaku.nickname}-${danmaku.content}-${idx}`"
        class="flex max-w-full cursor-pointer flex-col gap-1 rounded-[12px] px-2.5 py-1.5 text-left transition-transform duration-200 hover:-translate-y-0.5"
        :class="danmaku.isSystem
          ? (danmaku.type === 'success'
            ? 'mt-1 mb-1.5 border-l-0 bg-transparent shadow-none'
            : 'mt-1 mb-1.5 border-l-[3px] border-l-[rgba(57,185,108,0.75)] bg-[rgba(57,185,108,0.16)] shadow-[0_10px_20px_rgba(26,54,39,0.32)]')
          : 'mb-1'" @click="copyDanmaku(danmaku)" title="点击复制弹幕">
        <div class="flex flex-wrap items-center gap-1.5 text-[0.72rem] tracking-[0.01em] text-[rgba(204,212,236,0.72)]"
          v-if="!danmaku.isSystem">
          <span v-if="danmaku.badgeName"
            class="inline-flex items-center rounded-full bg-[linear-gradient(135deg,rgba(92,153,255,0.75),rgba(236,112,214,0.68))] px-2 py-0.5 text-[0.64rem] text-white shadow-[0_6px_14px_rgba(100,140,255,0.24)]">
            <span>{{ danmaku.badgeName }}</span>
            <span v-if="danmaku.badgeLevel" class="ml-1 text-[0.62rem] font-semibold">{{ danmaku.badgeLevel }}</span>
          </span>
          <span class="font-semibold" :style="{ color: danmaku.color || userColor(danmaku.nickname) }">
            <span v-if="danmaku.level" class="mr-1 text-[0.7rem] text-[rgba(166,183,219,0.85)]">[Lv.{{ danmaku.level
            }}]</span>
            {{ danmaku.nickname }}
          </span>
        </div>
        <div class="inline-flex max-w-full text-[0.8rem] leading-[1.4]">
          <span
            class="inline-flex w-fit max-w-full items-center rounded-[12px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.08)] px-2.5 py-1.5 text-[0.84rem] leading-[1.45] text-[rgba(244,246,255,0.94)] [text-shadow:0_1px_2px_rgba(6,9,18,0.6)] whitespace-pre-wrap [word-wrap:break-word] [overflow-wrap:break-word]"
            :class="danmaku.isSystem && danmaku.type === 'success'
              ? 'border-0 bg-transparent p-0 font-semibold text-[#49df85] [text-shadow:none]'
              : danmaku.isSystem
                ? 'text-[rgba(210,240,220,0.95)]'
                : ''">
            <svg v-if="danmaku.isSystem && danmaku.type === 'success'"
              class="mr-2 h-[1.1em] w-[1.1em] align-[-0.15em] text-[#49df85]" xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
            </svg>
            {{ danmaku.content }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>


<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';

interface DanmakuUIMessage {
  id?: string;
  nickname: string;
  content: string;
  level?: string;
  badgeName?: string;
  badgeLevel?: string;
  color?: string;
  isSystem?: boolean; // 系统消息
  type?: string;
  room_id?: string; // 补充房间ID以便 key 生成更稳定
}

const props = defineProps<{
  roomId: string | null;
  messages: DanmakuUIMessage[];
}>();

const danmakuListEl = ref<HTMLElement | null>(null);
const autoScroll = ref(true);
const userScrolled = ref(false);
const pointerActive = ref(false);

const userColor = (nickname: string | undefined) => {
  if (!nickname || nickname.length === 0) {
    const defaultHue = 0;
    const defaultSaturation = 0;
    const defaultLightness = 75;
    return `hsl(${defaultHue}, ${defaultSaturation}%, ${defaultLightness}%)`;
  }
  let hash = 0;
  for (let i = 0; i < nickname.length; i++) {
    hash = nickname.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash;
  }
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 75%)`;
};

const isNearBottom = () => {
  const el = danmakuListEl.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= 40;
};

const handleScroll = () => {
  if (!danmakuListEl.value) return;
  const atBottom = isNearBottom();
  userScrolled.value = !atBottom;
  autoScroll.value = atBottom && !pointerActive.value;
};

watch(autoScroll, (newValue) => {
  if (newValue) {
    userScrolled.value = false;
    scrollToBottomForce();
  }
});

const renderMessages = ref<DanmakuUIMessage[]>([]);
const MAX_MSG = 200;
const PRUNE_BATCH = 100;

const onPointerDown = () => {
  pointerActive.value = true;
  autoScroll.value = false; // 用户主动拖动时暂停自动滚动
  userScrolled.value = true;
};

const onGlobalPointerUp = () => {
  if (pointerActive.value) {
    pointerActive.value = false;
    autoScroll.value = true; // 松开后恢复自动滚动
    userScrolled.value = false;
    scrollToBottomForce();
  }
};

const scrollToBottomForce = () => {
  nextTick(() => {
    const el = danmakuListEl.value;
    if (!el) return;
    // 使用 scrollTo({behavior: 'auto'}) 替代平滑滚动，确保锚点准确
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight; // 双重同步确保
      });
    });
  });
};

watch(() => props.messages, (newMessages, _oldMessages) => {
  const msgs = Array.isArray(newMessages) ? newMessages : [];
  if (msgs.length > MAX_MSG) {
    // 批量裁剪，避免频繁处理导致性能问题
    if (msgs.length % PRUNE_BATCH === 0 || msgs.length > MAX_MSG + PRUNE_BATCH) {
      renderMessages.value = msgs.slice(-MAX_MSG);
    } else {
      renderMessages.value = msgs.slice(-MAX_MSG);
    }
  } else {
    renderMessages.value = msgs;
  }
  if (!pointerActive.value) {
    scrollToBottomForce();
  } else if (autoScroll.value || isNearBottom()) {
    scrollToBottomForce();
  }
}, { deep: true });

watch(() => props.roomId, (_newRoomId, _oldRoomId) => {
  userScrolled.value = false;
  autoScroll.value = true;
  scrollToBottomForce();
});

onMounted(() => {
  scrollToBottomForce();
});

onMounted(() => {
  window.addEventListener('pointerup', onGlobalPointerUp);
});

onUnmounted(() => {
  window.removeEventListener('pointerup', onGlobalPointerUp);
});

const copyDanmaku = async (danmaku: DanmakuUIMessage) => {
  const parts: string[] = [];
  if (danmaku.nickname) {
    const levelStr = danmaku.level ? ` [Lv.${danmaku.level}]` : '';
    parts.push(`${danmaku.nickname}${levelStr}:`);
  }
  parts.push(danmaku.content || '');
  const text = parts.join(' ');

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  } catch (err) {
    console.warn('复制弹幕失败', err);
  }
};

</script>
