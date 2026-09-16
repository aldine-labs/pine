import { computed, type ComputedRef, type Ref } from "vue";
import type { PineContentBlock } from "@/shared/sessions";
import type { PineTranscriptMessage } from "@/stores/session";

/**
 * Ordered keys of every tool-activity unit in the transcript. Consecutive
 * tool calls form one unit; a single ("落单") call counts as its own unit,
 * exactly like a folded group.
 */
export function toolRunKeys(
  messages: readonly PineTranscriptMessage[],
): string[] {
  const keys: string[] = [];
  for (const message of messages) {
    const blocks: readonly PineContentBlock[] = message.blocks;
    let index = 0;
    while (index < blocks.length) {
      const block = blocks[index];
      if (block?.type !== "toolCall") {
        index++;
        continue;
      }
      const key = `${message.id}:${block.toolCall.id}`;
      keys.push(key);
      while (index < blocks.length && blocks[index]?.type === "toolCall") {
        index++;
      }
    }
  }
  return keys;
}

function latestToolRunKeys(
  messages: readonly PineTranscriptMessage[],
  limit: number,
): string[] {
  const keys: string[] = [];
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0 && keys.length < limit;
    messageIndex--
  ) {
    const message = messages[messageIndex];
    const blocks = message.blocks;
    let blockIndex = blocks.length - 1;
    while (blockIndex >= 0 && keys.length < limit) {
      if (blocks[blockIndex]?.type !== "toolCall") {
        blockIndex--;
        continue;
      }
      let start = blockIndex;
      while (start > 0 && blocks[start - 1]?.type === "toolCall") start--;
      const block = blocks[start];
      if (block?.type === "toolCall") {
        keys.push(`${message.id}:${block.toolCall.id}`);
      }
      blockIndex = start - 1;
    }
  }
  return keys.reverse();
}

/**
 * Transcript-level expansion policy for tool runs: while a response is
 * active, its last two tool units stay expanded (a standalone call counts
 * as a unit and is visible either way — it only reserves a window slot).
 * Older units collapse as newer ones arrive, and when the response finally
 * ends without another tool call the set empties so everything folds up.
 * Static history (no active response) stays fully collapsed unless the
 * reader toggles a run open manually.
 */
export function useToolActivityExpansion(options: {
  messages: Ref<readonly PineTranscriptMessage[]>;
  isRunning: Ref<boolean>;
}): ComputedRef<Set<string>> {
  const keys = computed(() => latestToolRunKeys(options.messages.value, 2));
  return computed((previous) => {
    const nextKeys = options.isRunning.value ? keys.value.slice(-2) : [];
    if (
      previous &&
      previous.size === nextKeys.length &&
      nextKeys.every((key) => previous.has(key))
    ) {
      return previous;
    }
    return new Set(nextKeys);
  });
}
