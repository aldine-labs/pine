import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import SessionContextMenu from "../SessionContextMenu.vue";

const contextMenuStub = defineComponent({
  emits: ["update:open"],
  template: "<div><slot /></div>",
});

const contextMenuTriggerStub = defineComponent({
  inheritAttrs: false,
  template: '<div data-test="trigger" v-bind="$attrs"><slot /></div>',
});

const slotStub = { template: "<div><slot /></div>" };

describe("SessionContextMenu", () => {
  it("keeps the session item highlighted while its context menu is open", async () => {
    const wrapper = mount(SessionContextMenu, {
      props: {
        groups: [],
        session: {
          createdAt: "2026-08-25T00:00:00.000Z",
          id: "session-1",
          messageCount: 0,
          updatedAt: "2026-08-25T00:00:00.000Z",
        },
      },
      global: {
        plugins: [createAppI18n("en-US")],
        stubs: {
          ContextMenu: contextMenuStub,
          ContextMenuContent: slotStub,
          ContextMenuGroup: slotStub,
          ContextMenuItem: slotStub,
          ContextMenuTrigger: contextMenuTriggerStub,
        },
      },
      slots: {
        default: '<button data-test="session-item">Session</button>',
      },
    });

    const trigger = wrapper.get('[data-test="trigger"]');
    expect(trigger.classes()).not.toContain("bg-accent");

    wrapper.findComponent(contextMenuStub).vm.$emit("update:open", true);
    await nextTick();

    expect(trigger.classes()).toContain("bg-accent");
    expect(trigger.classes()).toContain("text-accent-foreground");

    wrapper.findComponent(contextMenuStub).vm.$emit("update:open", false);
    await nextTick();

    expect(trigger.classes()).not.toContain("bg-accent");
    wrapper.unmount();
  });
});
