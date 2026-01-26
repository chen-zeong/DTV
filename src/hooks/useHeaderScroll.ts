import { ref } from "vue";

export function useHeaderScroll(threshold = 80) {
  const isHeaderCollapsed = ref(false);
  const isScrolling = ref(false);
  let scrollTimer: number | null = null;

  const handleScroll = (e: Event) => {
    const target = e.target as HTMLElement;
    isHeaderCollapsed.value = target.scrollTop > threshold;

    isScrolling.value = true;
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      isScrolling.value = false;
    }, 150);
  };

  return {
    isHeaderCollapsed,
    isScrolling,
    handleScroll,
  };
}
