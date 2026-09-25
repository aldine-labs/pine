import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createAppI18n } from "@/app/i18n";
import type { PineTranscriptMessage } from "@/stores/session";
import ProjectCompactionMarker from "../ProjectCompactionMarker.vue";
import ProjectErrorMarker from "../ProjectErrorMarker.vue";
import ProjectTranscriptMessage from "../ProjectTranscriptMessage.vue";
import ProjectToolCallGroup from "../ProjectToolCallGroup.vue";
import ProjectToolCallMarker from "../ProjectToolCallMarker.vue";

function mountMessage(message: PineTranscriptMessage) {
  return mount(ProjectTranscriptMessage, {
    props: { message },
    global: {
      plugins: [createAppI18n("zh-CN")],
    },
  });
}

describe("ProjectTranscriptMessage", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("renders streaming assistant output as Markdown too", () => {
    const wrapper = mountMessage({
      createdAt: "2026-08-26T00:00:00.000Z",
      id: "assistant-streaming",
      role: "assistant",
      status: "streaming",
      blocks: [{ type: "text", text: "**Still streaming**" }],
    });

    expect(wrapper.find('[data-slot="markdown-content"]').exists()).toBe(true);
    expect(wrapper.get('[data-slot="markdown-content"] strong').text()).toBe(
      "Still streaming",
    );
  });

  it("keeps user messages as plain text", () => {
    const wrapper = mountMessage({
      createdAt: "2026-08-26T00:00:00.000Z",
      id: "user-complete",
      role: "user",
      status: "complete",
      blocks: [{ type: "text", text: "**Literal prompt**" }],
    });

    expect(wrapper.find('[data-slot="markdown-content"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("**Literal prompt**");
  });

  it("renders parsed attachments above the user bubble and opens them", async () => {
    const openAttachment = vi.fn().mockResolvedValue({ opened: true });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { openAttachment },
    });
    const wrapper = mountMessage({
      createdAt: "2026-09-02T12:00:00.000Z",
      id: "user-attachment",
      role: "user",
      status: "complete",
      blocks: [
        {
          type: "attachments",
          attachments: [
            {
              extension: "md",
              modifiedAt: "2026-09-02T11:59:00.000Z",
              name: "notes.md",
              path: "/Users/example/notes.md",
              size: 1_024,
            },
          ],
        },
        { type: "text", text: "Review this." },
      ],
    });

    const content = wrapper.get('[data-slot="message-content"]');
    expect(content.element.children[0]?.getAttribute("data-slot")).toBe(
      "attachment-group",
    );
    expect(content.element.children[1]?.getAttribute("data-slot")).toBe(
      "bubble",
    );
    expect(content.element.children).toHaveLength(2);
    const trigger = wrapper.get('[data-slot="attachment-trigger"]');
    expect(trigger.attributes("aria-label")).toBe("打开附件 notes.md");
    await trigger.trigger("click");
    await flushPromises();
    expect(openAttachment).toHaveBeenCalledWith({
      path: "/Users/example/notes.md",
    });
    expect(wrapper.text()).toContain("notes.md");
    expect(wrapper.text()).toContain("Review this.");
    expect(wrapper.text()).not.toContain("pine_attachments");
    expect(wrapper.get('[data-slot="bubble-content"]').text()).toBe(
      "Review this.",
    );
  });

  it("renders a single tool call in full instead of folding it", () => {
    const wrapper = mountMessage({
      createdAt: "2026-08-26T00:00:00.000Z",
      id: "assistant-single-tool",
      role: "assistant",
      status: "complete",
      blocks: [
        {
          type: "toolCall",
          toolCall: {
            id: "call-read",
            name: "read",
            status: "complete",
            input: { path: "/project/src/main.ts" },
          },
        },
      ],
    });

    expect(wrapper.findComponent(ProjectToolCallGroup).exists()).toBe(false);
    expect(wrapper.findComponent(ProjectToolCallMarker).exists()).toBe(true);
  });

  it("shows a dedicated MCP call marker with its tool target", () => {
    const wrapper = mountMessage({
      createdAt: "2026-09-25T00:00:00.000Z",
      id: "assistant-mcp-tool",
      role: "assistant",
      status: "complete",
      blocks: [
        {
          type: "toolCall",
          toolCall: {
            id: "call-mcp",
            name: "mcp",
            status: "complete",
            input: { server: "github", tool: "search_repositories", args: {} },
          },
        },
      ],
    });

    expect(wrapper.findComponent(ProjectToolCallMarker).exists()).toBe(true);
    expect(wrapper.text()).toContain(
      "已执行 MCP 工具调用 github.search_repositories",
    );
  });

  it("renders session errors as destructive markers", () => {
    const wrapper = mountMessage({
      createdAt: "2026-08-26T00:00:00.000Z",
      id: "assistant-error",
      role: "assistant",
      status: "complete",
      blocks: [
        {
          type: "error",
          error: { message: "Provider request failed" },
        },
      ],
    });

    const marker = wrapper.getComponent(ProjectErrorMarker);
    expect(marker.get('[data-slot="marker-content"]').text()).toBe(
      "错误: Provider request failed",
    );
  });

  it("renders compaction markers in the assistant transcript", () => {
    const wrapper = mountMessage({
      createdAt: "2026-08-26T00:00:00.000Z",
      id: "assistant-compaction",
      role: "assistant",
      status: "streaming",
      blocks: [
        {
          type: "compaction",
          compaction: { id: "compaction-1", status: "running" },
        },
      ],
    });

    expect(wrapper.findComponent(ProjectCompactionMarker).exists()).toBe(true);
    expect(wrapper.text()).toContain("正在压缩上下文");
  });

  it("folds consecutive tool calls into a step group", () => {
    const wrapper = mountMessage({
      createdAt: "2026-08-26T00:00:00.000Z",
      id: "assistant-multi-tool",
      role: "assistant",
      status: "complete",
      blocks: [
        {
          type: "toolCall",
          toolCall: {
            id: "call-bash",
            name: "bash",
            status: "complete",
            input: { command: "bun run check" },
          },
        },
        {
          type: "toolCall",
          toolCall: {
            id: "call-read",
            name: "read",
            status: "complete",
            input: { path: "/project/src/main.ts" },
          },
        },
      ],
    });

    expect(wrapper.findComponent(ProjectToolCallGroup).exists()).toBe(true);
  });
});
