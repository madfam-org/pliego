// @ts-check
import { attachReadingInput } from './render/reading-input.js';
import { rayPlane } from './render/camera.js';

/** Sequential reading: only the exposed right leaf or last turned left leaf can move. */
export function attachBookReader(renderer, { getWorld, onStart, onHolding, onChange }) {
  let hand = null;
  const input = attachReadingInput(renderer.canvas, renderer.camera, {
    onStart(ndc) {
      const world = getWorld();
      if (!world || world.readingBusy) return false;
      const ray = renderer.camera.ray(ndc[0], ndc[1]), hit = world.pick(ray.origin, ray.dir);
      if (!hit) return false;
      const start = rayPlane(ray.origin, ray.dir, hit.point, [0, 1, 0]);
      if (!start) return false;
      const index = world.book.leaves.findIndex(l => l.sheet === hit.sheet);
      if (!world.select(index)) return false;
      onStart();
      const initial = index < world.position ? 180 : 0;
      const radius = Math.max(world.book.width * 0.25, Math.abs(start[0] - world.book.origin[0]));
      hand = { world, index, initial, value: initial, x: start[0], plane: hit.point, radius, position: world.position };
      onHolding(true); return true;
    },
    onMove(ndc) {
      if (!hand) return;
      const ray = renderer.camera.ray(ndc[0], ndc[1]), p = rayPlane(ray.origin, ray.dir, hand.plane, [0, 1, 0]);
      if (!p) return;
      const cos = (hand.initial === 180 ? -1 : 1) + (p[0] - hand.x) / hand.radius;
      hand.value = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
      hand.world.setControl(hand.world.book.leaves[hand.index].control, hand.value);
      onChange();
    },
    onEnd(cancelled) {
      if (!hand) return;
      const done = hand; hand = null;
      const goal = cancelled ? done.initial : done.value >= 90 ? 180 : 0;
      done.world.finish(goal, cancelled ? done.position : done.index + (goal === 180 ? 1 : 0));
      onHolding(false); onChange();
    },
    onNavigate(direction) { if (getWorld()?.navigate(direction)) { onStart(); onChange(); } },
    onChange,
  });
  return {
    ...input,
    navigate(direction) { input.cancel(); if (getWorld()?.navigate(direction)) { onStart(); onChange(); } },
    reset() { input.cancel(); if (getWorld()?.goTo(0)) { onStart(); onChange(); } },
  };
}
