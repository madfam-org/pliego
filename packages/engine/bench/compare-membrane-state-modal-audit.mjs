// Comparisons preserve failed outcomes. This never steps World or runs an oracle.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {loadStateModalInputs,STATE_MODAL_ARCHIVE_GIT} from './membrane-state-modal-inputs.mjs';
import {reserveStateModalOutput} from './membrane-state-modal-output.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const MODES=['strict-repeat','transparent-solve-observer','baseline-migration','state-comparison','state-replay','curvature-comparison','stopping-comparison'];
/** The closed fixed24 Gauss–Newton state capture (3d778abc run/candidate.json, decoded bytes). */
export const STATE_REPLAY_ARCHIVE_GIT='3d778abc179988e1c1a31b43d8048aa6a08d00b1';
export const STATE_REPLAY_ARCHIVE_RAW_SHA256='09d94972d9f7f815d6fae4033eac6417810242a238911b542573b53ccbfadb78';
/** Reviewed source migration from the closed capture to the exact-curvature capture source. */
// Engine: exact-curvature operator/policy (#70). Bench: named exact candidate, effective-operator observer,
// curvature receipts and these comparison modes. Every other inventory path must be byte-identical.
export const STATE_REPLAY_REVIEWED_CHANGES=Object.freeze(['packages/engine/bench/compare-membrane-model-controls.mjs','packages/engine/bench/compare-membrane-state-modal-audit.mjs',
  'packages/engine/bench/membrane-state-modal-audit.mjs','packages/engine/bench/membrane-state-modal-runtime.mjs','packages/engine/bench/membrane-state-modal-solve-observer.mjs',
  'packages/engine/bench/membrane-state-modal-validation.mjs','packages/engine/src/linalg/blockchol.js','packages/engine/src/xpbd/accurate-membrane.js','packages/engine/src/xpbd/implicit.js',
  'packages/engine/src/xpbd/increment-search.js','packages/engine/src/xpbd/newton.js','packages/engine/src/xpbd/orthotropic-membrane.js','packages/engine/src/xpbd/pcg.js',
  'packages/engine/src/xpbd/reference-state.js','packages/engine/src/xpbd/state.js','packages/engine/src/xpbd/world.js']);
export const STATE_REPLAY_REVIEWED_ADDITIONS=Object.freeze(['packages/engine/src/xpbd/exact-newton.js','packages/engine/src/xpbd/membrane-curvature.js',
  'packages/engine/test/exact-curvature-capture.test.js','packages/engine/test/exact-curvature-operators.test.js','packages/engine/test/exact-curvature-world.test.js']);
/** Closed exact-curvature capture (af870bf run/candidate.json) and its reviewed migration to the PCG-stop capture source. */
export const EXACT_REPLAY_ARCHIVE_GIT='af870bf776023b01f6e205a420fa493cccd549c5';
export const EXACT_REPLAY_ARCHIVE_RAW_SHA256='d07ab0e04bc54bdfb4a924529ffd87f04829f0ba10bdcbcca48308e2445ef25a';
// Engine: the opt-in absolute PCG stop (pcg.js, newton.js, exact-newton.js, world.js). Bench: the named stop candidate,
// its validation and receipts, and this replay registry/stopping comparison. Every other inventory path must be byte-identical.
export const EXACT_REPLAY_REVIEWED_CHANGES=Object.freeze(['packages/engine/bench/compare-membrane-state-modal-audit.mjs','packages/engine/bench/membrane-state-modal-audit.mjs',
  'packages/engine/bench/membrane-state-modal-runtime.mjs','packages/engine/bench/membrane-state-modal-validation.mjs','packages/engine/src/xpbd/exact-newton.js',
  'packages/engine/src/xpbd/newton.js','packages/engine/src/xpbd/pcg.js','packages/engine/src/xpbd/world.js']);
export const EXACT_REPLAY_REVIEWED_ADDITIONS=Object.freeze(['packages/engine/test/pcg-absolute-stop.test.js']);
/** Replay targets by decoded raw SHA256. Each list is reviewed for the source that replays it. */
export const STATE_REPLAY_ARCHIVES=Object.freeze({
  [STATE_REPLAY_ARCHIVE_RAW_SHA256]:Object.freeze({git:STATE_REPLAY_ARCHIVE_GIT,membraneCurvature:'gauss-newton',changes:STATE_REPLAY_REVIEWED_CHANGES,additions:STATE_REPLAY_REVIEWED_ADDITIONS,reviewedFor:'capture source af870bf'}),
  [EXACT_REPLAY_ARCHIVE_RAW_SHA256]:Object.freeze({git:EXACT_REPLAY_ARCHIVE_GIT,membraneCurvature:'exact-hessian',changes:EXACT_REPLAY_REVIEWED_CHANGES,additions:EXACT_REPLAY_REVIEWED_ADDITIONS,reviewedFor:'the PCG-stop capture source'})});
const CURVATURE_ONLY=new Set(['membraneCurvature']),STOP_ONLY=new Set(['pcgAbsoluteTolerance']);
const OBSERVER_ONLY=['protocol.instrument','protocol.perNewtonLinearDiagnostics','gates.perNewtonLinearDiagnostics',
  'results[].trajectories[].solveObservation','results[].trajectories[].gates.perNewtonLinearDiagnostics'];
