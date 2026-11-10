// @ts-check
// Input wiring is separate from the studio's scheduling and document lifecycle.
import { attachInput } from './render/input.js';
import { rayPlane } from './render/camera.js';
import { attachLeafReader, readingLeaf } from './leaf-reader.js';
import { BookWorld } from './book-world.js';
import { attachBookReader } from './book-reader.js';

export function attachViewerInput(state, { wake, invalidate, onControl, stopPlayback, onUnavailable }) {
  const r = state.renderer;
  if (!r) return null;
  if (state.share.interaction === 'paper' && state.world instanceof BookWorld) return attachBookReader(r, {
    getWorld: () => state.world, onStart: stopPlayback, onHolding: held => { state.holdingLeaf = held; wake(); }, onChange: wake,
  });
  if (state.share.interaction === 'paper') return attachLeafReader(r, {
    leaf: state.engine?.kind === 'engine' ? readingLeaf(state.json) : null,
    getWorld: () => state.world, getControl: (id) => state.controls?.get(id),
    setControl: (id, value) => { state.controls?.set(id, value); onControl(id, value); },
    onStart: stopPlayback, onHolding: (held) => { state.holdingLeaf = held; wake(); }, onChange: invalidate,
  });
  return attachInput(r.canvas, r.camera, {
    grabMode: () => state.grabMode,
    onGrabStart(ndc) {
      if (!state.world) return false;
      if (state.world.capabilities && state.world.capabilities.grab === false) { onUnavailable(); return false; }
      const ray = r.camera.ray(ndc[0], ndc[1]);
      const hit = state.world.pick(ray.origin, ray.dir);
      if (!hit) return false;
      state.world.grab(hit.vertex, hit.point);
      state.grabbing = { plane: hit.point, normal: r.camera.forward() };
      wake();
      return true;
    },
    onGrabMove(ndc) {
      if (!state.grabbing || !state.world) return;
      const ray = r.camera.ray(ndc[0], ndc[1]);
      const p = rayPlane(ray.origin, ray.dir, state.grabbing.plane, state.grabbing.normal);
      if (p) state.world.moveGrab(p);
      wake();
    },
    onGrabEnd() { if (state.world) state.world.release(); state.grabbing = null; wake(); },
    onChange: invalidate,
  });
}
