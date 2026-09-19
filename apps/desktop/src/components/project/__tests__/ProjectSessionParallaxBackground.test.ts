import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProjectSessionParallaxBackground from "../ProjectSessionParallaxBackground.vue";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProjectSessionParallaxBackground", () => {
  it("spreads icons and clears their blur on reveal", async () => {
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

    wrapper.unmount();
  });

  it("spreads icon opacity evenly across the depth ranking", async () => {
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

    reveal?.(0);
    await nextTick();

    const opacities = wrapper
      .findAll("[data-parallax-icon]")
      .map((icon) =>
        Number.parseFloat(
          icon.attributes("style")!.match(/opacity: ([\d.]+)/)![1],
        ),
      )
      .sort((first, second) => first - second);
    const gaps = opacities
      .slice(1)
      .map((opacity, index) => opacity - opacities[index]);

    expect(opacities).toHaveLength(16);
    expect(opacities[0]).toBeCloseTo(0.1, 5);
    expect(opacities.at(-1)).toBeCloseTo(0.55, 5);
    expect(Math.min(...gaps)).toBeCloseTo(0.03, 5);
    expect(Math.max(...gaps)).toBeCloseTo(0.03, 5);

    wrapper.unmount();
  });
});
