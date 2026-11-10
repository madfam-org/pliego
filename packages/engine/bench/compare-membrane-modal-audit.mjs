// Whole-report replay, or a source-identical transparent solve-observer ablation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),oi=args.indexOf('--out'),ablation=args.includes('--observer-comparison');
assert.ok(oi<0||oi+1<args.length,'--out needs a path');
const paths=args.filter((a,i)=>a!=='--observer-comparison'&&i!==oi&&!(oi>=0&&i===oi+1));
assert.equal(paths.length,2,'two modal audit reports required');assert.ok(paths.every(p=>!p.startsWith('--')),'unknown argument');
const bytes=paths.map(p=>readFileSync(p)),reports=bytes.map(b=>JSON.parse(b)),sha=b=>createHash('sha256').update(b).digest('hex');
for(const r of reports){
  assert.equal(r.schema,'pliego-membrane-modal-audit/0.1');assert.equal(r.source.dirty,false);assert.equal(r.gates.sourceClean,true);
  assert.equal(r.gates.oracleValid,true);assert.equal(r.gates.completeDeclaredMatrix,true);assert.equal(r.oracleSelfTest.result.passed,true);
  assert.ok(r.results.length>0&&r.results.every(c=>c.trajectories.length>0),'nonempty geometry and trajectory evidence required');
  for(const c of r.results)for(const t of c.trajectories)assert.equal(t.solveObservation.enabled,r.protocol.instrument,'actual solve instrumentation must match protocol');
}
function comparable(report){
  const r=structuredClone(report);delete r.recordedAt;
  if(ablation){
    delete r.protocol.instrument;delete r.protocol.perNewtonLinearDiagnostics;delete r.gates.perNewtonLinearDiagnostics;
    for(const c of r.results)for(const t of c.trajectories){delete t.solveObservation;delete t.gates.perNewtonLinearDiagnostics;}
  }
  return r;
}
if(ablation){assert.equal(reports[0].protocol.instrument,false);assert.equal(reports[1].protocol.instrument,true);}
assert.deepEqual(comparable(reports[0]),comparable(reports[1]),ablation?
  'all source/runtime/mesh/material/independent spectrum/parameters/force outcomes/fields/metrics/raw-byte hashes/physics counters/failed gates must agree; only instrumentation selector/records/completeness metadata may differ':
  'whole reports except recordedAt must replay, including all failed force/time/measurement gates and diagnostics');
const result={schema:'pliego-membrane-modal-comparison/0.1',recordedAt:new Date().toISOString(),
  source:reports[0].source,inputSHA256:bytes.map(sha),comparisonSHA256:sha(readFileSync(new URL(import.meta.url))),
  mode:ablation?'transparent-solve-observer':'strict-repeat',geometries:reports[0].results.length,
  trajectories:reports[0].results.reduce((n,r)=>n+r.trajectories.length,0),allRequiredFieldsExactlyEqual:true,
  excludedFields:ablation?['recordedAt','protocol.instrument','protocol.perNewtonLinearDiagnostics','gates.perNewtonLinearDiagnostics','results[].trajectories[].solveObservation','results[].trajectories[].gates.perNewtonLinearDiagnostics']:['recordedAt'],
  scope:'reproducibility/noninvasive measurement only; original residual failures, missing diagnostics and unaccepted physics gates remain visible; no time/material/booklet/device acceptance'};
const output=JSON.stringify(result,null,2)+'\n';if(oi>=0)writeFileSync(args[oi+1],output);else process.stdout.write(output);
console.error('membrane-modal-compare: '+result.mode+' '+result.trajectories+' trajectories required fields exact');
