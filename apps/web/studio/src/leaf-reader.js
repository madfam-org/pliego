// @ts-check
// SPDX-License-Identifier: AGPL-3.0-only
import { attachReadingInput } from './render/reading-input.js';

/** Only an unkeyed, single native leaf with the documented 0..180 degree control. */
export function readingLeaf(json) {
  const leaves = (json?.['pliego:mechanisms'] || []).filter((m) => m.type === 'leaf');
  if (leaves.length !== 1 || leaves[0].keys) return null;
  const leaf = leaves[0];
  const sheets = json['pliego:sheets'] || [];
  const control = (json['pliego:controls'] || []).find((c) => c.id === leaf.control);
  const sheet = sheets.findIndex((s) => s.id === leaf.sheet);
  if (sheet < 0 || !control || control.kind !== 'angle' || control.min !== 0 || control.max !== 180) return null;
  return { sheet, control: control.id };
}

/**
 * Bind the owning World's native leaf control, including WorkerWorld. Geometry
 * remains native: horizontal hand travel drives the soft fore-edge hand band.
 * The caller owns scheduling, controls, engine availability and error handling.
 */
export function attachLeafReader(renderer, { leaf, getWorld, getControl, setControl, onStart, onHolding, onChange }) {
  let hand = null;
  const put = (value) => setControl(leaf.control, Math.max(0, Math.min(180, value)));
  const input = attachReadingInput(renderer.canvas, renderer.camera, {
    onStart(ndc) {
      if (!leaf) return false;
      const world = getWorld();
      if (!world) return false;
      const ray = renderer.camera.ray(ndc[0], ndc[1]);
      const hit = world.pick(ray.origin, ray.dir);
      if (!hit || hit.sheet !== leaf.sheet) return false;
      const value = Number(getControl(leaf.control));
      if (!Number.isFinite(value)) return false;
      onStart();
      hand = { x: ndc[0], initial: value, value };
      onHolding(true);
      return true;
    },
    onMove(ndc) {
      if (!hand) return;
      hand.value = Math.max(0, Math.min(180, hand.initial + (hand.x - ndc[0]) * 90));
      put(hand.value);
    },
    onEnd(cancelled) {
      if (!hand) return;
      const value = cancelled ? hand.initial : hand.value >= 90 ? 180 : 0;
      hand = null;
      onHolding(false); put(value);
    },
    onNavigate(direction) {
      if (!leaf || !getWorld()) return;
      onStart(); put(direction === 'forward' ? 180 : 0);
    },
    onChange,
  });
  return input;
}
