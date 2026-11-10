// Whole-report replay, or a source-identical transparent solve-observer ablation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),oi=args.indexOf('--out'),ablation=args.includes('--observer-comparison'),arithmetic=args.includes('--arithmetic-comparison'),membrane=args.includes('--membrane-arithmetic-comparison'),reference=args.includes('--reference-comparison'),controlled=arithmetic||membrane||reference;
assert.ok(Number(ablation)+Number(arithmetic)+Number(membrane)+Number(reference)<=1,'choose one named comparison');
assert.ok(oi<0||oi+1<args.length,'--out needs a path');
const paths=args.filter((a,i)=>!['--observer-comparison','--arithmetic-comparison','--membrane-arithmetic-comparison','--reference-comparison'].includes(a)&&i!==oi&&!(oi>=0&&i===oi+1));
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
const withoutArithmetic=value=>{const result=structuredClone(value);delete result[reference?'membraneReference':membrane?'membraneArithmetic':'lineSearchArithmetic'];return result;};
function required(object,keys,label){
  const result={};for(const key of keys){assert.ok(Object.hasOwn(object,key),label+' missing '+key);result[key]=object[key];}return result;
}
function referencePhysical(c,mode){
  const data=structuredClone(c.referenceCoefficients);
  assert.ok(Array.isArray(data.triangles)&&data.triangles.length>0&&Array.isArray(data.elements)&&data.elements.length===data.triangles.length,'complete actual reference coefficients required');
  for(let t=0;t<data.elements.length;t++){
    const e=data.elements[t],r=e.reference;
    for(const [key,n]of [['alpha',3],['beta',3],['Q',4]])assert.ok(Array.isArray(e[key])&&e[key].length===n&&e[key].every(Number.isFinite),'finite actual '+key+' coefficients required');
    assert.ok(Number.isFinite(e.volume)&&e.volume>0,'positive actual volume required');
    if(mode==='uv-displacement'){
      assert.ok(r&&r.mode===mode&&r.version===1,'explicit UV reference definition required');
      for(const [key,n]of [['u',3],['v',3],['x0',9]])assert.ok(Array.isArray(r[key])&&r[key].length===n&&r[key].every(Number.isFinite),'finite actual reference '+key+' required');
      assert.ok(Number.isFinite(r.c)&&Number.isFinite(r.s),'actual material rotation required');
      const ids=data.triangles[t];assert.ok(ids.length===3&&ids.every(i=>Number.isInteger(i)&&i>=0&&i<c.vertices.length),'actual native cycle required');
      const [a,b,d]=ids.map(i=>c.vertices[i]),du1=b[0]-a[0],dv1=b[1]-a[1],du2=d[0]-a[0],dv2=d[1]-a[1],det=du1*dv2-du2*dv1;
      assert.ok(Number.isFinite(det)&&det>0,'positive native reference triangle required');
      const u1=dv2/det,u2=-dv1/det,v1=-du2/det,v2=du1/det;
      assert.ok(r.u.every((v,i)=>v===[-(u1+u2),u1,u2][i]),'actual UV-u operator differs from fixed UV');
      assert.ok(r.v.every((v,i)=>v===[-(v1+v2),v1,v2][i]),'actual UV-v operator differs from fixed UV');
      assert.ok(r.x0.every((v,i)=>v===ids.flatMap(j=>[c.vertices[j][0],0,-c.vertices[j][1]])[i]),'actual reference base differs from fixed native placement');
      const angle=c.geometry.grain*Math.PI/180;assert.equal(r.c,Math.cos(angle));assert.equal(r.s,Math.sin(angle));
    }else assert.equal(r,undefined,'unexpected old-law reference definition');
    delete e.reference;
  }
  return data;
}
function commonInputs(report){
  assert.equal(report.gates.actualTimeAccuracyAcceptance,false,'arithmetic experiment cannot silently close whole time acceptance');
  const common=required(report,['schema','source','runtime','protocol','oracleSelfTest','referenceCapture'],'report');
  common.protocol=withoutArithmetic(common.protocol);
  common.results=report.results.map(c=>{
    const out=required(c,['geometry','vertices','triangles','material','mesh','fixtureSHA256','meshSHA256','referenceCoefficients','reference','scalarResponseProof','plan'],'case');
    if(reference)out.referenceCoefficients=referencePhysical(c,report.protocol.membraneReference??'material-coefficients');
    out.trajectories=c.trajectories.map(t=>{
      const selector=report.protocol.lineSearchArithmetic??'total-energy';
      for(const actual of [t.lineSearchArithmetic,t.options?.lineSearchArithmetic,t.runtime?.parameters?.lineSearchArithmetic,t.runtime?.options?.lineSearchArithmetic])
        assert.equal(actual??'total-energy',selector,'actual trajectory/runtime arithmetic must match declared protocol');
      const membraneSelector=report.protocol.membraneArithmetic??'binary64';
      for(const actual of [t.membraneArithmetic,t.options?.membraneArithmetic,t.runtime?.parameters?.membraneArithmetic,t.runtime?.options?.membraneArithmetic])
        assert.equal(actual??'binary64',membraneSelector,'actual membrane arithmetic must match protocol');
      const referenceSelector=report.protocol.membraneReference??'material-coefficients';
      for(const actual of [t.membraneReference,t.options?.membraneReference,t.runtime?.parameters?.membraneReference,t.runtime?.options?.membraneReference])
        assert.equal(actual??'material-coefficients',referenceSelector,'actual membrane reference must match protocol');
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
      const actualReference=initial.observation.solver.membraneReference??'material-coefficients';
      assert.equal(actualReference,referenceSelector,'actual initial membrane reference must match protocol');
      if(referenceSelector==='uv-displacement'){
        assert.equal(membraneSelector,'double-double');assert.equal(selector,'membrane-inertia-increment');
        assert.deepEqual(initial.observation.solver.membraneReferenceIdentity,{mode:'uv-displacement',version:1,metric:'actual-X0',strain:'uv-covariant',rotation:'tensor-before-voigt'},'actual reference identity required');
      }else assert.equal(initial.observation.solver.membraneReferenceIdentity,undefined,'unexpected reference identity');
      if(membrane||reference){
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
  if(reference){
    const mode=report.protocol.membraneReference??'material-coefficients',identity=t.snapshots?.initial?.observation?.solver?.membraneReferenceIdentity;
    for(const o of [...t.trace,...(t.solveObservation?.trace??[])]){assert.equal(o.solver?.membraneReference??o.membraneReference??'material-coefficients',mode,'every observation must match actual reference law');
      assert.deepEqual(o.solver?.membraneReferenceIdentity??o.membraneReferenceIdentity,identity,'every observation reference identity must match initial actual law');}
  }
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
    ...((membrane||reference)?{initialEvaluation:required(t.snapshots.initial.observation,['elasticEnergy','elasticGradient','metric','rawImplicitEnergy'],'initial measured evaluation'),...(reference?{representedReferenceCoefficients:c.referenceCoefficients}:{})}:{})};
}));assert.equal(report.gates.literalForceEverySubstep,outcomes.every(o=>o.failedSteps===0),'whole-report force gate must match every numeric poststep');return outcomes;}
if(ablation){assert.equal(reports[0].protocol.instrument,false);assert.equal(reports[1].protocol.instrument,true);}
let outcomes;
if(controlled){
  if(reference){
    for(const r of reports){assert.equal(r.protocol.lineSearchArithmetic,'membrane-inertia-increment','search fixed during reference comparison');assert.equal(r.protocol.membraneArithmetic,'double-double','DD fixed during reference comparison');}
    assert.equal(reports[0].protocol.membraneReference??'material-coefficients','material-coefficients');assert.equal(reports[1].protocol.membraneReference,'uv-displacement');
  }else if(membrane){
    for(const r of reports)assert.equal(r.protocol.lineSearchArithmetic,'membrane-inertia-increment','search arithmetic is fixed during membrane comparison');
    assert.equal(reports[0].protocol.membraneArithmetic??'binary64','binary64');assert.equal(reports[1].protocol.membraneArithmetic,'double-double');
  }else{
    assert.equal(reports[0].protocol.lineSearchArithmetic??'total-energy','total-energy');
    assert.equal(reports[1].protocol.lineSearchArithmetic,'membrane-inertia-increment');
    assert.equal(reports[0].protocol.membraneArithmetic??'binary64',reports[1].protocol.membraneArithmetic??'binary64','membrane arithmetic must stay fixed during search comparison');
  }
  if(!reference)assert.equal(reports[0].protocol.membraneReference??'material-coefficients',reports[1].protocol.membraneReference??'material-coefficients','reference law must stay fixed during arithmetic comparison');
  outcomes=reports.map(forceOutcomes);
  assert.deepEqual(commonInputs(reports[0]),commonInputs(reports[1]),'same source/native initial state/material/mass/time/Newton/PCG/force policy/reference required; only named arithmetic and measured outcomes differ');
}else assert.deepEqual(comparable(reports[0]),comparable(reports[1]),ablation?
  'all source/runtime/mesh/material/independent spectrum/parameters/force outcomes/fields/metrics/raw-byte hashes/physics counters/failed gates must agree; only instrumentation selector/records/completeness metadata may differ':
  'whole reports except recordedAt must replay, including all failed force/time/measurement gates and diagnostics');
const result={schema:'pliego-membrane-modal-comparison/0.1',recordedAt:new Date().toISOString(),
  source:reports[0].source,inputSHA256:bytes.map(sha),comparisonSHA256:sha(readFileSync(new URL(import.meta.url))),
  mode:reference?'reference-law':membrane?'membrane-arithmetic':arithmetic?'line-search-arithmetic':ablation?'transparent-solve-observer':'strict-repeat',geometries:reports[0].results.length,
  trajectories:reports[0].results.reduce((n,r)=>n+r.trajectories.length,0),
  ...(controlled?{commonInputsExactlyEqual:true,outcomes,comparisonPolicy:reference?'fixed DD/increment search, physical UV/X0/material/mass/time/initial bytes/budgets/literal force policy; changed represented reference definition and initial evaluations retained as outcomes':membrane?'fixed increment search, coefficients, source/reference/physical initial bytes/mass/time/budgets/literal force policy; initial energy/gradient/metric are measured outcomes retained separately':'explicit projection binds complete source/runtime/reference/native geometry/material/mass/initial fields and all numerical budgets/tolerances; all outcome differences retained separately'}:{allRequiredFieldsExactlyEqual:true,
    excludedFields:ablation?['recordedAt','protocol.instrument','protocol.perNewtonLinearDiagnostics','gates.perNewtonLinearDiagnostics','results[].trajectories[].solveObservation','results[].trajectories[].gates.perNewtonLinearDiagnostics']:['recordedAt']}),
  scope:reference?'controlled represented-reference-law/evaluation-chain comparison only; exact common inputs do not certify real potential descent, changed outcomes, improved force convergence or time/material/booklet/device acceptance':controlled?'controlled approximate arithmetic comparison only; exact common inputs do not certify real potential descent, changed outcomes, improved force convergence or time/material/booklet/device acceptance':'reproducibility/noninvasive measurement only; original residual failures, missing diagnostics and unaccepted physics gates remain visible; no time/material/booklet/device acceptance'};
const output=JSON.stringify(result,null,2)+'\n';if(oi>=0)writeFileSync(args[oi+1],output,{flag:'wx',mode:0o600});else process.stdout.write(output);
console.error('membrane-modal-compare: '+result.mode+' '+result.trajectories+(controlled?' trajectories common inputs exact; measured outcomes retained separately':' trajectories required fields exact'));
