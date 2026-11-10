// Whole-report replay, or a source-identical transparent solve-observer ablation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),oi=args.indexOf('--out'),ablation=args.includes('--observer-comparison'),arithmetic=args.includes('--arithmetic-comparison'),membrane=args.includes('--membrane-arithmetic-comparison'),controlled=arithmetic||membrane;
assert.ok(Number(ablation)+Number(arithmetic)+Number(membrane)<=1,'choose one named comparison');
assert.ok(oi<0||oi+1<args.length,'--out needs a path');
const paths=args.filter((a,i)=>!['--observer-comparison','--arithmetic-comparison','--membrane-arithmetic-comparison'].includes(a)&&i!==oi&&!(oi>=0&&i===oi+1));
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
const withoutArithmetic=value=>{const result=structuredClone(value);delete result[membrane?'membraneArithmetic':'lineSearchArithmetic'];return result;};
function required(object,keys,label){
  const result={};for(const key of keys){assert.ok(Object.hasOwn(object,key),label+' missing '+key);result[key]=object[key];}return result;
}
function commonInputs(report){
  assert.equal(report.gates.actualTimeAccuracyAcceptance,false,'arithmetic experiment cannot silently close whole time acceptance');
  const common=required(report,['schema','source','runtime','protocol','oracleSelfTest','referenceCapture'],'report');
  common.protocol=withoutArithmetic(common.protocol);
  common.results=report.results.map(c=>{
    const out=required(c,['geometry','vertices','triangles','material','mesh','fixtureSHA256','meshSHA256','referenceCoefficients','reference','scalarResponseProof','plan'],'case');
    out.trajectories=c.trajectories.map(t=>{
      const selector=report.protocol.lineSearchArithmetic??'total-energy';
      for(const actual of [t.lineSearchArithmetic,t.options?.lineSearchArithmetic,t.runtime?.parameters?.lineSearchArithmetic,t.runtime?.options?.lineSearchArithmetic])
        assert.equal(actual??'total-energy',selector,'actual trajectory/runtime arithmetic must match declared protocol');
      const membraneSelector=report.protocol.membraneArithmetic??'binary64';
      for(const actual of [t.membraneArithmetic,t.options?.membraneArithmetic,t.runtime?.parameters?.membraneArithmetic,t.runtime?.options?.membraneArithmetic])
        assert.equal(actual??'binary64',membraneSelector,'actual membrane arithmetic must match protocol');
      const row=required(t,['level','budget','seed','amplitude','substeps','steps','h','z','fixedForceScale','forceTolerance','modalMass','oracleModalMass','modalMassRelativeDifference','oracleModalMassRelativeDifference','initialReference','scales'],'trajectory');
      row.options=withoutArithmetic(t.options);
      row.runtime=required(t.runtime,['schema','parameters','options','h','requestedSteps','requestedHorizon','retentionPolicy','massProof','fixedInitialForceScale','forceTolerance','modalMass','maximumModeNorm','sleepPolicy','scope'],'runtime');
      row.runtime.parameters=withoutArithmetic(row.runtime.parameters);row.runtime.options=withoutArithmetic(row.runtime.options);
      const initial=structuredClone(t.snapshots?.initial);assert.ok(initial?.observation?.initial===true,'complete actual initial snapshot required');
      assert.equal(initial.observation.solver.lineSearchArithmetic??'total-energy',selector,'actual initial solver arithmetic must match protocol');
      assert.equal(initial.observation.solver.membraneArithmetic??'binary64',membraneSelector,'actual initial membrane arithmetic must match protocol');
      if(membraneSelector==='double-double'){
        assert.equal(selector,'membrane-inertia-increment');
        assert.deepEqual(initial.observation.solver.membraneArithmeticIdentity,{name:'double-double',version:1,productExponentLimit:450,derivative:'coherent-difference',displacement:'two-diff'},'actual DD operator identity required');
      }else assert.equal(initial.observation.solver.membraneArithmeticIdentity,undefined,'unexpected membrane arithmetic identity');
      if(membrane){
        assert.equal(initial.validation?.valid,true,'valid initial actual World measurement required');
        const physical=required(initial.observation,['step','initial','h','time','x','xs','xt','v','rawSHA256','displacement','velocityUV','forceScale','forceTolerance','absoluteForceTolerance','relativeForceTolerance','modalMass','initialLinearModalEnergyScale','asleep','framesRun','substepsRun','execution','targetValid','planarExact'],'physical initial state');
        physical.solver=required(initial.observation.solver,['newtonIterations','substeps','previousPoseStart','pcgMaxIterations','pcgRelativeTolerance'],'initial solver budget');
        assert.ok(initial.stateFloat64LE,'lossless initial actual state required');
        row.initial={observation:physical,stateFloat64LE:initial.stateFloat64LE};
      }else{
        delete initial.observation.solver.lineSearchArithmetic;delete initial.observation.solver.increment;
        row.initial=initial;
      }
      return row;
    });return out;
  });return common;
}
function forceOutcomes(report){const outcomes=report.results.flatMap(c=>c.trajectories.map(t=>{
  assert.ok(Number.isSafeInteger(t.steps)&&t.steps>0&&Array.isArray(t.trace)&&t.trace.length===t.steps+1,'complete initial and requested poststep trace required');
  assert.equal(t.runtime.requestedSteps,t.steps);assert.equal(t.runtime.completedSteps,t.steps,'all requested actual substeps required');
  assert.ok(Number.isFinite(t.fixedForceScale)&&t.fixedForceScale>=0,'finite nonnegative fixed native force scale required');
  const tolerance=Math.max(1e-7,1e-10*t.fixedForceScale);
  assert.equal(t.forceTolerance,tolerance,'literal force tolerance must follow fixed native scale');
  assert.equal(t.runtime.forceTolerance,tolerance,'runtime force tolerance differs from exact row policy');
  assert.equal(t.runtime.fixedInitialForceScale,t.fixedForceScale,'runtime fixed force scale differs');
  t.trace.forEach((o,i)=>{assert.equal(o.step,i,'no omitted, duplicate or reordered poststeps');assert.equal(o.forceTolerance,tolerance,'trace force tolerance differs');});
  const states=t.trace.slice(1),failed=[];
  for(const o of states){
    assert.ok(Number.isFinite(o.residualInfinity)&&o.residualInfinity>=0,'finite nonnegative actual residual required');
    assert.ok(typeof o.validation?.valid==='boolean'&&typeof o.validation?.converged==='boolean','actual validity and convergence classifications required');
    const numeric=o.residualInfinity<=tolerance;
    assert.equal(o.literalForceGate,numeric,'literal force flag must match actual residual and exact tolerance');
    assert.equal(o.validation.converged,o.validation.valid&&numeric,'validation convergence must match actual residual and validity');
    if(!o.validation.valid||!numeric)failed.push(o);
  }
  assert.equal(t.failedSteps,failed.length,'force failure count must match all retained scalar statuses');
  assert.equal(t.firstFailedStep,failed[0]?.step??null,'first failed actual poststep mismatch');
  assert.equal(t.gates.literalForceEverySubstep,failed.length===0,'literal force summary must match actual statuses');
  assert.equal(t.gates.timeAccuracyAcceptance,false,'no narrowed arithmetic/time acceptance');
  return {geometry:c.geometry,level:t.level,budget:t.budget,seed:t.seed,amplitude:t.amplitude,poststeps:states.length,failedSteps:failed.length,
    firstFailedStep:failed[0]?.step??null,gates:t.gates,classification:t.classification,maxima:t.maxima,
    ...(membrane?{initialEvaluation:required(t.snapshots.initial.observation,['elasticEnergy','elasticGradient','metric','rawImplicitEnergy'],'initial measured evaluation')}:{})};
}));assert.equal(report.gates.literalForceEverySubstep,outcomes.every(o=>o.failedSteps===0),'whole-report force gate must match every numeric poststep');return outcomes;}
if(ablation){assert.equal(reports[0].protocol.instrument,false);assert.equal(reports[1].protocol.instrument,true);}
let outcomes;
if(controlled){
  if(membrane){
    for(const r of reports)assert.equal(r.protocol.lineSearchArithmetic,'membrane-inertia-increment','search arithmetic is fixed during membrane comparison');
    assert.equal(reports[0].protocol.membraneArithmetic??'binary64','binary64');assert.equal(reports[1].protocol.membraneArithmetic,'double-double');
  }else{
    assert.equal(reports[0].protocol.lineSearchArithmetic??'total-energy','total-energy');
    assert.equal(reports[1].protocol.lineSearchArithmetic,'membrane-inertia-increment');
    assert.equal(reports[0].protocol.membraneArithmetic??'binary64',reports[1].protocol.membraneArithmetic??'binary64','membrane arithmetic must stay fixed during search comparison');
  }
  outcomes=reports.map(forceOutcomes);
  assert.deepEqual(commonInputs(reports[0]),commonInputs(reports[1]),'same source/native initial state/material/mass/time/Newton/PCG/force policy/reference required; only named arithmetic and measured outcomes differ');
}else assert.deepEqual(comparable(reports[0]),comparable(reports[1]),ablation?
  'all source/runtime/mesh/material/independent spectrum/parameters/force outcomes/fields/metrics/raw-byte hashes/physics counters/failed gates must agree; only instrumentation selector/records/completeness metadata may differ':
  'whole reports except recordedAt must replay, including all failed force/time/measurement gates and diagnostics');
