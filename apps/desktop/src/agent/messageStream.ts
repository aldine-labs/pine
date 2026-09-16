import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import type {
  PineAssistantMessageUpdate,
  PineJsonValue,
} from "../shared/agent";
import { toPineJsonValue } from "./protocol";

type StreamingAssistantEvent = Exclude<
  AssistantMessageEvent,
  { type: "start" | "done" | "error" }
>;

function contentBlock(
  event: StreamingAssistantEvent,
): Record<string, unknown> | undefined {
  const block = event.partial.content[event.contentIndex];
  return typeof block === "object" && block !== null
    ? (block as unknown as Record<string, unknown>)
    : undefined;
}

function optionalJson(value: unknown): PineJsonValue | undefined {
  return value === undefined ? undefined : toPineJsonValue(value);
}

/** Convert the SDK's cumulative live-message event into a bounded wire event. */
export function compactAssistantMessageUpdate(
  event: AssistantMessageEvent,
): PineAssistantMessageUpdate | undefined {
  if (
    event.type === "start" ||
    event.type === "done" ||
    event.type === "error"
  ) {
    return undefined;
  }

  const block = contentBlock(event);
  switch (event.type) {
    case "text_start":
      return {
        type: "text-start",
        contentIndex: event.contentIndex,
        text: typeof block?.text === "string" ? block.text : "",
      };
    case "text_delta":
      return {
        type: "text-delta",
        contentIndex: event.contentIndex,
        delta: event.delta,
      };
    case "text_end":
      return {
        type: "text-end",
        contentIndex: event.contentIndex,
        text: event.content,
      };
    case "thinking_start":
      return {
        type: "thinking-start",
        contentIndex: event.contentIndex,
        thinking: typeof block?.thinking === "string" ? block.thinking : "",
      };
    case "thinking_delta":
      return {
        type: "thinking-delta",
        contentIndex: event.contentIndex,
        delta: event.delta,
      };
    case "thinking_end":
      return {
        type: "thinking-end",
        contentIndex: event.contentIndex,
        thinking: event.content,
      };
    case "toolcall_start":
      if (
        block?.type !== "toolCall" ||
        typeof block.id !== "string" ||
        typeof block.name !== "string"
      ) {
        return undefined;
      }
      return {
        type: "tool-call-start",
        contentIndex: event.contentIndex,
        id: block.id,
        name: block.name,
        ...(block.arguments === undefined
          ? {}
          : { input: optionalJson(block.arguments) }),
      };
    case "toolcall_delta":
      return {
        type: "tool-call-delta",
        contentIndex: event.contentIndex,
        delta: event.delta,
      };
    case "toolcall_end":
      return {
        type: "tool-call-end",
        contentIndex: event.contentIndex,
        id: event.toolCall.id,
        name: event.toolCall.name,
        ...(event.toolCall.arguments === undefined
          ? {}
          : { input: optionalJson(event.toolCall.arguments) }),
      };
  }
}

/** Merge only adjacent textual deltas. Structural boundaries remain ordered. */
export function coalesceAssistantMessageUpdates(
  updates: readonly PineAssistantMessageUpdate[],
): PineAssistantMessageUpdate[] {
  const result: PineAssistantMessageUpdate[] = [];
  for (const update of updates) {
    const previous = result.at(-1);
    if (
      update.type === "text-delta" &&
      previous?.type === "text-delta" &&
      previous.contentIndex === update.contentIndex
    ) {
      previous.delta += update.delta;
    } else if (
      update.type === "thinking-delta" &&
      previous?.type === "thinking-delta" &&
      previous.contentIndex === update.contentIndex
    ) {
      previous.delta += update.delta;
    } else if (
      update.type === "tool-call-delta" &&
      previous?.type === "tool-call-delta" &&
      previous.contentIndex === update.contentIndex
    ) {
      previous.delta += update.delta;
    } else {
      result.push({ ...update });
    }
  }
  return result;
}
