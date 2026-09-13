import { mount } from "@vue/test-utils";
import { CircleHelpIcon } from "@lucide/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import ProjectCompactionMarker from "../ProjectCompactionMarker.vue";
import ProjectThinkingMarker from "../ProjectThinkingMarker.vue";
import ProjectToolCallMarker from "../ProjectToolCallMarker.vue";

describe("project transcript markers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shimmers while compacting and settles after compaction", async () => {
    const wrapper = mount(ProjectCompactionMarker, {
      props: {
        compaction: { id: "compaction-1", status: "running" },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });

    expect(wrapper.get('[data-slot="marker-content"]').text()).toBe(
      "正在压缩上下文",
    );
    expect(wrapper.get('[data-slot="marker-content"]').classes()).toContain(
      "shimmer",
    );
    expect(wrapper.get('[data-slot="marker"]').attributes("aria-live")).toBe(
      "polite",
    );

    await wrapper.setProps({
      compaction: { id: "compaction-1", status: "complete" },
    });

    expect(wrapper.get('[data-slot="marker-content"]').text()).toBe(
      "已压缩上下文",
    );
    expect(wrapper.get('[data-slot="marker-content"]').classes()).not.toContain(
      "shimmer",
    );
    expect(wrapper.get('[data-slot="marker"]').attributes("aria-live")).toBe(
      undefined,
    );
  });

  it("shows a stable elapsed-time summary and expands streaming thinking", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    const wrapper = mount(ProjectThinkingMarker, {
      props: {
        message: {
          createdAt: "2026-08-26T00:00:00.000Z",
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          blocks: [{ type: "thinking", thinking: "Inspect the request." }],
          thinkingStartedAt: 1_000,
          thinkingStatus: "streaming",
        },
      },
      global: {
        plugins: [createAppI18n("en-US")],
      },
    });

    const trigger = wrapper.get('button[data-slot="marker"]');
    expect(trigger.text()).toContain("Thinking (1s)");
    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find(".shimmer").exists()).toBe(false);

    await trigger.trigger("click");
    expect(trigger.attributes("aria-expanded")).toBe("false");
    await trigger.trigger("click");
    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(wrapper.get("[data-thinking-content]").text()).toBe(
      "Inspect the request.",
    );

    await wrapper.setProps({
      message: {
        ...wrapper.props("message"),
        blocks: [
          {
            type: "thinking",
            thinking: "Inspect the request.\nCheck the active session.",
          },
        ],
      },
    });
    expect(wrapper.get("[data-thinking-content]").text()).toContain(
      "Check the active session.",
    );
    expect(wrapper.get("[data-thinking-content]").classes()).toContain(
      "overflow-y-auto",
    );

    vi.setSystemTime(3_250);
    await vi.advanceTimersByTimeAsync(250);
    expect(trigger.text()).toContain("Thinking (2.5s)");
    wrapper.unmount();
  });

  it("auto-collapses when assistant output begins after thinking", async () => {
    const wrapper = mount(ProjectThinkingMarker, {
      props: {
        message: {
          createdAt: "2026-08-26T00:00:00.000Z",
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          blocks: [{ type: "thinking", thinking: "Inspect the request." }],
          thinkingStartedAt: Date.now(),
          thinkingStatus: "streaming",
        },
      },
      global: {
        plugins: [createAppI18n("en-US")],
      },
    });

    const trigger = wrapper.get('button[data-slot="marker"]');
    expect(trigger.attributes("aria-expanded")).toBe("true");

    await wrapper.setProps({
      message: {
        ...wrapper.props("message"),
        thinkingStatus: "complete",
      },
    });
    expect(trigger.attributes("aria-expanded")).toBe("true");

    await wrapper.setProps({
      message: {
        ...wrapper.props("message"),
        blocks: [
          { type: "thinking", thinking: "Inspect the request." },
          { type: "text", text: "Here is the result." },
        ],
      },
    });
    expect(trigger.attributes("aria-expanded")).toBe("false");
  });

  it("summarizes completed thinking and keeps the full content expandable", async () => {
    const wrapper = mount(ProjectThinkingMarker, {
      props: {
        message: {
          createdAt: "2026-08-26T00:00:00.000Z",
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          blocks: [
            {
              type: "thinking",
              thinking: "Inspect the request.\nCheck the active session.",
            },
            { type: "text", text: "Working on it" },
          ],
          thinkingDurationMs: 2_500,
          thinkingStatus: "complete",
        },
      },
      global: {
        plugins: [createAppI18n("zh-CN")],
      },
    });

    const trigger = wrapper.get('button[data-slot="marker"]');
    expect(trigger.text()).toContain("已工作 2.5 秒");
    await trigger.trigger("click");
    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(wrapper.get("[data-thinking-content]").text()).toContain(
      "Inspect the request.",
    );
  });

  it("uses semantic labels for primary tools and truncates commands", () => {
    const command = `bun run ${"very-long-argument ".repeat(8)}`;
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-1",
          input: { command },
          name: "bash",
          status: "running",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });

    const content = wrapper.get('[data-slot="marker-content"]');
    expect(content.text()).toMatch(/^正在执行 bun run/);
    expect(content.text()).toContain("…");
    expect(content.text().length).toBeLessThan(command.length);
    expect(wrapper.get('[data-slot="marker"]').attributes("aria-live")).toBe(
      "polite",
    );
  });

  it("renders questionnaire tool progress without exposing its raw name", async () => {
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-questionnaire",
          input: { questions: [{ question: "Choose an approach" }] },
          name: "ask_user_question",
          status: "running",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });

    const content = wrapper.get('[data-slot="marker-content"]');
    expect(content.text()).toBe("正在准备询问一些问题");
    expect(content.find("code").exists()).toBe(false);
    expect(wrapper.findComponent(CircleHelpIcon).exists()).toBe(true);

    await wrapper.setProps({
      toolCall: {
        ...wrapper.props("toolCall"),
        status: "complete",
        output: {
          details: {
            answers: [{ questionIndex: 0 }, { questionIndex: 1 }],
            cancelled: false,
          },
        },
      },
    });

    expect(content.text()).toBe("已获得 2 个问题的答案");
    expect(content.classes()).not.toContain("shimmer");
  });

  it("shows the filename when a read completes", () => {
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-1",
          input: { path: "/Users/kw/project/src/main.ts" },
          name: "read",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });

    expect(wrapper.get('[data-slot="marker-content"]').text()).toBe(
      "已读取 main.ts",
    );

    const code = wrapper.get('[data-slot="marker-content"] code');
    expect(code.text()).toBe("main.ts");
    expect(code.classes()).toEqual(
      expect.arrayContaining(["font-mono", "text-sm", "font-normal"]),
    );
    expect(code.classes()).not.toEqual(expect.arrayContaining(["bg-muted"]));
  });

  it("shows a bash operation summary before the command", () => {
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-1",
          input: {
            command: "bun run typecheck",
            description: "Checks types across the app",
          },
          name: "bash",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });

    const content = wrapper.get('[data-slot="marker-content"]');
    expect(content.text()).toBe(
      "已执行 Checks types across the app：bun run typecheck",
    );
    expect(content.get("code").text()).toBe("bun run typecheck");
  });

  it("renders privileged bash with the same command UI as ordinary bash", () => {
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-privileged",
          input: {
            command: "osascript -e 'tell application \"Music\" to play'",
            description: "Play music with the Music app",
          },
          name: "privileged_bash",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });

    const content = wrapper.get('[data-slot="marker-content"]');
    expect(content.text()).toBe(
      "已执行 Play music with the Music app：osascript -e 'tell application \"Music\" to play'",
    );
    expect(content.get("code").text()).toContain("osascript");
    expect(wrapper.get("svg").attributes("class")).toContain("terminal");
  });

  it("renders read line ranges and edit line tallies semantically", () => {
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-1",
          input: {
            path: "/project/src/main.ts",
            offset: 12,
            limit: 20,
          },
          name: "read",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    expect(wrapper.get('[data-slot="marker-content"] code').text()).toBe(
      "main.ts:12-31",
    );

    const offsetOnly = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-offset-only",
          input: {
            path: "/project/src/background.js",
            offset: 1513,
          },
          name: "read",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    expect(offsetOnly.get('[data-slot="marker-content"] code').text()).toBe(
      "background.js:1513",
    );
    expect(
      offsetOnly.get('[data-slot="marker-content"] code').text(),
    ).not.toContain("1513-");

    const editor = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-2",
          input: {
            path: "/project/src/main.ts",
            edits: [
              { oldText: "a\nb\nc", newText: "1\n2\n3\n4\n5" },
              { oldText: "d\ne", newText: "6" },
              {},
            ],
          },
          name: "edit",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    const added = editor
      .get('[data-slot="marker-content"]')
      .findAll("span")
      .find((node) => node.text() === "+6");
    expect(added?.classes()).toContain("text-emerald-600");
    expect(editor.get("[data-edit-diff]").classes()).toEqual(
      expect.arrayContaining(["ml-1", "inline-flex", "gap-1"]),
    );
    expect(editor.get('[data-slot="marker-content"]').text()).toContain("-5");
    expect(
      editor
        .get('[data-slot="marker-content"]')
        .findAll("span")
        .some((node) => node.classes().includes("text-destructive")),
    ).toBe(true);

    // No range when a whole file was read.
    const whole = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-3",
          input: { path: "/project/src/main.ts" },
          name: "read",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    expect(whole.get('[data-slot="marker-content"] code').text()).toBe(
      "main.ts",
    );
  });

  it("falls back to the command when a bash call has no description", () => {
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-1",
          input: { command: "bun run typecheck" },
          name: "bash",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });

    expect(wrapper.get('[data-slot="marker-content"]').text()).toBe(
      "已执行 bun run typecheck",
    );
  });
});