const result={schema:'pliego-membrane-modal-comparison/0.1',recordedAt:new Date().toISOString(),
  source:reports[0].source,inputSHA256:bytes.map(sha),comparisonSHA256:sha(readFileSync(new URL(import.meta.url))),
  mode:membrane?'membrane-arithmetic':arithmetic?'line-search-arithmetic':ablation?'transparent-solve-observer':'strict-repeat',geometries:reports[0].results.length,
  trajectories:reports[0].results.reduce((n,r)=>n+r.trajectories.length,0),
  ...(controlled?{commonInputsExactlyEqual:true,outcomes,comparisonPolicy:membrane?'fixed increment search, coefficients, source/reference/physical initial bytes/mass/time/budgets/literal force policy; initial energy/gradient/metric are measured outcomes retained separately':'explicit projection binds complete source/runtime/reference/native geometry/material/mass/initial fields and all numerical budgets/tolerances; all outcome differences retained separately'}:{allRequiredFieldsExactlyEqual:true,
    excludedFields:ablation?['recordedAt','protocol.instrument','protocol.perNewtonLinearDiagnostics','gates.perNewtonLinearDiagnostics','results[].trajectories[].solveObservation','results[].trajectories[].gates.perNewtonLinearDiagnostics']:['recordedAt']}),
  scope:controlled?'controlled approximate arithmetic comparison only; exact common inputs do not certify real potential descent, changed outcomes, improved force convergence or time/material/booklet/device acceptance':'reproducibility/noninvasive measurement only; original residual failures, missing diagnostics and unaccepted physics gates remain visible; no time/material/booklet/device acceptance'};
const output=JSON.stringify(result,null,2)+'\n';if(oi>=0)writeFileSync(args[oi+1],output,{flag:'wx',mode:0o600});else process.stdout.write(output);
console.error('membrane-modal-compare: '+result.mode+' '+result.trajectories+(controlled?' trajectories common inputs exact; measured outcomes retained separately':' trajectories required fields exact'));
