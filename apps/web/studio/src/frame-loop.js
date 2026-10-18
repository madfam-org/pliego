// @ts-check
// Frame scheduling for the 3-D view, DOM-free so Node tests cover it: whether the pose changed since
// the last frame (so an unchanged frame uploads and draws nothing), when the loop may stop asking
// for animation frames, and the backing-store size of the canvas (pixel ratio capped on touch
// devices, a pixel budget on very large screens).

/** Device-pixel-ratio caps: fine pointers (desktop) and coarse pointers (phones, tablets). */
export const DPR_CAP_FINE = 2;
export const DPR_CAP_COARSE = 1.5;
/** Backing-store budgets in device pixels: about 2560 × 1600 on a desktop, 1600 × 1250 on touch. */
export const PIXEL_BUDGET_FINE = 4.2e6;
export const PIXEL_BUDGET_COARSE = 2.0e6;
/** Hard cap per side (a runaway layout must never allocate a giant backing buffer). */
export const MAX_SIDE = 4096;
/**
 * Identical frames in a row before the loop stops. The preview changes only when a control does,
 * so two are enough; the paper engine may hold still for a moment and then move on (a settling
 * sheet, a rate-limited control), so it gets a second and a half.
 */
export const QUIET_FRAMES_PREVIEW = 2;
export const QUIET_FRAMES_ENGINE = 90;

/**
 * Canvas backing-store size for a CSS size and pixel ratio.
 * @param {number} cssW @param {number} cssH @param {number} dpr @param {boolean} coarse
 * @returns {[number, number]}
 */
export function backingSize(cssW, cssH, dpr, coarse) {
  let s = Math.min(dpr > 0 ? dpr : 1, coarse ? DPR_CAP_COARSE : DPR_CAP_FINE);
  const budget = coarse ? PIXEL_BUDGET_COARSE : PIXEL_BUDGET_FINE;
  const px = Math.max(1, cssW) * Math.max(1, cssH) * s * s;
  if (px > budget) s *= Math.sqrt(budget / px);
  return [
    Math.min(MAX_SIDE, Math.max(1, Math.round(cssW * s))),
    Math.min(MAX_SIDE, Math.max(1, Math.round(cssH * s))),
  ];
}

/** Whether the page runs on a coarse (touch) pointer; false outside a browser. */
export function coarsePointer() {
  try {
    return !!(globalThis.matchMedia && globalThis.matchMedia('(pointer: coarse)').matches);
  } catch {
    return false;
  }
}

/**
 * Remembers the last rendered pose (positions and the index buffer it was drawn with) and says
 * whether a new one differs. One scratch copy, grown only when a mesh is larger than any before.
 */
export function createChangeTracker() {
  let prev = new Float64Array(0);
  let count = -1;
  /** @type {ArrayLike<number> | null} */
  let indices = null;
  let indexCount = -1;
  return {
    /**
     * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}} r
     * @returns {boolean} true when the pose or the topology changed (and records the new one)
     */
    changed(r) {
      const P = r.positions, n = P.length;
      let diff = n !== count || r.indices !== indices || r.indices.length !== indexCount;
      if (!diff) {
        for (let i = 0; i < n; i++) if (prev[i] !== P[i]) { diff = true; break; }
      }
      if (diff) {
        if (prev.length < n) prev = new Float64Array(n);
        for (let i = 0; i < n; i++) prev[i] = P[i];
        count = n; indices = r.indices; indexCount = r.indices.length;
      }
      return diff;
    },
    /** Forget the last pose (a new document): the next frame counts as changed. */
    reset() { count = -1; indices = null; indexCount = -1; },
  };
}

/**
 * rAF timestamps are coarsened (to 0.1 ms or more), so a 60 Hz display reports frames of 16.6 ms
 * as often as 16.7 ms; a step is owed once the accumulated time is within this of a whole step.
 */
export const STEP_SLACK = 0.1;

/**
 * Fixed steps owed this frame: at most `maxSteps`, and when the cap is hit the backlog is dropped
 * (slow frames slow the simulation down; they never make the next frame slower).
 * @param {number} acc seconds carried from earlier frames (may be slightly negative)
 * @param {number} dt seconds since the last frame
 * @param {number} step fixed step (s)
 * @param {number} maxSteps
 * @returns {{n: number, acc: number}}
 */
export function planSteps(acc, dt, step, maxSteps) {
  let a = acc + dt, n = 0;
  while (a >= step * (1 - STEP_SLACK) && n < maxSteps) { a -= step; n++; }
  if (n === maxSteps && n > 0) a = Math.min(a, 0);
  return { n, acc: a };
}

/**
 * Whether the loop should ask for another animation frame.
 * @param {{playing: boolean, redraw: boolean, grabbing: boolean, pending: boolean, quietFrames: number, engine: 'engine'|'stub', hidden: boolean}} s
 */
export function keepRunning(s) {
  if (s.hidden) return false;
  if (s.playing || s.redraw || s.grabbing || s.pending) return true;
  return s.quietFrames < (s.engine === 'engine' ? QUIET_FRAMES_ENGINE : QUIET_FRAMES_PREVIEW);
}
