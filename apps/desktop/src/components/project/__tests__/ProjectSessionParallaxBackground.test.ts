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
    const icons = wrapper.findAll("[data-parallax-icon]");
    expect(icons).toHaveLength(16);
    expect(
      new Set(icons.map((icon) => icon.attributes("data-parallax-icon"))).size,
    ).toBe(16);
    const icon = icons[0];
    const inwardLeft = Number.parseFloat(
      icon.attributes("style")!.match(/left: ([\d.]+)%/)![1],
    );
    expect(icon.attributes("style")).toContain("scale: 0.92");
    expect(icon.attributes("style")).toContain("filter: blur(8px)");

    reveal?.(0);
    await nextTick();
    const positions = icons.map((entry) => {
      const { left, top } = (entry.element as HTMLElement).style;
      return { x: Number.parseFloat(left), y: Number.parseFloat(top) };
    });
    expect(positions.filter((position) => position.x < 50)).toHaveLength(8);
    expect(positions.filter((position) => position.x > 50)).toHaveLength(8);
    expect(
      positions.some(({ x, y }) => x > 38 && x < 62 && y > 30 && y < 70),
    ).toBe(false);
    for (let index = 0; index < positions.length; index += 1) {
      for (let other = index + 1; other < positions.length; other += 1) {
        expect(
          Math.hypot(
            positions[index].x - positions[other].x,
            positions[index].y - positions[other].y,
          ),
        ).toBeGreaterThan(16);
      }
    }
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
    expect(icon.attributes("style")).toContain("filter: blur(0px)");
    expect(icon.classes()).toContain(
      "transition-[left,top,opacity,scale,filter]",
    );

    const mostVisibleIndex = icons.reduce(
      (best, entry, index) =>
        Number((entry.element as HTMLElement).style.opacity) >
        Number((icons[best].element as HTMLElement).style.opacity)
          ? index
          : best,
      0,
    );
    await wrapper.setProps({ fadeOut: true });
    expect(icon.attributes("style")).toContain(`left: ${inwardLeft}%`);
    expect(icon.attributes("style")).toContain("scale: 0.96");
    expect(icon.attributes("style")).toContain("filter: blur(8px)");
    const exitStyles = icons.map(
      (entry) => (entry.element as HTMLElement).style,
    );
    const mostVisible = exitStyles[mostVisibleIndex];
    expect(mostVisible.transitionDelay).toBe("40ms, 40ms, 0ms, 40ms, 0ms");
    expect(mostVisible.transitionDuration).toBe(
      "700ms, 700ms, 420ms, 700ms, 420ms",
    );
    expect(mostVisible.transitionTimingFunction).toBe("var(--ease-out-expo)");
    expect(new Set(exitStyles.map((style) => style.transitionDelay)).size).toBe(
      16,
    );
    vi.advanceTimersByTime(1039);
    expect(wrapper.emitted("faded")).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(wrapper.emitted("faded")).toHaveLength(1);
    wrapper.unmount();
  });
});
