// @ts-check
// SPDX-License-Identifier: AGPL-3.0-only
// Fixed-camera paper input. A rejected grab never falls back to camera orbit.
export function attachReadingInput(el, camera, hooks) {
  const pointers = new Map();
  const ownerWindow = el.ownerDocument.defaultView;
  let held = null, pinch = 0;
  const ndc = (e) => {
    const r = el.getBoundingClientRect();
    return [2 * (e.clientX - r.left) / r.width - 1, 1 - 2 * (e.clientY - r.top) / r.height];
  };
  const distance = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  };
  function end(cancelled, release = true) {
    if (held === null) return;
    const id = held; held = null;
    hooks.onEnd(cancelled);
    if (release) {
      pointers.delete(id);
      try { el.releasePointerCapture(id); } catch { /* capture already lost */ }
    }
  }
  function down(e) {
    if (e.button !== 0) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
    if (pointers.size > 1) {
      end(true, false); // Keep both captures while the gesture becomes a pinch.
      if (pointers.size === 2) pinch = distance();
      return;
    }
    el.focus({ preventScroll: true });
    if (hooks.onStart(ndc(e))) { held = e.pointerId; e.preventDefault(); }
  }
  function move(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
      const d = distance();
      if (pinch > 0 && d > 0) camera.zoom(pinch / d);
      pinch = d; hooks.onChange();
    } else if (held === e.pointerId) hooks.onMove(ndc(e));
  }
  function up(e) {
    if (held === e.pointerId) {
      if (e.type === 'pointerup') hooks.onMove(ndc(e));
      end(e.type !== 'pointerup');
    }
    pointers.delete(e.pointerId); pinch = 0;
    try { el.releasePointerCapture(e.pointerId); } catch { /* capture already lost */ }
  }
  function lost(e) { if (held === e.pointerId) end(true); pointers.delete(e.pointerId); }
  function wheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault(); camera.zoom(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015))); hooks.onChange();
  }
  function key(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    switch (e.key) {
      case 'ArrowLeft': end(true); hooks.onNavigate('backward'); break;
      case 'ArrowRight': end(true); hooks.onNavigate('forward'); break;
      case 'Escape': end(true); break;
      case '+': case '=': camera.zoom(0.9); break;
      case '-': case '_': camera.zoom(1.1); break;
      case '0': case 'Home': end(true); camera.reset(); break;
      default: return;
    }
    e.preventDefault(); hooks.onChange();
  }
  const cancel = () => {
    end(true);
    for (const id of pointers.keys()) try { el.releasePointerCapture(id); } catch { /* capture already lost */ }
    pointers.clear(); pinch = 0;
  };
  const visibility = () => { if (el.ownerDocument.hidden) cancel(); };
  const handlers = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: up, lostpointercapture: lost, blur: cancel, keydown: key };
  for (const [name, fn] of Object.entries(handlers)) el.addEventListener(name, fn);
  el.addEventListener('wheel', wheel, { passive: false });
  el.ownerDocument.addEventListener('visibilitychange', visibility);
  ownerWindow?.addEventListener('resize', cancel);
  return {
    cancel,
    destroy() {
      cancel();
      for (const [name, fn] of Object.entries(handlers)) el.removeEventListener(name, fn);
      el.removeEventListener('wheel', wheel);
      el.ownerDocument.removeEventListener('visibilitychange', visibility);
      ownerWindow?.removeEventListener('resize', cancel);
    },
  };
}
