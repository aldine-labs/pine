/**
 * Scroll tweening that mirrors the app's shared expand/collapse easing,
 * `--ease-out-expo` (cubic-bezier(0.16, 1, 0.3, 1)) from index.css. Native
 * `scrollTo({ behavior: "smooth" })` cannot take a custom curve, so programmatic
 * scrolls animate with the same solver instead.
 */

const EASE_OUT_EXPO_CONTROL_POINTS = {
  x1: 0.16,
  y1: 1,
  x2: 0.3,
  y2: 1,
} as const;

/** Polynomial coefficients for the cubic Bézier axis: (at³ + bt² + ct). */
function bezierAxisCoefficients(
  point1: number,
  point2: number,
): {
  a: number;
  b: number;
  c: number;
} {
  return {
    a: 1 - 3 * point2 + 3 * point1,
    b: 3 * point2 - 6 * point1,
    c: 3 * point1,
  };
}

function sampleBezierAxis(
  coefficients: { a: number; b: number; c: number },
  t: number,
): number {
  return ((coefficients.a * t + coefficients.b) * t + coefficients.c) * t;
}

/** Progress along cubic-bezier(0.16, 1, 0.3, 1) for a time in [0, 1]. */
export function easeOutExpo(time: number): number {
  const clamped = Math.min(1, Math.max(0, time));
  if (clamped === 0 || clamped === 1) return clamped;
  const x = bezierAxisCoefficients(
    EASE_OUT_EXPO_CONTROL_POINTS.x1,
    EASE_OUT_EXPO_CONTROL_POINTS.x2,
  );
  const y = bezierAxisCoefficients(
    EASE_OUT_EXPO_CONTROL_POINTS.y1,
    EASE_OUT_EXPO_CONTROL_POINTS.y2,
  );
  // Solve the horizontal axis for `time` with Newton–Raphson, falling back to
  // bisection when the derivative is flat near our fast-start control points.
  let parameter = clamped;
  for (let i = 0; i < 8; i++) {
    const currentX = sampleBezierAxis(x, parameter) - clamped;
    if (Math.abs(currentX) < 1e-6) return sampleBezierAxis(y, parameter);
    const derivative = (3 * x.a * parameter + 2 * x.b) * parameter + x.c;
    if (Math.abs(derivative) < 1e-6) break;
    parameter -= currentX / derivative;
  }
  let lower = 0;
  let upper = 1;
  parameter = clamped;
  while (lower < upper) {
    const currentX = sampleBezierAxis(x, parameter);
    if (Math.abs(currentX - clamped) < 1e-6) break;
    if (currentX < clamped) lower = parameter;
    else upper = parameter;
    parameter = (lower + upper) / 2;
  }
  return sampleBezierAxis(y, parameter);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const DEFAULT_DURATION_MS = 500;

export interface AnimateScrollTopOptions {
  /** Sweep duration in milliseconds (default 500). */
  duration?: number;
}

type CancelAnimation = () => void;

/**
 * One in-flight animation per element: calling again retargets from wherever
 * the element currently is, which is what a streaming follow-scroll wants.
 * Wheel / touch input cancels the animation so the reader always wins.
 */
const activeAnimations = new WeakMap<HTMLElement, CancelAnimation>();

const USER_INPUT_EVENTS = ["wheel", "touchstart"] as const;

export function animateScrollTop(
  element: HTMLElement,
  top: number,
  options: AnimateScrollTopOptions = {},
): CancelAnimation {
  activeAnimations.get(element)?.();
  const target = Math.max(0, Math.round(top));
  const distance = target - element.scrollTop;

  function cleanup(): void {
    for (const event of USER_INPUT_EVENTS) {
      element.removeEventListener(event, handleUserInput);
    }
    if (frame !== null) window.cancelAnimationFrame(frame);
    activeAnimations.delete(element);
  }

  function handleUserInput(): void {
    cleanup();
  }

  if (prefersReducedMotion() || Math.abs(distance) < 1) {
    element.scrollTop = target;
    return () => {};
  }

  const duration = options.duration ?? DEFAULT_DURATION_MS;
  const startTop = element.scrollTop;
  const startTime = performance.now();
  let frame: number | null = null;

  function step(now: number): void {
    frame = null;
    const progress = easeOutExpo((now - startTime) / duration);
    element.scrollTop = startTop + (target - startTop) * progress;
    if (now - startTime >= duration) {
      element.scrollTop = target;
      cleanup();
      return;
    }
    frame = window.requestAnimationFrame(step);
  }

  for (const event of USER_INPUT_EVENTS) {
    element.addEventListener(event, handleUserInput, { passive: true });
  }
  activeAnimations.set(element, cleanup);
  frame = window.requestAnimationFrame(step);

  return cleanup;
}