const key=t=>[t.level,t.budget,t.seed].join(':');
const numeric=x=>typeof x==='number'&&Number.isFinite(x);
const required=(o,name)=>{assert.ok(Object.hasOwn(o,name),'missing explicit field: '+name);return o[name];};

/** No large structuredClone: compare every leaf under only named exclusions. */
export function assertStateModalPayloadEqual(a,b,{observerComparison=false,legacy=false}={}){
  const excluded=new Set(['recordedAt',...(legacy?['source']:observerComparison?OBSERVER_ONLY:[])]);let leaves=0;
  function visit(x,y,path){
    if(excluded.has(path))return;
    assert.equal(typeof x,typeof y,'type changed: '+path);
    if(x===null||y===null||typeof x!=='object'){assert.ok(Object.is(x,y),'value changed: '+path);leaves++;return;}
    assert.equal(Array.isArray(x),Array.isArray(y),'array/object changed: '+path);
    if(Array.isArray(x)){assert.equal(x.length,y.length,'array length changed: '+path);for(let i=0;i<x.length;i++)visit(x[i],y[i],path+'[]');return;}
    const keys=o=>Object.keys(o).filter(k=>!excluded.has(path?path+'.'+k:k)).sort();assert.deepEqual(keys(x),keys(y),'keys changed: '+path);
    for(const k of keys(x))visit(x[k],y[k],path?path+'.'+k:k);
  }
  visit(a,b,'');assert.ok(leaves>0,'comparison scanned zero leaves');return {leavesCompared:leaves,excludedFields:[...excluded]};
}
export function assertLegacyNumericalReplay(old,fresh){return assertStateModalPayloadEqual(old,fresh,{legacy:true});}

