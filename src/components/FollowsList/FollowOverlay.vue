<template>
  <teleport to="body">
    <transition
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="show"
        class="fixed inset-0 z-[1200] bg-[rgba(0,0,0,0.4)] [backdrop-filter:blur(8px)]"
        @click.self="emit('close')"
      >
        <transition
          enter-from-class="opacity-0 scale-90 translate-y-5"
          enter-to-class="opacity-100 scale-100 translate-y-0"
          leave-from-class="opacity-100 scale-100 translate-y-0"
          leave-to-class="opacity-0 scale-90 translate-y-5"
        >
          <div
            ref="panelRef"
            class="fixed z-1200 w-[min(1180px,calc(100vw-48px))] [transform:translateZ(0)] border"
            :style="{
              top: `${panelTop}px`,
              left: `${panelLeft}px`,
              height: `${panelHeight}px`,
            }"
          >
            <!-- 将关闭按钮移动到面板右上角 -->
            <button
              class="absolute -top-5 -right-5 z-[1100] flex h-11 w-11 items-center justify-center rounded-full border hover:scale-110 hover:rotate-180"
              title="关闭"
              @click="emit('close')"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
            <div
              class="flex items-center justify-start gap-4 border-b-0 px-8 py-5"
              ref="headerRef"
            >
              <div class="flex min-w-0 flex-1 items-center gap-3">
                <!-- 移除标题：关注列表 -->
                <slot name="filters"></slot>
              </div>
              <div class="flex items-center gap-4">
                <button
                  class="inline-flex items-center gap-2 rounded-[12px] border px-[18px] py-2 text-[13px] font-semibold hover:-translate-y-0.5"
                  :class="
                    props.isDeleteMode ? 'border-transparent text-white' : ''
                  "
                  @click="emit('toggle-remove')"
                >
                  <span>{{ props.isDeleteMode ? "完成" : "管理" }}</span>
                </button>
                <button
                  class="inline-flex items-center gap-2 rounded-[12px] border px-[18px] py-2 text-[13px] font-semibold hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="isRefreshing"
                  @click="emit('refresh')"
                >
                  <span>刷新</span>
                  <span
                    class="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent"
                    :class="isRefreshing ? 'visible animate-spin' : 'invisible'"
                  ></span>
                </button>
                <!-- 原关闭按钮已移除到面板右上角 -->
              </div>
            </div>
            <div
              class="overflow-auto px-8 pt-3 pb-[92px] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-[10px]"
              :style="{
                height: `${Math.max(120, panelHeight - headerHeight)}px`,
                overflow: shouldScroll ? 'auto' : 'hidden',
              }"
            >
              <div
                v-if="!items || items.length === 0"
                class="flex flex-col items-center justify-center gap-5 px-10 py-20"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="feather feather-heart"
                >
                  <path
                    d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
                  ></path>
                </svg>
                <p class="text-[18px] font-bold">暂无关注主播</p>
                <p>当前筛选下暂无关注主播</p>
              </div>
              <ul
                v-else
                class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3"
                ref="listEl"
              >
                <li
                  v-for="s in items"
                  :key="s.id"
                  class="relative overflow-hidden border hover:-translate-y-0.5"
                  @click="handleSelect(s)"
                >
                  <button
                    v-if="props.isDeleteMode"
                    class="absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-[#ef4444] text-[16px] font-bold text-white shadow-[0_2px_8px_rgba(239,68,68,0.3)] hover:scale-110 hover:rotate-90 hover:bg-[#dc2626]"
                    title="删除"
                    @click.stop="emit('remove', s)"
                  >
                    ×
                  </button>
                  <StreamerItem
                    :streamer="s"
                    :getAvatarSrc="getAvatarSrc"
                    :handleImgError="handleImgError"
                    :getLiveIndicatorClass="getLiveIndicatorClass"
                    :proxyBase="proxyBase"
                    :big="false"
                    :showPlatform="false"
                    @clickItem="() => handleSelect(s)"
                  />
                </li>
              </ul>
            </div>
          </div>
        </transition>
      </div>
    </transition>
  </teleport>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import type { FollowedStreamer } from "../../platforms/common/types";
import StreamerItem from "./StreamerItem.vue";

const props = defineProps<{
  show: boolean;
  items: FollowedStreamer[];
  getAvatarSrc: (s: FollowedStreamer) => string;
  handleImgError: (ev: Event, s: FollowedStreamer) => void;
  getLiveIndicatorClass: (s: FollowedStreamer) => string;
  proxyBase?: string;
  alignTop?: number;
  alignLeft?: number;
  isRefreshing?: boolean;
  isDeleteMode?: boolean;
}>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "select", s: FollowedStreamer): void;
  (e: "refresh"): void;
  (e: "toggle-remove"): void;
  (e: "remove", s: FollowedStreamer): void;
}>();

// 刷新完成提示：当 isRefreshing 从 true 变为 false 时，短暂展示完成动画
const justFinished = ref(false);
watch(
  () => props.isRefreshing,
  (newVal, oldVal) => {
    if (oldVal && !newVal) {
      justFinished.value = true;
      setTimeout(() => {
        justFinished.value = false;
      }, 800);
    }
  },
);

