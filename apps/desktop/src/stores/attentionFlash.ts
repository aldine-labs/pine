import { acceptHMRUpdate, defineStore } from "pinia";
import { ref } from "vue";

/**
 * Tracks which surfaces should currently pulse for attention.
 *
 * The store owns only *which* ids are flashing; the `attention-flash` utility
 * owns how that looks, so any element can opt in by binding
 * `isFlashing(id)` to that class. Ids are opaque keys chosen by the caller
 * (a content tab id today), which keeps the signal reusable for other
 * surfaces later.
 */
export const useAttentionFlashStore = defineStore("attention-flash", () => {
  const flashingIds = ref<ReadonlySet<string>>(new Set());

  function flash(id: string): void {
    if (!id || flashingIds.value.has(id)) return;
    flashingIds.value = new Set([...flashingIds.value, id]);
  }

  /** Silence one id. Safe to call for ids that are not flashing. */
  function stop(id: string): void {
    if (!flashingIds.value.has(id)) return;
    const next = new Set(flashingIds.value);
    next.delete(id);
    flashingIds.value = next;
  }

  function stopAll(): void {
    if (!flashingIds.value.size) return;
    flashingIds.value = new Set();
  }

  /** Drop ids that no longer exist, such as tabs the user just closed. */
  function retain(ids: Iterable<string>): void {
    const keep = new Set(ids);
    if ([...flashingIds.value].every((id) => keep.has(id))) return;
    flashingIds.value = new Set(
      [...flashingIds.value].filter((id) => keep.has(id)),
    );
  }

  function isFlashing(id: string): boolean {
    return flashingIds.value.has(id);
  }

  return { flash, flashingIds, isFlashing, retain, stop, stopAll };
});

if (import.meta.hot) {
  import.meta.hot.accept(
    acceptHMRUpdate(useAttentionFlashStore, import.meta.hot),
  );
}
