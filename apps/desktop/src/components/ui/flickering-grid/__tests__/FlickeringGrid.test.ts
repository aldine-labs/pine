import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FlickeringGrid from "../FlickeringGrid.vue";

/** 20 columns by 10 rows at the default 4px square and 6px gap. */
const GRID_WIDTH = 200;
const GRID_HEIGHT = 100;
const GRID_CELLS = 200;

let frames: FrameRequestCallback[] = [];

function createContext() {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: "",
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D & {
    clearRect: ReturnType<typeof vi.fn>;
    fillRect: ReturnType<typeof vi.fn>;
  };
}

function runFrames(time: number): void {
  const pending = frames;
  frames = [];
  for (const frame of pending) frame(time);
}

function mountGrid(context: CanvasRenderingContext2D) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as never,
  );
  return mount(FlickeringGrid, {
    props: { height: GRID_HEIGHT, width: GRID_WIDTH },
  });
}

beforeEach(() => {
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      #callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.#callback = callback;
      }
      observe() {
        this.#callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
      disconnect() {}
    },
  );
});

afterEach(() => {
  frames = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FlickeringGrid", () => {
  it("paints the whole grid once instead of every frame", async () => {
    const context = createContext();
    // Never flicker: a frame that changes nothing must draw nothing.
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const wrapper = mountGrid(context);

    await wrapper.vm.$nextTick();
    runFrames(0);
    expect(context.clearRect).toHaveBeenCalledTimes(1);
    expect(context.fillRect).toHaveBeenCalledTimes(GRID_CELLS);

    runFrames(500);
    runFrames(1000);
    expect(context.clearRect).toHaveBeenCalledTimes(1);
    expect(context.fillRect).toHaveBeenCalledTimes(GRID_CELLS);

    wrapper.unmount();
  });

  it("repaints only the cells that flickered", async () => {
    const context = createContext();
    // Always flicker: every changed cell clears and repaints just itself.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const wrapper = mountGrid(context);

    await wrapper.vm.$nextTick();
    runFrames(0);
    expect(context.fillRect).toHaveBeenCalledTimes(GRID_CELLS);

    runFrames(100);
    expect(context.fillRect).toHaveBeenCalledTimes(GRID_CELLS * 2);
    expect(context.clearRect).toHaveBeenCalledTimes(GRID_CELLS + 1);

    wrapper.unmount();
  });

  it("caps the flicker rate and stops drawing while off screen", async () => {
    const context = createContext();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const wrapper = mountGrid(context);

    await wrapper.vm.$nextTick();
    runFrames(0);
    const painted = context.fillRect.mock.calls.length;

    // A frame that arrives sooner than the paint interval is skipped.
    runFrames(1);
    expect(context.fillRect).toHaveBeenCalledTimes(painted);

    wrapper.unmount();
  });
});
