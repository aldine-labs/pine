import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  coalesceAssistantMessageUpdates,
  compactAssistantMessageUpdate,
} from "../messageStream";

describe("assistant message stream transport", () => {
  it("strips the cumulative message snapshot from text deltas", () => {
    const event = {
      type: "text_delta",
      contentIndex: 0,
      delta: "world",
      partial: {
        role: "assistant",
        content: [{ type: "text", text: "hello world" }],
      },
    } as AssistantMessageEvent;

    expect(compactAssistantMessageUpdate(event)).toEqual({
      type: "text-delta",
      contentIndex: 0,
      delta: "world",
    });
  });

  it("keeps only the active tool argument snapshot", () => {
    const event = {
      type: "toolcall_start",
      contentIndex: 1,
      partial: {
        role: "assistant",
        content: [
          { type: "text", text: "a very long prefix" },
          {
            type: "toolCall",
            id: "call-1",
            name: "read",
            arguments: { path: "/project/file.ts" },
          },
        ],
      },
    } as AssistantMessageEvent;

    expect(compactAssistantMessageUpdate(event)).toEqual({
      type: "tool-call-start",
      contentIndex: 1,
      id: "call-1",
      name: "read",
      input: { path: "/project/file.ts" },
    });
  });

  it("forwards tool arguments as append-only deltas", () => {
    const event = {
      type: "toolcall_delta",
      contentIndex: 1,
      delta: '"command":"bun run check"',
      partial: {
        role: "assistant",
        content: [
          { type: "text", text: "a very long prefix" },
          {
            type: "toolCall",
            id: "call-1",
            name: "bash",
            arguments: { command: "bun run check" },
          },
        ],
      },
    } as AssistantMessageEvent;

    expect(compactAssistantMessageUpdate(event)).toEqual({
      type: "tool-call-delta",
      contentIndex: 1,
      delta: '"command":"bun run check"',
    });
  });

  it("coalesces adjacent deltas without crossing structural boundaries", () => {
    expect(
      coalesceAssistantMessageUpdates([
        { type: "text-delta", contentIndex: 0, delta: "a" },
        { type: "text-delta", contentIndex: 0, delta: "b" },
        { type: "text-end", contentIndex: 0, text: "ab" },
        { type: "thinking-delta", contentIndex: 1, delta: "c" },
        { type: "thinking-delta", contentIndex: 1, delta: "d" },
        { type: "tool-call-delta", contentIndex: 2, delta: '{"path"' },
        { type: "tool-call-delta", contentIndex: 2, delta: ':"x"}' },
      ]),
    ).toEqual([
      { type: "text-delta", contentIndex: 0, delta: "ab" },
      { type: "text-end", contentIndex: 0, text: "ab" },
      { type: "thinking-delta", contentIndex: 1, delta: "cd" },
      { type: "tool-call-delta", contentIndex: 2, delta: '{"path":"x"}' },
    ]);
  });
});