watch(
  () => props.show,
  (val) => {
    if (val) {
      nextTick(() => computePanelMetrics());
    }
  },
);

// 参考值与动态测量
const PANEL_MIN = 220;
const PANEL_MAX_MARGIN = 180; // 留出顶部/底部边距，增加底部空间
const DEFAULT_CARD_H = 76; // 估算：48头像 + 24内边距 + 2边框
const DEFAULT_CARD_W = 200;
const LIST_PAD_TOP = 6;
const LIST_PAD_BOTTOM = 6;
const panelHeight = ref<number>(400);
const panelTop = ref<number>(64);
const panelLeft = ref<number>(props.alignLeft ?? 240);
const headerHeight = ref<number>(56);
const headerRef = ref<HTMLElement | null>(null);
const listEl = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const shouldScroll = ref<boolean>(false);

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function updatePanelLeft() {
  if (typeof window === "undefined") return;
  nextTick(() => {
    const requestedLeft = props.alignLeft ?? 240;
    if (!panelRef.value) {
      panelLeft.value = Math.max(
        16,
        Math.min(requestedLeft, window.innerWidth - 320),
      );
      return;
    }
    const panelWidth = panelRef.value.getBoundingClientRect().width;
    const maxLeft = Math.max(16, window.innerWidth - panelWidth - 16);
    panelLeft.value = Math.max(16, Math.min(requestedLeft, maxLeft));
  });
}
function computePanelMetrics() {
  nextTick(() => {
    // 测量 header 实际高度
    headerHeight.value = Math.ceil(
      headerRef.value?.getBoundingClientRect().height || 56,
    );
    // 测量首个卡片高度
    let cardH = DEFAULT_CARD_H;
    let cardW = DEFAULT_CARD_W;
    const firstItem = listEl.value?.querySelector(
      ".overlay-streamer-item",
    ) as HTMLElement | null;
    if (firstItem) {
      const firstRect = firstItem.getBoundingClientRect();
      cardH = Math.ceil(firstRect.height || DEFAULT_CARD_H);
      cardW = Math.ceil(firstRect.width || DEFAULT_CARD_W);
    }
    // 读取 grid gap（如果可用）
    let gapPx = 14;
    let listWidth = 0;
    if (listEl.value) {
      const cs = window.getComputedStyle(listEl.value);
      const gapStr = (cs as any).gap || cs.columnGap || cs.rowGap;
      const parsed = parseFloat(gapStr || "");
      if (!isNaN(parsed)) gapPx = Math.round(parsed);
      listWidth = Math.ceil(listEl.value.getBoundingClientRect().width || 0);
    }
    const count = Array.isArray(props.items) ? props.items.length : 0;
    let columns =
      count > 0 ? Math.floor((listWidth + gapPx) / (cardW + gapPx)) : 1;
    if (!Number.isFinite(columns) || columns < 1) {
      columns = Math.max(
        1,
        Math.min(count || 1, Math.ceil(Math.sqrt(count || 1))),
      );
    } else {
      columns = Math.max(1, Math.min(count || 1, columns));
    }
    const rows = Math.max(1, columns > 0 ? Math.ceil(count / columns) : count);
    const contentHeight =
      rows * cardH + (rows - 1) * gapPx + LIST_PAD_TOP + LIST_PAD_BOTTOM;
    const desired = headerHeight.value + contentHeight + 8 + 10; // overlay-content padding: 上8 下10
    const maxH =
      typeof window !== "undefined"
        ? window.innerHeight - PANEL_MAX_MARGIN
        : desired;
    panelHeight.value = clamp(desired, PANEL_MIN, maxH);
    shouldScroll.value = desired > maxH;
    const vh =
      typeof window !== "undefined" ? window.innerHeight : panelHeight.value;
    panelTop.value = Math.max(16, Math.round((vh - panelHeight.value) / 2));
    updatePanelLeft();
  });
}

onMounted(() => {
  computePanelMetrics();
  resizeListener = () => computePanelMetrics();
  scrollListener = () => {
    if (props.show) computePanelMetrics();
  };
  window.addEventListener("resize", resizeListener);
  window.addEventListener("scroll", scrollListener, { passive: true });
});
let resizeListener: ((this: Window, ev: UIEvent) => any) | null = null;
let scrollListener: ((this: Window, ev: Event) => any) | null = null;
onUnmounted(() => {
  if (resizeListener) window.removeEventListener("resize", resizeListener);
  if (scrollListener) window.removeEventListener("scroll", scrollListener);
});
watch(
  () => props.items,
  () => computePanelMetrics(),
  { deep: true },
);
watch(
  () => props.show,
  (v) => {
    if (v) computePanelMetrics();
  },
);
watch(
  () => props.isDeleteMode,
  () => computePanelMetrics(),
);
watch(
  () => props.alignLeft,
  () => updatePanelLeft(),
);

const handleSelect = (s: FollowedStreamer) => {
  if (props.isDeleteMode) return;
  emit("select", s);
};
</script>
