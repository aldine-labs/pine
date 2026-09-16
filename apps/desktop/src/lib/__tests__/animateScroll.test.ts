import { afterEach, describe, expect, it, vi } from "vitest";
import { animateScrollTop, easeOutExpo } from "../animateScroll";

interface FrameClock {
  now: () => number;
  flush: (ms: number) => void;
}

function installFrameClock(): FrameClock {
  const queue = new Map<number, (now: number) => void>();
  let handle = 0;
  let time = 0;
  vi.stubGlobal("performance", { now: () => time });
  vi.stubGlobal("requestAnimationFrame", (callback: (now: number) => void) => {
    queue.set(++handle, callback);
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => queue.delete(id));
  return {
    now: () => time,
    flush(ms: number) {
      const end = time + ms;
      while (time < end) {
        time += 16;
        for (const [id, callback] of [...queue]) {
          if (queue.has(id)) {
            queue.delete(id);
            callback(time);
          }
        }
      }
    },
  };
}

function createScroller(initialTop = 0): HTMLElement {
  const element = document.createElement("div");
  let top = initialTop;
  Object.defineProperty(element, "scrollTop", {
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });
  return element;
}

describe("easeOutExpo", () => {
  it("matches the shared cubic-bezier endpoints", () => {
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
  });

  it("starts fast like the expo curve and stays monotonic within bounds", () => {
    // At ~15% of the sweep, cubic-bezier(0.16, 1, 0.3, 1) is already past 55%.
    expect(easeOutExpo(0.15)).toBeGreaterThan(0.55);
    let previous = 0;
    for (let step = 0; step <= 20; step++) {
      const value = easeOutExpo(step / 20);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });
});

describe("animateScrollTop", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("sweeps toward the target along the easing and lands exactly on it", () => {
    const clock = installFrameClock();
    const element = createScroller();
    animateScrollTop(element, 1000);
    clock.flush(150);
    const midTop = element.scrollTop;
    expect(midTop).toBeGreaterThan(500);
    expect(midTop).toBeLessThan(1000);
    clock.flush(400);
    expect(element.scrollTop).toBe(1000);
  });

  it("retargets from the current position when called again", () => {
    const clock = installFrameClock();
    const element = createScroller();
    animateScrollTop(element, 1000);
    clock.flush(80);
    animateScrollTop(element, 200);
    clock.flush(600);
    expect(element.scrollTop).toBe(200);
  });

  it("jumps instantly under prefers-reduced-motion", () => {
    installFrameClock();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const element = createScroller();
    animateScrollTop(element, 800);
    expect(element.scrollTop).toBe(800);
  });
});
