import { ref, onUnmounted, type ComputedRef } from "vue";
import type { FollowListItem, FollowListOrderItem, FollowFolder } from "../../../store/followStore";
import type { FollowedStreamer } from "../../../types/models/streamer";

export function useStreamerDrag(
  listRef: { value: HTMLElement | null },
  displayList: ComputedRef<FollowListItem[]>,
  updateListOrder: (newOrder: FollowListOrderItem[]) => void,
  beginTransaction: () => void,
  commitTransaction: () => void,
  rollbackTransaction: () => void,
  moveStreamerToFolder: (key: string, folderId: string) => void,
  removeStreamerFromFolder: (key: string, folderId: string) => void,
  folders: ComputedRef<FollowFolder[]>
) {
  const isDragging = ref(false);
  const draggedIndex = ref(-1);
  const draggedItemType = ref<"folder" | "streamer" | null>(null);
  const draggedStreamerKey = ref<string | null>(null);
  const dragOverFolderId = ref<string | null>(null);
  const draggedFromFolder = ref(false);
  const sourceFolderId = ref<string | null>(null);

  const startY = ref(0);
  const startX = ref(0);
  const currentY = ref(0);
  
  const pendingDragIndex = ref(-1);
  const pendingDragType = ref<"streamer" | null>(null);
  const dragStartPoint = ref<{ x: number; y: number } | null>(null);
  const dragPrepTimer = ref<number | null>(null);

  const DRAG_MIN_PX = 6;
  const LONG_PRESS_MS = 220;
  const FOLDER_HOVER_PADDING = 10;

  const clearDragPreparation = () => {
    if (dragPrepTimer.value !== null) {
      clearTimeout(dragPrepTimer.value);
      dragPrepTimer.value = null;
    }
    pendingDragIndex.value = -1;
    pendingDragType.value = null;
    dragStartPoint.value = null;
  };

  const startStreamerDrag = (index: number, point: { x: number; y: number }) => {
    const item = displayList.value[index];
    if (!item || item.type !== "streamer") return;
    
    clearDragPreparation();
    const streamer = item.data;
    draggedStreamerKey.value = `${streamer.platform}:${streamer.id}`;
    draggedFromFolder.value = false;
    
    beginTransaction();
    isDragging.value = true;
    draggedIndex.value = index;
    draggedItemType.value = "streamer";
    startY.value = point.y;
    startX.value = point.x;
    currentY.value = point.y;

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp as any);
  };

  const handleMouseDown = (e: MouseEvent, index: number) => {
    if (e.button !== 0) return;
    if (isDragging.value) safeCancelDrag();

    const item = displayList.value[index];
    if (item.type === "folder") return;

    e.preventDefault();
    clearDragPreparation();
    startY.value = e.clientY;
    startX.value = e.clientX;
    pendingDragIndex.value = index;
    pendingDragType.value = "streamer";
    dragStartPoint.value = { x: e.clientX, y: e.clientY };
    
    dragPrepTimer.value = window.setTimeout(() => {
      const point = dragStartPoint.value || { x: e.clientX, y: e.clientY };
      startStreamerDrag(index, point);
    }, LONG_PRESS_MS);

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp as any);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging.value || draggedIndex.value === -1) {
      if (pendingDragIndex.value !== -1 && pendingDragType.value === "streamer") {
        const movedDist = Math.hypot(e.clientX - startX.value, e.clientY - startY.value);
        if (movedDist >= DRAG_MIN_PX) {
          startStreamerDrag(pendingDragIndex.value, dragStartPoint.value || { x: e.clientX, y: e.clientY });
        }
      }
      if (!isDragging.value) return;
    }

    currentY.value = e.clientY;

    if (draggedItemType.value === "streamer" && draggedStreamerKey.value) {
      const folderElements = Array.from(document.querySelectorAll<HTMLElement>(".folder-item"));
      const matchedFolder = folderElements.find((el) => {
        const rect = el.getBoundingClientRect();
        return (
          e.clientX >= rect.left - FOLDER_HOVER_PADDING &&
          e.clientX <= rect.right + FOLDER_HOVER_PADDING &&
          e.clientY >= rect.top - FOLDER_HOVER_PADDING &&
          e.clientY <= rect.bottom + FOLDER_HOVER_PADDING
        );
      });
      const folderId = matchedFolder?.getAttribute("data-folder-id") || null;
      if (folderId) {
        const folder = folders.value.find((f) => f.id === folderId);
        if (folder) {
          const [rp, rid] = (draggedStreamerKey.value || "").split(":");
          const normKey = `${String(rp || "").toUpperCase()}:${rid}`;
          const exists = folder.streamerIds.some((id: string) => {
            const [p, i] = (id || "").split(":");
            return `${String(p || "").toUpperCase()}:${i}` === normKey;
          });
          if (!exists) {
            dragOverFolderId.value = folderId;
            return;
          }
        }
      }
      dragOverFolderId.value = null;
    }

    const container = listRef.value?.querySelector("ul");
    if (!container) return;

    const items = Array.from(container.children) as HTMLElement[];
    const draggedItem = items[draggedIndex.value];
    if (!draggedItem) return;

    const moveY = currentY.value - startY.value;
    const itemHeight = draggedItem.offsetHeight;

    let targetIndex = draggedIndex.value;
    let accumulatedHeight = 0;
    if (moveY > 0) {
      for (let i = draggedIndex.value + 1; i < items.length; i++) {
        accumulatedHeight += items[i].offsetHeight;
        if (moveY < accumulatedHeight) break;
        targetIndex = i;
      }
    } else {
      for (let i = draggedIndex.value - 1; i >= 0; i--) {
        accumulatedHeight -= items[i].offsetHeight;
        if (moveY > accumulatedHeight) break;
        targetIndex = i;
      }
    }

    if (targetIndex !== draggedIndex.value) {
      const targetItem = displayList.value[targetIndex];
      if (targetItem && targetItem.type === "folder" && targetItem.data.expanded) {
        dragOverFolderId.value = targetItem.data.id;
        return;
      }

      const reorderedItems = [...displayList.value];
      const [removed] = reorderedItems.splice(draggedIndex.value, 1);
      reorderedItems.splice(targetIndex, 0, removed);

      const nextOrder = reorderedItems.map(item => {
        if (item.type === 'streamer') {
          return { type: 'streamer' as const, id: `${item.data.platform}:${item.data.id}` };
        }
        return { type: 'folder' as const, id: item.data.id };
      });
      updateListOrder(nextOrder);

      draggedIndex.value = targetIndex;
      startY.value = e.clientY - (targetIndex - draggedIndex.value) * itemHeight;
    }
  };

  const handleMouseUp = (ev: MouseEvent) => {
    clearDragPreparation();
    if (!isDragging.value) {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp as any);
      return;
    }

    if (draggedItemType.value === "streamer" && draggedStreamerKey.value && dragOverFolderId.value) {
      moveStreamerToFolder(draggedStreamerKey.value, dragOverFolderId.value);
      commitTransaction();
    } else if (draggedItemType.value === "streamer" && draggedFromFolder.value) {
      const movedDist = Math.hypot((ev?.clientX ?? startX.value) - startX.value, (ev?.clientY ?? startY.value) - startY.value);
      const shouldRemoveByDistance = movedDist >= DRAG_MIN_PX;
      let isStillInsideSource = false;
      if (sourceFolderId.value) {
        const el = document.querySelector(`.folder-item[data-folder-id="${sourceFolderId.value}"]`) as HTMLElement | null;
        const rect = el?.getBoundingClientRect();
        if (rect && ev) {
          isStillInsideSource = ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom;
        }
      }
      if (sourceFolderId.value && draggedStreamerKey.value && shouldRemoveByDistance && !isStillInsideSource) {
        removeStreamerFromFolder(draggedStreamerKey.value, sourceFolderId.value);
        commitTransaction();
      } else {
        rollbackTransaction();
      }
    } else if (draggedItemType.value === "streamer" && !dragOverFolderId.value && !draggedFromFolder.value) {
      const movedDist = Math.hypot((ev?.clientX ?? startX.value) - startX.value, (ev?.clientY ?? startY.value) - startY.value);
      if (movedDist < DRAG_MIN_PX) {
        rollbackTransaction();
      } else {
        commitTransaction();
      }
    }

    resetDragState();
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp as any);
  };

  const resetDragState = () => {
    isDragging.value = false;
    draggedIndex.value = -1;
    draggedItemType.value = null;
    dragOverFolderId.value = null;
    draggedStreamerKey.value = null;
    draggedFromFolder.value = false;
    sourceFolderId.value = null;
  };

  const safeCancelDrag = () => {
    clearDragPreparation();
    if (!isDragging.value) {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp as any);
      return;
    }
    rollbackTransaction();
    resetDragState();
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp as any);
  };

  const handleFolderDragStart = (_folderId: string, index: number, event: MouseEvent) => {
    isDragging.value = true;
    draggedIndex.value = index;
    draggedItemType.value = "folder";
    startY.value = event.clientY;
    currentY.value = event.clientY;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp as any);
    event.preventDefault();
  };

  const handleFolderStreamerDragStart = (streamer: FollowedStreamer, event: MouseEvent) => {
    if (event.button !== 0) return;
    if (isDragging.value) safeCancelDrag();
    clearDragPreparation();

    draggedStreamerKey.value = `${streamer.platform}:${streamer.id}`;
    draggedFromFolder.value = true;

    const streamerKey = draggedStreamerKey.value;
    const folder = folders.value.find((f) => {
      return f.streamerIds.some((id: string) => {
        const [p, i] = (id || "").split(":");
        const [rp, ri] = (streamerKey || "").split(":");
        return `${String(p || "").toUpperCase()}:${i}` === `${String(rp || "").toUpperCase()}:${ri}`;
      });
    });

    if (folder) {
      beginTransaction();
      sourceFolderId.value = folder.id;
    }

    isDragging.value = true;
    draggedItemType.value = "streamer";
    startY.value = event.clientY;
    startX.value = event.clientX;
    currentY.value = event.clientY;
    
    const newIndex = displayList.value.findIndex((item) => {
      if (item.type === "streamer") {
        return `${item.data.platform}:${item.data.id}` === draggedStreamerKey.value;
      }
      return false;
    });

    if (newIndex !== -1) {
      draggedIndex.value = newIndex;
    } else {
      draggedIndex.value = displayList.value.length;
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp as any);
    event.preventDefault();
    event.stopPropagation();
  };

  const handleWindowBlur = () => {
    clearDragPreparation();
    if (!isDragging.value) return;
    rollbackTransaction();
    resetDragState();
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp as any);
  };

  window.addEventListener("blur", handleWindowBlur);
  onUnmounted(() => {
    window.removeEventListener("blur", handleWindowBlur);
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp as any);
  });

  return {
    isDragging,
    draggedIndex,
    draggedItemType,
    draggedStreamerKey,
    dragOverFolderId,
    handleMouseDown,
    handleFolderDragStart,
    handleFolderStreamerDragStart,
    safeCancelDrag
  };
}
