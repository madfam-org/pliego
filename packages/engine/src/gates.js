// @ts-check
/**
 * Step-gated joins (spec §5.21): when a join holds, read from the fold program.
 *
 * - `active_from` (glue, pivot, string, pin): a step id or 0-based index. The join is inactive
 *   until that step has begun (sequence position p > k) and active from then on.
 * Scrubbing the program back re-applies the same rule (a join is a function of p).
 *
 * Shared by the engine (xpbd/gates.js) and mirrored by the studio's preview stub.
 */

/** Join types that may be step-gated. */
export const GATED_TYPES = new Set(['glue', 'pivot', 'string', 'pin']);

/**
 * Gate window of every gated join: `from` (step index; −1 = from the start) and `until` (step
 * index that releases it; Infinity = never). Joins without a gate are absent from the map.
 * @param {any} doc a loaded document, or raw JSON (`pliego:joins`, `pliego:sequence`)
 * @returns {Map<string, {from:number, until:number}>}
 */
export function joinGates(doc) {
  const joins = doc.joins ?? doc['pliego:joins'] ?? [];
  const seq = doc.sequence !== undefined ? doc.sequence : doc['pliego:sequence'];
  const steps = seq && Array.isArray(seq.steps) ? seq.steps : [];
  /** @type {Map<string, {from:number, until:number}>} */
  const out = new Map();
  for (const j of joins) {
    if (!j || j.active_from === undefined) continue;
    out.set(j.id, { from: stepIndex(steps, j.active_from), until: Infinity });
  }
  return out;
}

/** Step index of an `active_from` reference (an index or a step id); −2 when it does not resolve. @param {any[]} steps @param {any} ref */
export function stepIndex(steps, ref) {
  if (Number.isInteger(ref)) return ref >= 0 && ref < steps.length ? ref : -2;
  if (typeof ref === 'string') { const k = steps.findIndex((st) => st && st.id === ref); return k >= 0 ? k : -2; }
  return -2;
}

/**
 * Does a gated join hold at sequence position p?
 * @param {{from:number, until:number}} g @param {number} p
 */
export function gateHolds(g, p) {
  return (g.from < 0 || p > g.from) && !(p > g.until);
}

/**
 * Rule 21: `active_from` is well formed. Appends problems to P.
 * @param {any[]} joins @param {any} seq @param {string[]} P
 */
export function checkJoinGates(joins, seq, P) {
  const steps = seq && Array.isArray(seq.steps) ? seq.steps : [];
  joins.forEach((j, i) => {
    if (!j || j.active_from === undefined) return;
    const w = `pliego:joins[${i}] (${j.id})`;
    if (!GATED_TYPES.has(j.type)) P.push(`rule 21: ${w} type ${j.type} cannot carry active_from`);
    else if (!steps.length) P.push(`rule 21: ${w}.active_from needs a pliego:sequence`);
    else if (stepIndex(steps, j.active_from) < 0) P.push(`rule 21: ${w}.active_from ${JSON.stringify(j.active_from)} is not a step id or index of the program`);
  });
}
