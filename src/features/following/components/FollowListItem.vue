<template>
  <li
    class="list-item-wrapper"
    :class="{
      'is-dragging': isDragging,
      'is-folder': item.type === 'folder',
      'is-streamer': item.type === 'streamer',
    }"
    @mousedown="$emit('mousedown', $event)"
    @mouseenter="$emit('mouseenter', $event)"
    @mouseleave="$emit('mouseleave', $event)"
  >
    <!-- 文件夹项 -->
    <FolderItem
      v-if="item.type === 'folder'"
      :folder="item.data"
      :all-streamers="followedAnchors"
      :get-avatar-src="getAvatarSrc"
      :handle-img-error="handleImgError"
      :get-live-indicator-class="getLiveIndicatorClass"
      :proxy-base="proxyBase || undefined"
      :is-dragging="isDragging"
      :is-drag-over="isDragOver"
      :can-accept-drop="canAcceptDrop"
      :global-dragging="globalDragging"
      @select-anchor="(s) => $emit('selectAnchor', s)"
      @toggle-expand="(id) => $emit('toggleFolderExpand', id)"
      @drag-start="(id, e) => $emit('dragStart', id, e)"
      @context-menu="(id, e) => $emit('contextMenu', id, e)"
      @drag-over="(id) => $emit('dragOver', id)"
      @drag-leave="() => $emit('dragLeave')"
      @drop="(id) => $emit('drop', id)"
      @streamer-drag-start="(s, e) => $emit('streamerDragStart', s, e)"
    />

    <!-- 主播项 -->
    <div
      v-else
      class="rounded-[var(--radius-sm)] bg-transparent"
      :class="[
        getStreamerItemClass(item.data),
        {
          'just-added': isJustAdded,
        },
      ]"
      :data-streamer-key="`${item.data.platform.toUpperCase()}:${item.data.id}`"
      @click="$emit('click', $event, item.data)"
    >
      <StreamerItem
        :streamer="item.data"
        :getAvatarSrc="getAvatarSrc"
        :handleImgError="handleImgError"
        :getLiveIndicatorClass="getLiveIndicatorClass"
        :proxyBase="proxyBase || undefined"
        @clickItem="(s) => $emit('selectAnchor', s)"
      />
    </div>
  </li>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { FollowedStreamer } from "../../../types/models/streamer";
import type { FollowListItem } from "../../../store/followStore";
import FolderItem from "./FolderItem.vue";
import StreamerItem from "./StreamerItem.vue";

const props = defineProps<{
  item: FollowListItem;
  isDragging: boolean;
  isDragOver: boolean;
  canAcceptDrop: boolean;
  globalDragging: boolean;
  followedAnchors: FollowedStreamer[];
  justAddedIds: string[];
  proxyBase: string | null;
  getAvatarSrc: (s: FollowedStreamer) => string;
  handleImgError: (ev: Event, s: FollowedStreamer) => void;
  getLiveIndicatorClass: (s: FollowedStreamer) => string;
  getStreamerItemClass: (s: FollowedStreamer) => Record<string, boolean>;
}>();

defineEmits<{
  (e: "mousedown", event: MouseEvent): void;
  (e: "mouseenter", event: MouseEvent): void;
  (e: "mouseleave", event: MouseEvent): void;
  (e: "selectAnchor", streamer: FollowedStreamer): void;
  (e: "toggleFolderExpand", folderId: string): void;
  (e: "dragStart", folderId: string, event: MouseEvent): void;
  (e: "contextMenu", folderId: string, event: MouseEvent): void;
  (e: "dragOver", folderId: string): void;
  (e: "dragLeave"): void;
  (e: "drop", folderId: string): void;
  (e: "streamerDragStart", streamer: FollowedStreamer, event: MouseEvent): void;
  (e: "click", event: MouseEvent, streamer: FollowedStreamer): void;
}>();

const isJustAdded = computed(() => {
  if (props.item.type === 'streamer') {
    return props.justAddedIds.includes(props.item.data.id);
  }
  return false;
});
</script>