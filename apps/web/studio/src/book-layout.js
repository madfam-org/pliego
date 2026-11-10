// @ts-check
// Native codex admission and bounded reading poses. Source/export geometry stays unchanged.
const near = (a, b) => Math.abs(a - b) < 1e-6;
export function readingBook(json) {
  const sheets = json?.['pliego:sheets'] || [], mechanisms = json?.['pliego:mechanisms'] || [];
  if (sheets.length < 2 || sheets.length > 32 || mechanisms.length !== sheets.length || json['pliego:sequence']) return null;
  if (!Array.isArray(json.vertices_coords) || !Array.isArray(json['pliego:vertices_sheet']) || !json['pliego:stocks'] || !json['pliego:meta']) return null;
  if (!json.file_frames?.some(f => f.frame_title === 'initial' && f.vertices_coords?.length === json.vertices_coords.length)) return null;
  const joins = json['pliego:joins'] || [];
  if (joins.length !== sheets.length) return null;
  const leaves = [], used = new Set();
  for (const m of mechanisms) {
    const sheet = sheets.findIndex(s => s.id === m.sheet), sh = sheets[sheet];
    const c = (json['pliego:controls'] || []).find(c => c.id === m.control);
    if (m.type !== 'leaf' || m.keys || !sh || sh.kinematic || used.has(m.control) || leaves.some(l => l.sheet === sheet) || c?.kind !== 'angle' || c.min !== 0 || c.max !== 180 || c.default !== 0) return null;
    const q = sh.placement?.rotation || [0, 0, 0, 1], origin = sh.placement?.origin || [0, 0, 0];
    if (q.length !== 4 || origin.length !== 3 || !origin.every(Number.isFinite)) return null;
    if (!q.every((v, i) => near(v, i === 3 ? 1 : 0))) return null;
    if (!m.spine || m.spine.length !== 2 || !near(m.spine[0][0], 0) || !near(m.spine[1][0], 0) || !near(m.spine[0][1], 0) || !(m.spine[1][1] > 0)) return null;
    const pins = joins.filter(j => j.a?.sheet === sh.id);
    if (pins.length !== 1 || pins[0].type !== 'pin' || pins[0].world != null || pins[0].mechanism || JSON.stringify(pins[0].a.along) !== JSON.stringify(m.spine)) return null;
    const vs = json.vertices_coords.filter((_, i) => json['pliego:vertices_sheet'][i] === sheet);
    const off = sh.offset || [0, 0], uv = vs.map(p => [p[0] - off[0], p[1] - off[1]]);
    const width = Math.max(...uv.map(p => p[0])), height = m.spine[1][1];
    if (uv.length !== 4 || new Set(uv.map(p => p.join(','))).size !== 4 || !uv.every(p => (near(p[0], 0) || near(p[0], width)) && (near(p[1], 0) || near(p[1], height))) || !(width > 0)) return null;
    leaves.push({ sheet, id: sh.id, control: c.id, mechanism: m.id, origin, width, height }); used.add(c.id);
  }
  leaves.sort((a, b) => b.origin[1] - a.origin[1]);
  const first = leaves[0];
  if (leaves.some(l => !near(l.origin[0], first.origin[0]) || !near(l.origin[2], first.origin[2]) || !near(l.width, first.width) || !near(l.height, first.height))) return null;
  const gap = Math.max(0.12, ...sheets.map(s => json['pliego:stocks'][s.stock]?.derived?.collision_thickness || 0.12));
  return { leaves, width: first.width, height: first.height, origin: first.origin, gap, pages: leaves.length * 2 };
}

/** An independent reading pose: one flexible native leaf, resting sheets held fixed. */
export function readingPose(source, book, active) {
  if (!Number.isInteger(active) || active < 0 || active >= book.leaves.length) throw new RangeError('Unknown reading leaf');
  const json = structuredClone(source), selected = book.leaves[active];
  const sheets = json['pliego:sheets'];
  const baseY = Math.max(...book.leaves.map(l => l.origin[1]), book.gap) + book.gap;
  const initial = json.file_frames?.find(f => f.frame_title === 'initial');
  if (!initial) throw new Error('Reading requires a native initial pose');
  for (const [i, l] of book.leaves.entries()) {
    const sh = sheets[l.sheet], left = i < active;
    const y = baseY + (i === active ? book.leaves.length + 1 : left ? i : book.leaves.length - 1 - i) * book.gap;
    sh.placement = { origin: [book.origin[0], y, book.origin[2]], rotation: left ? [0, 0, 1, 0] : [0, 0, 0, 1] };
    sh.kinematic = i === active ? null : { mechanism: selected.mechanism };
    for (let v = 0; v < json.vertices_coords.length; v++) if (json['pliego:vertices_sheet'][v] === l.sheet) {
      const p = json.vertices_coords[v], off = sh.offset || [0, 0], u = p[0] - off[0], w = p[1] - off[1];
      initial.vertices_coords[v] = [book.origin[0] + (left ? -u : u), y, book.origin[2] - w];
    }
  }
  json['pliego:mechanisms'] = json['pliego:mechanisms'].filter(m => m.id === selected.mechanism);
  for (const c of json['pliego:controls']) c.default = 0;
  json['pliego:meta'].digest = null;
  return json;
}

export function spreadPages(position, count) {
  if (!Number.isInteger(position) || position < 0 || position > count) throw new RangeError('Unknown reading position');
  return position === 0 ? [1] : position === count ? [count * 2] : [position * 2, position * 2 + 1];
}

export function fitBookCamera(renderer, book) {
  const camera = renderer.camera, aspect = (renderer.canvas.clientWidth || 1) / (renderer.canvas.clientHeight || 1);
  camera.yaw = 0; camera.pitch = 67 * Math.PI / 180;
  camera.fit([book.origin[0], book.width * 0.15, book.origin[2] - book.height / 2], Math.hypot(book.width, book.height / 2));
  camera.zoom(Math.max(0.7, 0.98 / Math.max(0.5, aspect)));
  camera.home.distance = camera.distance;
}
