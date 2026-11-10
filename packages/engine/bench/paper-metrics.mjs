// Reading completion is not physical progress: promotion can flatten a stalled
// leaf. Measure the actual fore-edge before promotion against its source radius.
export function endpointProgress(w, active, positions, goal) {
  const m = w.mesh;
  let spine = Infinity, width = 0, progress = 0, count = 0, minimum = Infinity;
  for (let v = 0; v < m.nV; v++) if (m.vSheet[v] === active) spine = Math.min(spine, w.X0[3 * v]);
  for (let v = 0; v < m.nV; v++) if (m.vSheet[v] === active) width = Math.max(width, w.X0[3 * v] - spine);
  for (let v = 0; v < m.nV; v++) if (m.vSheet[v] === active && w.X0[3 * v] - spine >= 0.75 * width) {
    const ratio = (positions[3 * v] - spine) / (w.X0[3 * v] - spine);
    const p = (1 + (goal === 180 ? -ratio : ratio)) / 2;
    progress += p; count++; minimum = Math.min(minimum, p);
  }
  return { mean: count ? progress / count : null, minimum: count ? minimum : null, samples: count };
}
