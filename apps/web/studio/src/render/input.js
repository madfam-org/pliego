// @ts-check
// Pointer / wheel / keyboard camera control shared by both renderers.
//   left drag: orbit (or grab paper in grab mode, or with Shift held)
//   right drag, Ctrl/⌘ + drag, two-finger drag: pan
//   wheel, pinch, + / −: zoom
//   arrows: orbit (Shift + arrows: pan), 0 / Home: reset view
// Every listener is removed by destroy().

import { DEG } from './math.js';

/**
 * @param {HTMLCanvasElement} el
 * @param {import('./camera.js').OrbitCamera} camera
 * @param {{
 *   grabMode?: () => boolean,
 *   onGrabStart?: (ndc: [number, number]) => boolean,
 *   onGrabMove?: (ndc: [number, number]) => void,
 *   onGrabEnd?: () => void,
 *   onChange?: () => void,
 * }} [hooks]
 */
export function attachInput(el, camera, hooks = {}) {
  const pointers = new Map();
  let mode = /** @type {'none'|'orbit'|'pan'|'grab'|'pinch'} */ ('none');
  let pinch = { dist: 0, mid: [0, 0] };
  const changed = () => hooks.onChange && hooks.onChange();

  const ndcOf = (e) => {
    const r = el.getBoundingClientRect();
    return /** @type {[number, number]} */ ([((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2]);
  };
  const twoFinger = () => {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: [(a.x + b.x) / 2, (a.y + b.y) / 2] };
  };

  function onDown(e) {
    el.focus({ preventScroll: true });
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    if (pointers.size === 2) {
      if (mode === 'grab' && hooks.onGrabEnd) hooks.onGrabEnd();
      mode = 'pinch'; pinch = twoFinger();
      return;
    }
    const wantsGrab = (hooks.grabMode && hooks.grabMode()) || e.shiftKey;
    if (e.button === 0 && wantsGrab && hooks.onGrabStart && hooks.onGrabStart(ndcOf(e))) { mode = 'grab'; e.preventDefault(); return; }
    mode = e.button === 2 || e.ctrlKey || e.metaKey ? 'pan' : 'orbit';
    e.preventDefault();
  }

  function onMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const h = el.clientHeight || 1;
    if (mode === 'orbit') camera.orbit(-dx * 0.008, dy * 0.008);
    else if (mode === 'pan') camera.pan(dx / h, dy / h);
    else if (mode === 'grab' && hooks.onGrabMove) hooks.onGrabMove(ndcOf(e));
    else if (mode === 'pinch' && pointers.size === 2) {
      const now = twoFinger();
      if (pinch.dist > 0 && now.dist > 0) camera.zoom(pinch.dist / now.dist);
      camera.pan((now.mid[0] - pinch.mid[0]) / h, (now.mid[1] - pinch.mid[1]) / h);
      pinch = now;
    }
    changed();
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    try { el.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (mode === 'grab' && hooks.onGrabEnd) hooks.onGrabEnd();
    mode = pointers.size === 1 ? 'orbit' : 'none';
  }

  function onWheel(e) {
    e.preventDefault();
    const k = e.deltaMode === 1 ? 0.05 : 0.0015;
    camera.zoom(Math.exp(e.deltaY * k));
    changed();
  }

  function onKey(e) {
    const step = 5 * DEG;
    let used = true;
    switch (e.key) {
      case 'ArrowLeft': e.shiftKey ? camera.pan(-0.05, 0) : camera.orbit(step, 0); break;
      case 'ArrowRight': e.shiftKey ? camera.pan(0.05, 0) : camera.orbit(-step, 0); break;
      case 'ArrowUp': e.shiftKey ? camera.pan(0, -0.05) : camera.orbit(0, step); break;
      case 'ArrowDown': e.shiftKey ? camera.pan(0, 0.05) : camera.orbit(0, -step); break;
      case '+': case '=': camera.zoom(0.9); break;
      case '-': case '_': camera.zoom(1.1); break;
      case '0': case 'Home': camera.reset(); break;
      default: used = false;
    }
    if (used) { e.preventDefault(); changed(); }
  }

  const onContext = (e) => e.preventDefault();
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('keydown', onKey);
  el.addEventListener('contextmenu', onContext);

  return {
    destroy() {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('contextmenu', onContext);
      pointers.clear();
    },
  };
}
