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
  const oneShotFlashingIds = ref<ReadonlySet<string>>(new Set());
  const oneShotTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Keep this duration aligned with the one-shot CSS animation.
  const oneShotDurationMs = 1_800;

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

  function stopOnce(id: string): void {
    const timer = oneShotTimers.get(id);
    if (timer) clearTimeout(timer);
    oneShotTimers.delete(id);
    if (!oneShotFlashingIds.value.has(id)) return;
    const next = new Set(oneShotFlashingIds.value);
    next.delete(id);
    oneShotFlashingIds.value = next;
  }

  /** Show a brief semantic-info pulse that clears itself after one animation. */
  function flashOnce(id: string): void {
    if (!id || oneShotFlashingIds.value.has(id)) return;
    oneShotFlashingIds.value = new Set([...oneShotFlashingIds.value, id]);
    oneShotTimers.set(
      id,
      setTimeout(() => stopOnce(id), oneShotDurationMs),
    );
  }

  function stopAll(): void {
    for (const timer of oneShotTimers.values()) clearTimeout(timer);
    oneShotTimers.clear();
    if (flashingIds.value.size) flashingIds.value = new Set();
    if (oneShotFlashingIds.value.size) oneShotFlashingIds.value = new Set();
  }

  /** Drop ids that no longer exist, such as tabs the user just closed. */
  function retain(ids: Iterable<string>): void {
    const keep = new Set(ids);
    if ([...flashingIds.value].some((id) => !keep.has(id)))
      flashingIds.value = new Set(
        [...flashingIds.value].filter((id) => keep.has(id)),
      );
    for (const id of oneShotFlashingIds.value) {
      if (!keep.has(id)) stopOnce(id);
    }
  }

  function isFlashing(id: string): boolean {
    return flashingIds.value.has(id);
  }

  function isFlashingOnce(id: string): boolean {
    return oneShotFlashingIds.value.has(id);
  }

  return {
    flash,
    flashOnce,
    flashingIds,
    oneShotFlashingIds,
    isFlashing,
    isFlashingOnce,
    retain,
    stop,
    stopAll,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(
    acceptHMRUpdate(useAttentionFlashStore, import.meta.hot),
  );
}
