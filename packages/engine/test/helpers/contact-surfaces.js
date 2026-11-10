// Authored analytical triangle fixtures, not fabricated kernel documents.
export function surfacePair() {
  const x = new Float64Array([-1, 0, 0, 1, 0, 0, 0, 0, -2, -0.5, 0.12, 0, 0.5, 0.12, 0, 0, 0.12, 2]);
  return world(x, [0, 1, 2, 3, 4, 5], [0, 1, 1, 2, 2, 0, 3, 4, 4, 5, 5, 3], [0, 0, 0, 1, 1, 1], [0, 1]);
}

export function centerFan() {
  const x = new Float64Array([-1, 0, 0, 1, 0, 0, 2, 0.2, 1, -0.5, 0.12, 0, 0.5, 0.12, 0, -2, 0.2, 1, 0, 0, 2]);
  const edges = [], tris = [];
  for (let i = 0; i < 6; i++) { edges.push(i, (i + 1) % 6, 6, i); tris.push(6, i, (i + 1) % 6); }
  return world(x, tris, edges, Array(7).fill(0), Array(6).fill(0));
}

function world(x, tris, edges, sheets, triSheet) {
  const nV = x.length / 3;
  return { x, X0: x.slice(), mesh: { nV, nT: tris.length / 3, nE: edges.length / 2, tris: Int32Array.from(tris), edges: Int32Array.from(edges),
    vGroup: Int32Array.from({ length: nV }, (_, i) => i), vSheet: Int32Array.from(sheets), triSheet: Int32Array.from(triSheet) },
    doc: { sheets: [0, 1].map(() => ({ derived: { collision_thickness: 0.1 } })) },
    fixed: new Uint8Array(nV), opts: { ground: false, edgeEdgeMollification: 'surface-guarded' }, contact: { weldSheet: new Int32Array(nV).fill(-1) } };
}