function source(s){assert.ok(s&&s.dirty===false&&/^[0-9a-f]{40}$/.test(s.git),'clean pinned source required');
  assert.ok(Array.isArray(s.files)&&s.files.length>52,'nonempty complete new source inventory required');const paths=new Set();
  for(const f of s.files){assert.ok(typeof f.path==='string'&&!paths.has(f.path)&&/^[0-9a-f]{64}$/.test(f.sha256));paths.add(f.path);}
  for(const name of ['membrane-state-modal-audit.mjs','compare-membrane-state-modal-audit.mjs','membrane-state-modal-inputs.mjs','membrane-state-modal-runtime.mjs','membrane-state-modal-validation.mjs','membrane-state-modal-metrics.mjs','membrane-state-modal-solve-observer.mjs','membrane-state-modal-output.mjs','membrane-state-precision.py'])assert.ok(paths.has('packages/engine/bench/'+name),'missing new source binding: '+name);
  assert.ok(paths.has('packages/engine/bench/fixtures/membrane-state-modal-input.json'),'small actual-input fixture missing');
}
function protocol(p){assert.equal(p.stage,'diagnostic');assert.equal(p.matrix,'smoke');assert.equal(p.amplitude,.004);assert.deepEqual(p.levels,[1,2,4,8]);assert.deepEqual(p.budgets,[1,4,16]);assert.deepEqual(p.seeds,[false,true]);
  assert.equal(p.S0,22422);assert.equal(p.N0,79);assert.equal(p.trajectories,24);assert.equal(p.poststeps,7110);assert.equal(p.newtonEvents,49770);
  assert.deepEqual(p.limits,{mass:1e-12,discreteField:.001,discreteVelocity:.001,discreteEnergy:.005,continuousField:.01,continuousVelocity:.01,continuousEnergy:.05,phaseCycles:.01,solveIsolation:1e-4},'physical comparison limits must stay fixed');
  assert.equal(p.stateCoordinates,'reference-displacement');assert.equal(p.membraneReference,'uv-displacement');assert.equal(p.membraneArithmetic,'double-double');assert.equal(p.lineSearchArithmetic,'membrane-inertia-increment');assert.equal(typeof p.instrument,'boolean');
}
function binding(encoded,hash){assert.equal(typeof encoded,'string');const b=Buffer.from(encoded,'base64');assert.equal(b.toString('base64'),encoded);assert.equal(b.length%8,0);assert.equal(sha(b),hash,'native LE/SHA mismatch');return b;}
function numericBinding(values,encoded,hash){const b=binding(encoded,hash);assert.ok(Array.isArray(values));assert.equal(b.length,8*values.length);values.forEach((v,i)=>assert.ok(v===b.readDoubleLE(8*i),'numeric vector differs from authoritative LE words'));}
function stateHistory(t){
  const words=b=>Array.from({length:b.length/8},(_,j)=>b.readDoubleLE(8*j));
  assert.equal(t.history.length,t.trace.length,'all judged raw states must be retained');
  for(let i=0;i<t.history.length;i++){
    const h=t.history[i],o=t.trace[i];assert.equal(h.step,i);assert.equal(o.step,i);assert.equal(h.time,o.time);assert.equal(h.targetValid,o.targetValid);assert.deepEqual(h.stateSHA256,o.stateSHA256);
    for(const names of [['stateFloat64LE','stateSHA256'],['forceFloat64LE','forceSHA256']]){
      const [encoded,hashes]=names;assert.ok(h[encoded]&&h[hashes],'raw vector binding absent');assert.deepEqual(Object.keys(h[encoded]).sort(),Object.keys(h[hashes]).sort());
      assert.equal(Object.keys(h[encoded]).length,encoded==='stateFloat64LE'?14:6,'complete native vector family required');
      for(const name of Object.keys(h[encoded]))binding(h[encoded][name],h[hashes][name]);
    }
    for(const name of ['x','xs','xt','v','u','us','ut']){assert.ok(Array.isArray(h[name])&&h[name].length===27,'complete current native arrays required');numericBinding(h[name],h.stateFloat64LE[name],h.stateSHA256[name]);}
    for(const name of ['publicElasticGradient','publicInertiaGradient','publicResidual','authoritativeElasticGradient','authoritativeInertiaGradient','authoritativeResidual'])if(h[name]!==null)numericBinding(h[name],h.forceFloat64LE[name],h.forceSHA256[name]);
    const get=name=>words(Buffer.from(h.stateFloat64LE[name],'base64')),mass=get('mass'),hh=get('h')[0],idt2=1/(hh*hh);assert.equal(hh,t.h);assert.deepEqual(mass,t.runtime.massProof.native);
    for(const [prefix,point,target]of [['public','x','xt'],['authoritative','u','ut']]){
      const x=get(point),xt=get(target),g=words(Buffer.from(h.forceFloat64LE[prefix+'ElasticGradient'],'base64')),ig=words(Buffer.from(h.forceFloat64LE[prefix+'InertiaGradient'],'base64')),r=words(Buffer.from(h.forceFloat64LE[prefix+'Residual'],'base64'));
      for(let j=0;j<x.length;j++){assert.ok(Object.is(ig[j],(mass[Math.floor(j/3)]*idt2)*(x[j]-xt[j])),'native inertia association differs');assert.ok(Object.is(r[j],g[j]+ig[j]),'native residual association differs');}
      if(i)assert.equal(Math.max(...r.map(Math.abs)),prefix==='public'?o.residualInfinity:o.authoritativeResidualInfinity,'reported native max differs from complete residual words');
    }
  }
}
/** One captured trajectory integrity check; complete24 authority comes only from the report validator. */
export function stateModalTrajectoryOutcome(t,{expected:old,instrument}={}){
  assert.ok(old&&typeof instrument==='boolean');
    for(const name of ['level','budget','seed','amplitude','substeps','steps','h','fixedForceScale','forceTolerance','modalMass'])assert.equal(t[name],old[name],'unchanged actual input required: '+name);
    assert.equal(t.options.stateCoordinates,'reference-displacement');assert.equal(t.options.newtonIterations,t.budget);assert.equal(t.options.previousPoseStart,t.seed);assert.equal(t.options.substeps,t.substeps);
    assert.equal(t.runtime.requestedSteps,t.steps);assert.equal(t.runtime.completedSteps,t.steps);assert.equal(t.runtime.h,t.h);assert.equal(t.trace.length,t.steps+1);assert.equal(t.runtime.observedCount,t.trace.length);
    assert.equal(t.runtime.fixedInitialForceScale,t.fixedForceScale);assert.equal(t.runtime.forceTolerance,t.forceTolerance);assert.deepEqual(t.runtime.massProof.native,old.runtime.massProof.native);
    assert.equal(t.forceTolerance,Math.max(1e-7,1e-10*t.fixedForceScale));stateHistory(t);
    let publicFailures=0,authorityFailures=0,firstPublic=null,firstAuthority=null;
    for(const [i,o]of t.trace.entries()){
      assert.equal(o.forceTolerance,t.forceTolerance);assert.equal(typeof o.validation.valid,'boolean');
      if(!i){assert.equal(o.targetValid,false);assert.equal(o.literalForceGate,null);assert.equal(o.authoritativeConverged,null);continue;}
      assert.equal(o.targetValid,true);for(const flag of ['boundaryCertified','actualGradientChecked','liveWorldChecked','losslessBindingsVerified','forceBindingsVerified'])assert.equal(o.validation[flag],true,'complete live native equation verification required');assert.ok(numeric(o.residualInfinity)&&o.residualInfinity>=0&&numeric(o.authoritativeResidualInfinity)&&o.authoritativeResidualInfinity>=0);
      const p=o.residualInfinity<=t.forceTolerance,a=o.authoritativeResidualInfinity<=t.forceTolerance;
      assert.equal(o.literalForceGate,p,'public literal flag differs from actual residual');assert.equal(o.authoritativeConverged,a,'latent flag differs from actual residual');
      assert.equal(o.validation.converged,o.validation.valid&&p);assert.equal(o.validation.publicConverged,o.validation.valid&&p);assert.equal(o.validation.authoritativeConverged,o.validation.valid&&a);
      if(!o.validation.valid||!p){publicFailures++;firstPublic??=i;}if(!o.validation.valid||!a){authorityFailures++;firstAuthority??=i;}
    }
    assert.equal(t.failedSteps,publicFailures);assert.equal(t.authoritativeFailedSteps,authorityFailures);assert.equal(t.firstFailedStep,firstPublic);assert.equal(t.firstAuthoritativeFailedStep,firstAuthority);
    assert.equal(t.gates.clockAccumulation,t.maxima.authoritative.clockRelative<=64*Number.EPSILON*Math.max(1,t.steps)&&t.maxima.public.clockRelative<=64*Number.EPSILON*Math.max(1,t.steps));
    assert.equal(t.gates.literalForceEverySubstep,t.gates.measurementValid&&publicFailures===0);assert.equal(t.gates.authoritativeForceEverySubstep,t.gates.measurementValid&&authorityFailures===0);assert.equal(t.gates.timeAccuracyAcceptance,false);
    assert.equal(t.solveObservation.enabled,instrument);
    if(instrument){const c=t.solveObservation.counts;assert.equal(c.callbackErrors,0,'callback failure cannot be accepted');assert.equal(c.missing,0,'missing diagnostic cannot be accepted');assert.equal(t.solveObservation.callbackErrors.length,0);assert.equal(c.begins,t.steps*t.budget);assert.equal(c.finishes,t.steps*t.budget);assert.equal(t.solveObservation.trace.length,t.steps*t.budget);assert.equal(t.gates.perNewtonLinearDiagnostics,true);}
    else{assert.equal(t.solveObservation.counts,null);assert.equal(t.solveObservation.trace.length,0);assert.equal(t.gates.perNewtonLinearDiagnostics,'not measured');}
    assert.equal(t.continuation.extraControlNotJudgedTrajectory,true);assert.equal(t.continuation.replayedPublicCalls,1);assert.equal(t.continuation.pass,true);assert.equal(t.gates.boundaryRestoreContinuation,true);
  return {level:t.level,budget:t.budget,seed:t.seed,poststeps:t.steps,publicFailed:publicFailures,authoritativeFailed:authorityFailures,firstPublicFailure:firstPublic,firstAuthoritativeFailure:firstAuthority};
}
/** All7110 scalar force statuses are checked numerically; no HP truth claim. */
export function stateModalForceOutcomes(report){
  assert.equal(report.schema,'pliego-membrane-state-modal-audit/1');source(report.source);protocol(report.protocol);
  assert.equal(report.results.length,1);assert.deepEqual(report.results[0].geometry,{cells:2,pattern:'forward',grain:0});
  for(const name of ['sourceClean','completeDeclaredMatrix','completeRequestedPoststeps','oracleValid','measurementValid','literalForceEverySubstep','authoritativeForceEverySubstep','perNewtonLinearDiagnostics','boundaryRestoreContinuation','actualTimeAccuracyAcceptance'])required(report.gates,name);
  assert.equal(report.gates.sourceClean,true);assert.equal(report.gates.completeDeclaredMatrix,true);assert.equal(report.gates.completeRequestedPoststeps,true);assert.equal(report.gates.oracleValid,true);
  assert.equal(report.gates.actualTimeAccuracyAcceptance,false,'whole time gate cannot be narrowed');
  const expected=new Map(loadStateModalInputs().rows.map(t=>[key(t),t])),seen=new Set(),outcomes=[];
  assert.equal(report.results[0].trajectories.length,24);let events=0,steps=0;
  for(const t of report.results[0].trajectories){
    const k=key(t),old=expected.get(k);assert.ok(old&&!seen.has(k),'unknown/duplicate trajectory');seen.add(k);
    const outcome=stateModalTrajectoryOutcome(t,{expected:old,instrument:report.protocol.instrument});
    steps+=t.steps;events+=t.steps*t.budget;outcomes.push(outcome);
  }
  assert.equal(steps,7110);assert.equal(events,49770);assert.equal(report.gates.literalForceEverySubstep,outcomes.every(t=>t.publicFailed===0)&&report.gates.measurementValid);assert.equal(report.gates.authoritativeForceEverySubstep,outcomes.every(t=>t.authoritativeFailed===0)&&report.gates.measurementValid);
  return {poststeps:steps,declaredNewtonEvents:events,trajectories:outcomes,publicFailed:outcomes.reduce((s,t)=>s+t.publicFailed,0),authoritativeFailed:outcomes.reduce((s,t)=>s+t.authoritativeFailed,0)};
}
function legacyRows(report){
  assert.equal(report.schema,'pliego-membrane-modal-audit/0.1');assert.equal(report.source.dirty,false);assert.equal(report.protocol.stage,'diagnostic');assert.equal(report.protocol.matrix,'smoke');assert.equal(report.protocol.instrument,true);
  assert.equal(report.protocol.membraneReference,'uv-displacement');assert.equal(report.protocol.membraneArithmetic,'double-double');assert.equal(report.protocol.lineSearchArithmetic,'membrane-inertia-increment');
  assert.equal(report.results.length,1);assert.equal(report.results[0].trajectories.length,24);let n=0,e=0;const seen=new Set(),expected=new Map(loadStateModalInputs().rows.map(t=>[key(t),t]));
  for(const t of report.results[0].trajectories){assert.ok(!seen.has(key(t)));seen.add(key(t));const fixed=expected.get(key(t));assert.ok(fixed);for(const name of ['level','budget','seed','amplitude','substeps','steps','h','fixedForceScale','forceTolerance','modalMass'])assert.equal(t[name],fixed[name]);assert.equal(t.steps,79*t.level);assert.equal(t.substeps,22422*t.level);assert.equal(t.trace.length,t.steps+1);assert.equal(t.runtime.completedSteps,t.steps);assert.equal(t.solveObservation.trace.length,t.steps*t.budget);
    let failures=0;for(const [i,o]of t.trace.entries()){assert.equal(o.step,i);if(i){assert.equal(o.literalForceGate,o.residualInfinity<=t.forceTolerance);failures+=Number(!o.validation.valid||!o.literalForceGate);}}
    assert.equal(t.failedSteps,failures);n+=t.steps;e+=t.steps*t.budget;
  }assert.equal(n,7110);assert.equal(e,49770);return report.results[0].trajectories;
}
function baseline(envelope){assert.equal(envelope.schema,'pliego-membrane-state-modal-baseline/1');source(envelope.source);assert.equal(envelope.legacy.source.git,envelope.source.git);legacyRows(envelope.legacy);}
function sourceMigration(old,fresh,envelopeSource){
  assert.equal(old.git,STATE_MODAL_ARCHIVE_GIT);assert.equal(old.dirty,false);assert.equal(fresh.dirty,false);
  const changed=new Set(['xpbd/world.js','xpbd/implicit.js','xpbd/pcg.js','xpbd/energy-search.js','xpbd/state.js','xpbd/accurate-membrane.js','xpbd/increment-search.js','xpbd/orthotropic-membrane.js','xpbd/uv-reference.js']);
  const additions=new Set(['xpbd/newton.js','xpbd/reference-state.js']),before=new Map(old.engineFiles.map(f=>[f.path,f.sha256]));
  assert.equal(old.engineFiles.length,50);assert.equal(fresh.engineFiles.length,52);
  for(const f of fresh.engineFiles){assert.ok(before.has(f.path)||additions.has(f.path),'unknown runtime addition');if(!changed.has(f.path)&&!additions.has(f.path))assert.equal(f.sha256,before.get(f.path),'unreviewed runtime change: '+f.path);
    assert.equal(envelopeSource.files.find(p=>p.path==='packages/engine/src/'+f.path)?.sha256,f.sha256,'wrapper/runtime source fingerprint differs');}
  for(const f of old.engineFiles)assert.ok(fresh.engineFiles.some(n=>n.path===f.path),'historical runtime removed');
  const repaired=fresh.tests.find(t=>t.path==='membrane-reference-probes.test.js');assert.equal(repaired?.sha256,'06db125c52bf247a82d82247475a01b08b51ec6b21fa9f7bda5cfcb62916b240','only reviewed descriptor-based test repair allowed');
  const tests=new Map(old.tests.map(t=>[t.path,t.sha256]));for(const t of fresh.tests)if(tests.has(t.path)&&t.path!=='membrane-reference-probes.test.js')assert.equal(t.sha256,tests.get(t.path),'unreviewed historical test change: '+t.path);
  for(const t of old.tests)assert.ok(fresh.tests.some(n=>n.path===t.path),'historical test removed');
  const otherwise=o=>Object.fromEntries(Object.entries(o).filter(([k])=>!['git','engineFiles','tests'].includes(k)));assert.deepEqual(otherwise(old),otherwise(fresh),'non-reviewed source dependencies changed');
  return {historicalRuntimeFiles:50,currentRuntimeFiles:52,reviewedChangedRuntime:[...changed],reviewedAddedRuntime:[...additions],reviewedExistingTestChange:'membrane-reference-probes.test.js',allOtherDependenciesExact:true};
}
function commonStateInputs(b,c){
  assert.deepEqual(b.source,c.source,'same source required for state ablation');
  const old=b.legacy.results[0],candidate=c.results[0];
  for(const name of ['geometry','vertices','triangles','material','mesh','fixtureSHA256','meshSHA256','referenceCoefficients','reference','scalarResponseProof','plan'])assert.deepEqual(old[name],candidate[name],'physical reference/input differs: '+name);
  const rows=new Map(old.trajectories.map(t=>[key(t),t]));
  const strip=o=>Object.fromEntries(Object.entries(o).filter(([k])=>k!=='stateCoordinates'));
  for(const t of candidate.trajectories){const a=rows.get(key(t));assert.ok(a);
    for(const name of ['level','budget','seed','amplitude','substeps','steps','h','fixedForceScale','forceTolerance','modalMass'])assert.equal(a[name],t[name]);
    assert.deepEqual(a.options,strip(t.options));assert.deepEqual(a.runtime.parameters,strip(t.runtime.parameters));assert.deepEqual(a.runtime.options,strip(t.runtime.options));assert.deepEqual(a.runtime.massProof,t.runtime.massProof);
    const before=a.snapshots.initial,after=t.snapshots.initial;
    for(const name of ['x','xs','xt','v']){assert.equal(before.stateFloat64LE[name],after.observation.stateFloat64LE[name],'actual native initial bytes changed');assert.equal(before.observation.rawSHA256[name],after.observation.rawSHA256[name]);}
  }
}
function stateChanges(b,c){
  const rows=new Map(b.legacy.results[0].trajectories.map(t=>[key(t),t]));let gains=0,losses=0,unchanged=0;const trajectories=[];
  for(const t of c.results[0].trajectories){const a=rows.get(key(t));let gain=0,loss=0,same=0,authorityPass=0;const changes=[];
    for(let i=1;i<t.trace.length;i++){const old=a.trace[i],now=t.trace[i],p=now.validation.valid&&now.literalForceGate,previous=old.validation.valid&&old.literalForceGate,latent=now.validation.valid&&now.authoritativeConverged;
      if(p&&!previous){gain++;changes.push({step:i,public:'gain',authoritativePass:latent});}else if(!p&&previous){loss++;changes.push({step:i,public:'loss',authoritativePass:latent});}else same++;authorityPass+=Number(latent);
    }gains+=gain;losses+=loss;unchanged+=same;trajectories.push({level:t.level,budget:t.budget,seed:t.seed,publicGains:gain,publicLosses:loss,publicUnchanged:same,authoritativePassed:authorityPass,authoritativeFailed:t.steps-authorityPass,changedPublicSteps:changes});
  }assert.equal(gains+losses+unchanged,7110);return {publicGains:gains,publicLosses:losses,publicUnchanged:unchanged,trajectories,scope:'latent passes are separately counted and never public gains; public velocity may differ after initialization'};
}
/** Every inventory path is either byte-identical or on the reviewed change/addition lists; nothing removed. */
export function stateReplayMigration(old,fresh,{changes=STATE_REPLAY_REVIEWED_CHANGES,additions=STATE_REPLAY_REVIEWED_ADDITIONS,git=STATE_REPLAY_ARCHIVE_GIT}={}){
  assert.equal(old.git,git,'closed capture source required');assert.equal(old.dirty,false);assert.equal(fresh.dirty,false);
  const before=new Map(old.files.map(f=>[f.path,f.sha256])),after=new Map(fresh.files.map(f=>[f.path,f.sha256]));
  const changed=[...after].filter(([p,h])=>before.has(p)&&before.get(p)!==h).map(([p])=>p).sort(),added=[...after.keys()].filter(p=>!before.has(p)).sort(),removed=[...before.keys()].filter(p=>!after.has(p));
  assert.deepEqual(removed,[],'historical source removed');
  assert.deepEqual(changed,[...changes].sort(),'unreviewed source change');assert.deepEqual(added,[...additions].sort(),'unreviewed source addition');
  return {historicalFiles:before.size,currentFiles:after.size,reviewedChanged:changed,reviewedAdded:added,allOtherFilesByteIdentical:true};
}
const without=(o,varying)=>Object.fromEntries(Object.entries(o).filter(([k])=>!varying.has(k)));
export function commonCurvatureInputs(b,c){
  assert.equal(Object.hasOwn(b.protocol,'membraneCurvature'),false,'Gauss–Newton baseline must omit the curvature request');
  assert.equal(c.protocol.membraneCurvature,'exact-hessian','named exact-curvature candidate required');
  commonAblationInputs(b,c,CURVATURE_ONLY);
  for(const t of c.results[0].trajectories){assert.equal(t.options.membraneCurvature,'exact-hessian');const a=b.results[0].trajectories.find(x=>key(x)===key(t));assert.equal(Object.hasOwn(a.options,'membraneCurvature')?a.options.membraneCurvature:'gauss-newton','gauss-newton');}
}
/** Same-curvature stop ablation: only the named absolute PCG stop may differ. */
export function commonStoppingInputs(b,c){
  assert.equal(Object.hasOwn(b.protocol,'pcgStop'),false,'relative-stop baseline must omit the PCG stop request');
  assert.equal(c.protocol.pcgStop?.rule,'absolute-residual-infinity-norm','named absolute PCG stop candidate required');
  assert.equal(b.protocol.membraneCurvature,c.protocol.membraneCurvature,'same curvature request required');
  commonAblationInputs(b,c,STOP_ONLY);
  for(const t of c.results[0].trajectories){const a=b.results[0].trajectories.find(x=>key(x)===key(t));
    assert.equal(Object.hasOwn(a.options,'pcgAbsoluteTolerance'),false);assert.ok(Object.is(t.options.pcgAbsoluteTolerance,c.protocol.pcgStop.factorOfForceTolerance*t.forceTolerance),'declared absolute stop value');}
}
function commonAblationInputs(b,c,varying){
  assert.deepEqual(b.source,c.source,'same frozen source required for the ablation');assert.equal(b.protocol.instrument,c.protocol.instrument);
  const old=b.results[0],candidate=c.results[0];
  for(const name of ['geometry','vertices','triangles','material','mesh','fixtureSHA256','meshSHA256','referenceCoefficients','reference','scalarResponseProof','plan'])assert.deepEqual(old[name],candidate[name],'physical reference/input differs: '+name);
  const rows=new Map(old.trajectories.map(t=>[key(t),t]));
  for(const t of candidate.trajectories){const a=rows.get(key(t));assert.ok(a);
    for(const name of ['level','budget','seed','amplitude','substeps','steps','h','fixedForceScale','forceTolerance','modalMass'])assert.equal(a[name],t[name]);
    assert.deepEqual(without(a.options,varying),without(t.options,varying));assert.deepEqual(without(a.runtime.parameters,varying),without(t.runtime.parameters,varying));assert.deepEqual(without(a.runtime.options,varying),without(t.runtime.options,varying));
    assert.deepEqual(a.runtime.massProof,t.runtime.massProof);assert.deepEqual(a.referenceWords,t.referenceWords,'native reference words differ');
    for(const name of ['x','xs','xt','v','u','us','ut','x0','mass','h','initialX','initialU','initialV','reference'])if(a.history[0].stateFloat64LE[name]!==undefined)assert.equal(a.history[0].stateFloat64LE[name],t.history[0].stateFloat64LE[name],'actual native initial bytes changed: '+name);
  }
}
const quantiles=a=>{const s=a.filter(numeric).sort((x,y)=>x-y);return s.length?{minimum:s[0],median:s[Math.floor(s.length/2)],maximum:s.at(-1)}:null;};
export function curvatureChanges(b,c,{labels=['gaussNewton','exactCurvature'],scope='public and latent gate changes are counted separately against the same-source Gauss–Newton baseline; residual quantiles are descriptive; no exact-Newton endpoint is imagined'}={}){
  const [baseLabel,candidateLabel]=labels,baselineEvents={};
  const rows=new Map(b.results[0].trajectories.map(t=>[key(t),t])),totals={public:{gains:0,losses:0,unchanged:0},authoritative:{gains:0,losses:0,unchanged:0}},trajectories=[];
  const events={exactFactorAttempts:0,exactFactors:0,finiteNonpositivePivots:0,gnFallbackFactors:0,nonfiniteFailures:0,pcgAttempts:0,pcgConverged:0,zeroRhs:0,pcgNonpositiveCurvature:0,pcgNonfiniteProduct:0,pcgStagnation:0,pcgIterationLimit:0,pcgNonDescent:0,pcgNonfiniteDirection:0,iterations:0};
  for(const t of c.results[0].trajectories){const a=rows.get(key(t)),row={level:t.level,budget:t.budget,seed:t.seed,public:{gains:0,losses:0,unchanged:0},authoritative:{gains:0,losses:0,unchanged:0},changedSteps:[]};
    for(let i=1;i<t.trace.length;i++){const old=a.trace[i],now=t.trace[i];
      for(const [kind,flag]of [['public','literalForceGate'],['authoritative','authoritativeConverged']]){
        const before=old.validation.valid&&old[flag]===true,after=now.validation.valid&&now[flag]===true,cell=before===after?'unchanged':after?'gains':'losses';
        row[kind][cell]++;totals[kind][cell]++;if(cell!=='unchanged')row.changedSteps.push({step:i,kind,change:cell==='gains'?'gain':'loss'});
      }
    }
    const counters=t.trace.at(-1).solver.membraneCurvatureCounters;assert.ok(counters,'exact-curvature receipts missing');
    for(const k of Object.keys(events)){assert.ok(Number.isSafeInteger(counters[k]),'counter '+k);events[k]+=counters[k];}
    assert.equal(counters.iterations,t.steps*t.budget,'one completed exact iteration per declared Newton iteration');
    row.curvatureEvents=counters;
    const base=a.trace.at(-1).solver.membraneCurvatureCounters;if(base){row.baselineCurvatureEvents=base;for(const k of Object.keys(events))baselineEvents[k]=(baselineEvents[k]??0)+base[k];}
    row.authoritativeResidual={[baseLabel]:quantiles(a.trace.slice(1).map(o=>o.authoritativeResidualInfinity)),[candidateLabel]:quantiles(t.trace.slice(1).map(o=>o.authoritativeResidualInfinity))};
    row.publicResidual={[baseLabel]:quantiles(a.trace.slice(1).map(o=>o.residualInfinity)),[candidateLabel]:quantiles(t.trace.slice(1).map(o=>o.residualInfinity))};
    row.firstStepAuthoritativeResidual={[baseLabel]:a.trace[1].authoritativeResidualInfinity,[candidateLabel]:t.trace[1].authoritativeResidualInfinity};
    trajectories.push(row);
  }
  return {...totals,curvatureEvents:events,...(Object.keys(baselineEvents).length?{baselineCurvatureEvents:baselineEvents}:{}),trajectories,scope};
}
export function compareStateModalReports(a,b,{mode='strict-repeat',oldRawSHA256=null}={}){
  assert.ok(MODES.includes(mode),'unknown named comparison');let comparison,forceOutcomes,changes,sourcePolicy;
  if(mode==='baseline-migration'){
    assert.equal(oldRawSHA256,'796a80bbe6b47c784eea03a9f3545b24780743f9180002a8c7172879d98307de','exact immutable old report required');legacyRows(a);baseline(b);
    sourcePolicy=sourceMigration(a.source,b.legacy.source,b.source);comparison=assertLegacyNumericalReplay(a,b.legacy);
  }else if(mode==='state-replay'){
    const archive=STATE_REPLAY_ARCHIVES[oldRawSHA256];assert.ok(archive,'exact closed fixed24 state capture required');
    forceOutcomes=[stateModalForceOutcomes(a),stateModalForceOutcomes(b)];
    assert.equal(b.protocol.membraneCurvature??'gauss-newton',archive.membraneCurvature,'replay uses the closed capture\'s curvature');assert.equal(Object.hasOwn(b.protocol,'pcgStop'),false,'replay uses the relative PCG stop');
    sourcePolicy={...stateReplayMigration(a.source,b.source,archive),closedCaptureRawSHA256:oldRawSHA256};comparison=assertStateModalPayloadEqual(a,b,{legacy:true});
  }else if(mode==='curvature-comparison'){
    const baselineOutcomes=stateModalForceOutcomes(a);forceOutcomes=stateModalForceOutcomes(b);commonCurvatureInputs(a,b);changes={...curvatureChanges(a,b),baselineFailures:{public:baselineOutcomes.publicFailed,authoritative:baselineOutcomes.authoritativeFailed}};
    for(const kind of ['public','authoritative'])assert.equal(changes[kind].gains+changes[kind].losses+changes[kind].unchanged,7110,'every judged step classified: '+kind);
    comparison={commonActualInputsExactlyEqual:true,excludedInputIdentity:['membraneCurvature'],physicalCSTReferenceUnchanged:true};
  }else if(mode==='stopping-comparison'){
    const baselineOutcomes=stateModalForceOutcomes(a);forceOutcomes=stateModalForceOutcomes(b);commonStoppingInputs(a,b);
    changes={...curvatureChanges(a,b,{labels:['relativeStop','absoluteStop'],scope:'public and latent gate changes counted separately against the same-source, same-curvature relative-stop baseline; residual quantiles are descriptive'}),
      baselineFailures:{public:baselineOutcomes.publicFailed,authoritative:baselineOutcomes.authoritativeFailed}};
    for(const kind of ['public','authoritative'])assert.equal(changes[kind].gains+changes[kind].losses+changes[kind].unchanged,7110,'every judged step classified: '+kind);
    comparison={commonActualInputsExactlyEqual:true,excludedInputIdentity:['pcgAbsoluteTolerance'],physicalCSTReferenceUnchanged:true};
  }else if(mode==='state-comparison'){
    baseline(a);forceOutcomes=stateModalForceOutcomes(b);commonStateInputs(a,b);changes=stateChanges(a,b);comparison={commonActualInputsExactlyEqual:true,excludedInputIdentity:['stateCoordinates'],physicalCSTReferenceUnchanged:true};
  }else{
    forceOutcomes=[stateModalForceOutcomes(a),stateModalForceOutcomes(b)];
    if(mode==='transparent-solve-observer'){assert.equal(a.protocol.instrument,false);assert.equal(b.protocol.instrument,true);}
    comparison=assertStateModalPayloadEqual(a,b,{observerComparison:mode==='transparent-solve-observer'});
  }
  return {schema:'pliego-membrane-state-modal-comparison/1',recordedAt:new Date().toISOString(),mode,comparison,sourcePolicy,forceOutcomes,changes,
    comparatorSHA256:sha(readFileSync(fileURLToPath(import.meta.url))),
    scope:'complete24data identity/recorded force comparison only; preserves failed gates and literal tolerance; no independent HP full-trajectory/real-Armijo/time/material/booklet/device acceptance'};
}
export function reserveStateModalComparison(output){return reserveStateModalOutput(output,{pretty:true});}
export function writeStateModalComparison(output,value){const sink=reserveStateModalComparison(output);try{sink.write(value);}finally{sink.close();}}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),flags={'--observer-comparison':'transparent-solve-observer','--baseline-migration':'baseline-migration','--state-comparison':'state-comparison','--state-replay':'state-replay','--curvature-comparison':'curvature-comparison','--stopping-comparison':'stopping-comparison'},selected=args.filter(a=>Object.hasOwn(flags,a)),oi=args.indexOf('--out');
  assert.ok(selected.length<=1&&oi>=0&&args[oi+1],'one named comparison and --out fresh durable output required');
  const paths=args.filter((a,i)=>!Object.hasOwn(flags,a)&&i!==oi&&i!==oi+1);assert.equal(paths.length,2);assert.ok(paths.every(p=>!p.startsWith('--')),'unknown argument');
  const sink=reserveStateModalComparison(args[oi+1]);try{
    const bytes=paths.map(p=>readFileSync(p)),raws=bytes.map((b,i)=>paths[i].endsWith('.gz')?gunzipSync(b):b),reports=raws.map(b=>JSON.parse(b));
    const result=compareStateModalReports(reports[0],reports[1],{mode:selected.length?flags[selected[0]]:'strict-repeat',oldRawSHA256:sha(raws[0])});result.inputSHA256=bytes.map(sha);result.inputRawSHA256=raws.map(sha);
    sink.write(result);console.error('state-modal-compare: '+result.mode+' fixed24; all failures remain outcomes, no widened acceptance');
  }finally{sink.close();}
}
