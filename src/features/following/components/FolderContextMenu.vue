<template>
  <teleport to="body">
    <Transition
      enter-from-class="opacity-0 scale-95 -translate-y-1"
      enter-to-class="opacity-100 scale-100 translate-y-0"
      leave-from-class="opacity-100 scale-100 translate-y-0"
      leave-to-class="opacity-0 scale-95 -translate-y-1"
    >
      <div
        v-if="show"
        class="fixed z-[1000] min-w-[160px] rounded-[10px] border p-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)] [backdrop-filter:blur(12px)]"
        :style="{ top: `${position.y}px`, left: `${position.x}px` }"
        @click.stop
      >
        <button
          class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px]"
          @click="handleRename"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="flex-shrink-0"
          >
            <path
              d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
            ></path>
            <path
              d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
            ></path>
          </svg>
          <span>重命名</span>
        </button>
        <button
          class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] text-[rgba(248,113,113,0.9)] hover:bg-[rgba(248,113,113,0.15)]"
          @click="handleDelete"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="flex-shrink-0"
          >
            <polyline points="3 6 5 6 21 6"></polyline>
            <path
              d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
            ></path>
          </svg>
          <span>删除</span>
        </button>
      </div>
    </Transition>
    <div v-if="show" class="fixed inset-0 z-[999]" @click="close"></div>
  </teleport>

  <!-- 重命名对话框 -->
  <teleport to="body">
    <Transition
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showRenameDialog"
        class="fixed inset-0 z-[2000] flex items-center justify-center bg-[rgba(7,10,18,0.35)] [backdrop-filter:blur(10px)]"
        @click="cancelRename"
      >
        <div
          class="min-w-[320px] rounded-2xl border p-[22px] pb-[18px]"
          @click.stop
        >
          <h3 class="mb-3.5 text-[16px] font-semibold tracking-[0.01em]">
            重命名文件夹
          </h3>
          <input
            ref="renameInputRef"
            v-model="renameValue"
            class="mb-4 w-full rounded-[12px] border bg-[rgba(255,255,255,0.06)] px-3.5 py-2.5 text-[14px] focus:outline-none"
            type="text"
            placeholder="输入文件夹名称"
            maxlength="50"
            @keyup.enter="confirmRename"
            @keyup.esc="cancelRename"
          />
          <div class="flex justify-end gap-2">
            <button
              class="rounded-[10px] border bg-[rgba(255,255,255,0.06)] px-[18px] py-2 text-[13px] hover:bg-[rgba(255,255,255,0.12)]"
              @click="cancelRename"
            >
              取消
            </button>
            <button
              class="rounded-[10px] border px-[18px] py-2 text-[13px]"
              @click="confirmRename"
            >
              确定
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </teleport>
</template>

<script setup lang="ts">
import { ref, nextTick } from "vue";

const props = defineProps<{
  show: boolean;
  position: { x: number; y: number };
  folderName: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "rename", newName: string): void;
  (e: "delete"): void;
}>();

const showRenameDialog = ref(false);
const renameValue = ref("");
const renameInputRef = ref<HTMLInputElement | null>(null);

const close = () => {
  emit("close");
};

const handleRename = () => {
  close();
  showRenameDialog.value = true;
  renameValue.value = props.folderName;
  nextTick(() => {
    renameInputRef.value?.focus();
    renameInputRef.value?.select();
  });
};

const handleDelete = () => {
  close();
  emit("delete");
};

const confirmRename = () => {
  const trimmed = renameValue.value.trim();
  // 验证输入：不能为空，不能只包含空格
  if (!trimmed) {
    // 如果输入为空，提示用户并保持对话框打开
    renameInputRef.value?.focus();
    return;
  }
  // 如果名称与原来相同，也允许（用户可能只是想确认）
  emit("rename", trimmed);
  showRenameDialog.value = false;
  renameValue.value = "";
};

const cancelRename = () => {
  showRenameDialog.value = false;
  renameValue.value = "";
};
</script>
