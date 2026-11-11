// Read-only extraction of comparator maxima, agreement gates and paired controls from a bending capture report.
import { readFileSync } from 'node:fs';
const report = JSON.parse(readFileSync(process.argv[2], 'utf8')), g = report.results[0], f = x => x === null || x === undefined ? 'null' : typeof x === 'number' ? x.toExponential(2) : JSON.stringify(x);
const rows = g.trajectories.map(t => { const a = t.maxima.authoritative, p = t.maxima.public;
  return { row: `L${t.level} I${t.budget} prev=${t.seed ? 'T' : 'F'}`, oop: { beDisp: a.discreteDisplacement, beVel: a.discreteVelocity, beEnergy: a.discreteEnergy, ctDisp: a.continuousDisplacement, ctVel: a.continuousVelocity, ctEnergy: a.continuousEnergy, phase: a.phaseCycles },
    full: { beDisp: a.fullDiscreteDisplacement, beVel: a.fullDiscreteVelocity, beEnergy: a.fullDiscreteEnergy }, coupling: a.membraneCouplingEnergy, inPlane: a.inPlaneRelative, clock: a.clockRelative,
    publicOop: { beDisp: p.discreteDisplacement, beVel: p.discreteVelocity, beEnergy: p.discreteEnergy }, agreement: t.gates.linearBendingAgreement, continuation: t.continuation.pass }; });
for (const r of rows) console.log(`${r.row.padEnd(14)} OOP BE ${f(r.oop.beDisp)} ${f(r.oop.beVel)} ${f(r.oop.beEnergy)} | CT ${f(r.oop.ctDisp)} ${f(r.oop.ctVel)} ${f(r.oop.ctEnergy)} ph ${f(r.oop.phase)} | full BE ${f(r.full.beDisp)} ${f(r.full.beVel)} ${f(r.full.beEnergy)} | coup ${f(r.coupling)} inPl ${f(r.inPlane)} | pubOOP BE ${f(r.publicOop.beDisp)} ${f(r.publicOop.beVel)} | agree ${JSON.stringify(r.agreement.authoritative)} pub ${JSON.stringify(r.agreement.public)}`);
const worst = k => Math.max(...rows.map(r => r.oop[k]));
console.log('WORST OOP BE disp/vel/energy', f(worst('beDisp')), f(worst('beVel')), f(worst('beEnergy')), 'CT disp/vel/energy/phase', f(worst('ctDisp')), f(worst('ctVel')), f(worst('ctEnergy')), f(worst('phase')));
console.log('agreement discrete all', rows.every(r => r.agreement.authoritative.discrete), 'continuous any', rows.some(r => r.agreement.authoritative.continuous));
const pc = g.pairedControls;
for (const b of pc.budget) console.log(`budget L${b.fromLevel} prev=${b.seed ? 'T' : 'F'} I${b.fromBudget}->${b.toBudget} change ${f(b.maximumAuthoritativeStateChange)} matched ${b.matchedStates} complete ${b.completeCommonStates} bothGates ${b.bothAuthorityForceGates} isolation ${b.authoritativeIsolationPass}`);
for (const l of pc.commonTimeLevels) console.log(`level ${l.fromLevel}->${l.toLevel} I${l.fromBudget} prev=${l.seed ? 'T' : 'F'} change ${f(l.maximumAuthoritativeStateChange)} clock ${f(l.maximumActualClockDifference)} complete ${l.completeCommonStates}`);
