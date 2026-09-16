import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProjectSessionParallaxBackground from "../ProjectSessionParallaxBackground.vue";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ProjectSessionParallaxBackground", () => {
  it("spreads icons on reveal and draws them inward before disappearing", async () => {
    vi.useFakeTimers();
    let reveal: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      reveal = callback;
      return 1;
    });
    const wrapper = mount(ProjectSessionParallaxBackground, {
      global: {
        stubs: {
          ParallaxFloat: { template: "<div><slot /></div>" },
          ParallaxFloatElement: { template: "<div><slot /></div>" },
        },
      },
    });
    const icon = wrapper.findAll("[data-parallax-icon]")[0];
    const inwardLeft = Number.parseFloat(
      icon.attributes("style")!.match(/left: ([\d.]+)%/)![1],
    );
    expect(icon.attributes("style")).toContain("scale: 0.92");

    reveal?.(0);
    await nextTick();
    const outwardLeft = Number.parseFloat(
      icon.attributes("style")!.match(/left: ([\d.]+)%/)![1],
    );
    expect(Math.abs(outwardLeft - 50)).toBeGreaterThan(
      Math.abs(inwardLeft - 50),
    );
    expect(Math.abs(outwardLeft - inwardLeft)).toBeCloseTo(
      Math.abs(outwardLeft - 50) * 0.15,
    );
    expect(icon.attributes("style")).toContain("scale: 1");
    expect(icon.classes()).toContain("transition-[left,top,opacity,scale]");

    await wrapper.setProps({ fadeOut: true });
    expect(icon.attributes("style")).toContain(`left: ${inwardLeft}%`);
    expect(icon.attributes("style")).toContain("scale: 0.92");
    vi.advanceTimersByTime(1199);
    expect(wrapper.emitted("faded")).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(wrapper.emitted("faded")).toHaveLength(1);
    wrapper.unmount();
  });
});
