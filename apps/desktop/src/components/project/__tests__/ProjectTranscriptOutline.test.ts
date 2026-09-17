import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import MessageScrollerContent from "@/components/ui/message-scroller/MessageScrollerContent.vue";
import MessageScrollerItem from "@/components/ui/message-scroller/MessageScrollerItem.vue";
import MessageScrollerViewport from "@/components/ui/message-scroller/MessageScrollerViewport.vue";
import { provideMessageScroller } from "@/components/ui/message-scroller/useMessageScroller";
import type { PineTranscriptMessage } from "@/stores/session";
import ProjectTranscriptOutline from "../ProjectTranscriptOutline.vue";

function turn(id: string): PineTranscriptMessage {
  return {
    id,
    createdAt: "2026-09-01T00:00:00Z",
    role: "user",
    status: "complete",
    blocks: [{ type: "text", text: id }],
  };
}

describe("ProjectTranscriptOutline navigation", () => {
  it("waits for the target item to mount before scrolling once", async () => {
    const target = turn("oldest");
    const turns = [target, turn("middle"), turn("newest")];
    const loaded = ref(turns.slice(1));
    let resolveLoad: (() => void) | undefined;
    const ensureMessageLoaded = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = () => {
            loaded.value = turns;
            resolve();
          };
        }),
    );
    const scrollResults: boolean[] = [];
    const scrollToMessage = vi.fn();
    const wrapper = mount(
      defineComponent({
        setup() {
          const engine = provideMessageScroller({ autoScroll: false });
          const originalScrollToMessage = engine.context.scrollToMessage;
          engine.context.scrollToMessage = (messageId, options) => {
            scrollToMessage(messageId, options);
            const result = originalScrollToMessage(messageId, options);
            scrollResults.push(result);
            return result;
          };
          return () =>
            h("div", [
              h(MessageScrollerViewport, null, {
                default: () =>
                  h(MessageScrollerContent, null, {
                    default: () =>
                      loaded.value.map((message) =>
                        h(
                          MessageScrollerItem,
                          {
                            key: message.id,
                            messageId: message.id,
                            scrollAnchor: true,
                          },
                          { default: () => message.id },
                        ),
                      ),
                  }),
              }),
              h(ProjectTranscriptOutline, { turns, ensureMessageLoaded }),
            ]);
        },
      }),
      {
        global: {
          plugins: [createAppI18n("en-US")],
          stubs: {
            HoverCard: { template: "<div><slot /></div>" },
            HoverCardTrigger: { template: "<div><slot /></div>" },
            HoverCardContent: { template: "<div><slot /></div>" },
          },
        },
      },
    );

    await wrapper
      .get('[data-slot="project-transcript-outline-menu"] button')
      .trigger("click");
    expect(ensureMessageLoaded).toHaveBeenCalledWith(target.id);
    expect(scrollToMessage).not.toHaveBeenCalled();

    resolveLoad?.();
    await nextTick();
    await nextTick();
    expect(scrollToMessage).toHaveBeenCalledTimes(1);
    expect(scrollResults).toEqual([true]);

    await wrapper
      .get('[data-slot="project-transcript-outline-menu"] button')
      .trigger("click");
    await wrapper
      .get('[data-slot="message-scroller-viewport"]')
      .trigger("wheel");
    resolveLoad?.();
    await nextTick();
    await nextTick();
    expect(scrollToMessage).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
