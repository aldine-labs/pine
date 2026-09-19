import { mount, type VueWrapper } from "@vue/test-utils";
import { h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ParallaxFloat from "../ParallaxFloat.vue";
import ParallaxFloatElement from "../ParallaxFloatElement.vue";

let frames: FrameRequestCallback[] = [];
let mounted: VueWrapper[] = [];

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
});

afterEach(() => {
  for (const wrapper of mounted) wrapper.unmount();
  mounted = [];
  frames = [];
  vi.restoreAllMocks();
});

/** Mounts a float with one depth-1 element and returns its live transform. */
function mountFloat(verticalResistance: number): () => string {
  const wrapper = mount({
    render: () =>
      h(
        ParallaxFloat,
        { easingFactor: 1, sensitivity: -1, verticalResistance },
        { default: () => h(ParallaxFloatElement, { depth: 1 }) },
      ),
  });
  mounted.push(wrapper);
  const element = (wrapper.element as HTMLElement)
    .firstElementChild as HTMLElement;
  return () => element.style.transform;
}

function movePointerTo(x: number, y: number): void {
  window.dispatchEvent(
    new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }),
  );
}

function runFrames(): void {
  const pending = frames;
  frames = [];
  for (const frame of pending) frame(0);
}

describe("ParallaxFloat", () => {
  it("damps vertical pointer travel by the resistance factor", () => {
    const transform = mountFloat(0.15);

    movePointerTo(200, 200);
    runFrames();

    expect(transform()).toBe("translate3d(-10px, -1.5px, 0)");
  });

  it("keeps horizontal travel at full strength", () => {
    const transform = mountFloat(1);

    movePointerTo(200, 200);
    runFrames();

    expect(transform()).toBe("translate3d(-10px, -10px, 0)");
  });

  it("holds the vertical axis still when resistance is zero", () => {
    const transform = mountFloat(0);

    movePointerTo(0, 200);
    runFrames();

    expect(transform()).toBe("translate3d(0px, 0px, 0)");
  });
});
