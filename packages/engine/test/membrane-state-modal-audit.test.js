import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync,chmodSync,rmSync,statSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {makePatch} from '../bench/membrane-patch.mjs';
import {loadStateModalInputs,verifyStateModalInputs,STATE_MODAL_INPUT_PATH,STATE_MODAL_INPUT_SHA256} from '../bench/membrane-state-modal-inputs.mjs';
import {runStateModalTrajectory,stateModalPairedControls,stateModalSource,assertStateModalSource,runStateModalAudit,reserveStateModalOutput,STATE_MODAL_PROTOCOL} from '../bench/membrane-state-modal-audit.mjs';
import {assertStateModalPayloadEqual,assertLegacyNumericalReplay,stateModalTrajectoryOutcome,compareStateModalReports,reserveStateModalComparison} from '../bench/compare-membrane-state-modal-audit.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
let toys;
function trajectories(){
  if(toys)return toys;
  const p=loadStateModalInputs(),patch=makePatch({...p.geometry,membraneModel:'orthotropic-stvk',membraneNu12:.293});
  toys=[false,true].map(seed=>{
    const row={...p.rows.find(t=>t.level===8&&t.budget===4&&t.seed===seed),steps:3};
    return {row,plain:runStateModalTrajectory(patch,p.reference,row,{instrument:false}),observed:runStateModalTrajectory(patch,p.reference,row,{instrument:true})};
  });return toys;
}
function shell(t,instrument){return {recordedAt:'unit-fixture',protocol:{instrument,perNewtonLinearDiagnostics:instrument?'measured':'not measured'},
  gates:{perNewtonLinearDiagnostics:instrument?true:'not measured',actualTimeAccuracyAcceptance:false},results:[{trajectories:[t]}]};}

test('committed small input fixture pins all24 actual old inputs without repeated112MB parsing',()=>{
  const data=loadStateModalInputs();assert.equal(sha(readFileSync(join(root,STATE_MODAL_INPUT_PATH))),STATE_MODAL_INPUT_SHA256);
  assert.deepEqual(verifyStateModalInputs(data),{trajectories:24,poststeps:7110,newtonEvents:49770,archivedPublicFailures:6968});
  assert.ok(Object.isFrozen(data)&&Object.isFrozen(data.rows)&&Object.isFrozen(data.rows[0].initial.observation.x));
  assert.throws(()=>{data.reference.mode.omega=0;},TypeError);
  for(const mutate of [x=>{x.rows.pop();},x=>{x.rows[0].h*=2;},x=>{x.rows[0].fixedForceScale*=2;},x=>{x.rows[0].trace[1].literalForceGate=!x.rows[0].trace[1].literalForceGate;},x=>{x.referenceSHA256='0'.repeat(64);}]){
    const changed=structuredClone(data);mutate(changed);assert.throws(()=>verifyStateModalInputs(changed));
  }
  assert.equal(STATE_MODAL_PROTOCOL.trajectories,24);assert.equal(STATE_MODAL_PROTOCOL.poststeps,7110);assert.equal(STATE_MODAL_PROTOCOL.newtonEvents,49770);
  console.log('state-modal-inputs: immutable1.38MBfixture binds24oldnativeinitial plans/7110statuses/49770events; changed time/F0/ref/status/row rejected; no re-eigenproblem or stepping');
});

test('three actual steps perstart retain all raw state/force words and replay the completed final substep',()=>{
  for(const {row,observed}of trajectories()){
    assert.equal(observed.runtime.status,'completed');assert.equal(observed.trace.length,4);assert.equal(observed.history.length,4);
    assert.equal(observed.solveObservation.trace.length,12);assert.equal(observed.solveObservation.counts.retained,0);assert.equal(observed.solveObservation.counts.callbackErrors,0);
    assert.ok(observed.trace.every(t=>t.validation.valid));assert.ok(observed.trace.slice(1).every(t=>t.validation.boundaryCertified&&t.validation.actualGradientChecked));assert.equal(observed.trace[0].literalForceGate,null);assert.equal(observed.trace[0].authoritativeConverged,null);
    assert.ok(observed.history.slice(1).some(h=>h.v.some(v=>v!==0)),'multiple steps include nonzero native velocity');
    for(const h of observed.history){assert.equal(Object.keys(h.stateFloat64LE).length,14);assert.equal(Object.keys(h.forceFloat64LE).length,6);assert.equal(h.u.length,27);assert.equal(h.x.length,27);}
    assert.deepEqual(observed.continuation,{requested:true,checkpointStep:2,attemptedPublicCalls:1,replayedPublicCalls:1,declaredNewtonBudget:4,extraControlNotJudgedTrajectory:true,pass:true,error:null});
    const checked=stateModalTrajectoryOutcome(observed,{expected:row,instrument:true});assert.equal(checked.poststeps,3);assert.equal(checked.publicFailed,observed.failedSteps);assert.equal(checked.authoritativeFailed,observed.authoritativeFailedSteps);
    assert.equal(observed.gates.timeAccuracyAcceptance,false);assert.equal(observed.gates.selectedNativeCIntegratorIsolation,'not measured');
    assert.ok(observed.snapshots['checkpoint-0']&&observed.snapshots.final);
  }
  console.log('state-modal-small-runtime: bothstarts3judgedcalls+oneexplicitrestorecontrol each; all4rawstates/12Newtondecisions retained, nativebindings/gates validated, no fullmatrix capture');
});

test('transparent comparison keeps every actual field while excluding only named observer metadata',()=>{
  for(const {plain,observed}of trajectories()){
    const a=shell(plain,false),b=shell(observed,true);b.recordedAt='other';
    const check=assertStateModalPayloadEqual(a,b,{observerComparison:true});assert.ok(check.leavesCompared>10000);assert.ok(check.excludedFields.includes('results[].trajectories[].solveObservation'));
    const repeat=structuredClone(b);repeat.recordedAt='repeat';assertStateModalPayloadEqual(b,repeat);
    for(const mutate of [r=>{r.results[0].trajectories[0].forceTolerance*=2;},r=>{r.results[0].trajectories[0].history[1].u[0]+=.01;},r=>{r.results[0].trajectories[0].trace[1].literalForceGate=true;},r=>{r.results[0].trajectories[0].runtime.parameters.newtonIterations++;},r=>{r.gates.actualTimeAccuracyAcceptance=true;}]){
      const changed=structuredClone(b);mutate(changed);assert.throws(()=>assertStateModalPayloadEqual(a,changed,{observerComparison:true}));
    }
  }
  console.log('state-modal-observer-parity: complete3stepstates/metrics/counters/control replay matchbothstarts; timing/budget/force/rawstate/gate mutations refused outside explicit observer-only exclusions');
});

test('trajectory integrity rejects raw/force drift, missingfalsegates, callbacks, omittedsteps and changed budgets',()=>{
  const {row,observed}=trajectories()[0];
  for(const mutate of [
    t=>{t.trace[1].literalForceGate=!t.trace[1].literalForceGate;},t=>{delete t.gates.authoritativeForceEverySubstep;},t=>{t.history.pop();},
    t=>{t.history[1].u[0]+=.01;},t=>{t.history[1].forceSHA256.authoritativeResidual='0'.repeat(64);},
    t=>{t.solveObservation.counts.callbackErrors=1;},t=>{t.options.newtonIterations++;},t=>{t.runtime.h*=2;},t=>{t.gates.timeAccuracyAcceptance=true;},
  ]){const changed=structuredClone(observed);mutate(changed);assert.throws(()=>stateModalTrajectoryOutcome(changed,{expected:row,instrument:true}));}
  const legacy={recordedAt:'old',source:{git:'a'},native:{mass:[1,2],h:.1,initial:[3,4]},outcomes:{literal:false,energy:5}};
  const fresh=structuredClone(legacy);fresh.recordedAt='new';fresh.source={git:'b'};assertLegacyNumericalReplay(legacy,fresh);
  for(const mutate of [t=>{t.native.mass[0]=2;},t=>{t.native.h=.2;},t=>{t.outcomes.literal=true;},t=>{t.outcomes.energy=6;}]){const changed=structuredClone(fresh);mutate(changed);assert.throws(()=>assertLegacyNumericalReplay(legacy,changed));}
  assert.throws(()=>compareStateModalReports({}, {},{mode:'unreviewed'}),/unknown named comparison/);
  console.log('state-modal-integrity: nine genuine captured-trajectory mutations refused; legacy pureprojection excludesonlysource+recordedAt and retains failed numericalfields; no mocknumericalacceptance');
});

test('allstep budget andcommon-nominal-time reducers use complete states andretain actual clock drift',()=>{
  const {observed}=trajectories()[0],p=loadStateModalInputs(),a=structuredClone(observed),b=structuredClone(observed),fine=structuredClone(observed);
  a.level=1;a.budget=4;a.h=1;b.level=1;b.budget=16;b.h=1;
  for(const r of [a,b])r.history.forEach((h,i)=>{h.step=i;h.time=i;});
  fine.level=2;fine.budget=4;fine.h=.5;fine.steps=6;fine.history=Array.from({length:7},(_,i)=>{const h=structuredClone(a.history[Math.floor(i/2)]);h.step=i;h.time=i*.5+(i===4?1e-12:0);return h;});
  const config={vertices:p.vertices,mass:p.reference.mass,phi:p.reference.mode.phi,omega:p.reference.mode.omega,amplitude:.004};
  const reduced=stateModalPairedControls([a,b,fine],config);
  assert.equal(reduced.budget.length,1);assert.equal(reduced.budget[0].matchedStates,4);assert.equal(reduced.budget[0].maximumAuthoritativeStateChange,0);
  assert.equal(reduced.commonTimeLevels.length,1);assert.equal(reduced.commonTimeLevels[0].matchedStates,4);assert.ok(reduced.commonTimeLevels[0].maximumActualClockDifference>0);
  assert.equal(reduced.amplitude.measured,false);
  console.log('state-modal-pairs: reducer-only synthetic timing fixture coversall4matchedstates,k→2k nominalalignment andnonzeroactualclockdrift; no physical timeacceptance');
});

test('source coverage, fixedscope anddurable exclusive held-descriptor output preflight',()=>{
  const before=stateModalSource();assert.ok(before.files.length>100);for(const ending of ['membrane-state-modal-input.json','membrane-state-modal-runtime.mjs','membrane-state-modal-validation.mjs','membrane-state-modal-solve-observer.mjs','membrane-state-precision.py'])assert.ok(before.files.some(f=>f.path.endsWith(ending)));
  const corrupt=structuredClone(before);corrupt.files[0].sha256='0'.repeat(64);assert.throws(()=>assertStateModalSource(corrupt),/source changed/);
  assert.throws(()=>runStateModalAudit({allowDirty:true}),/unknown state audit/);assert.throws(()=>runStateModalAudit({matrix:'full'}),/unknown state audit/);
  const base=join(dirname(root.replace(/\/$/,'')),'.pliego-engine-unit-artifacts');mkdirSync(base,{recursive:true,mode:0o700});
  const dir=mkdtempSync(join(base,'state-modal-'));chmodSync(dir,0o700);
  try{
    for(const [reserve,name]of [[reserveStateModalOutput,'audit.json'],[reserveStateModalComparison,'comparison.json']]){
      const path=join(dir,name),sink=reserve(path);sink.write({fixture:'unit-only'});assert.throws(()=>sink.write({}),/one open descriptor|assertion/i);assert.throws(()=>reserve(path),/EEXIST/);sink.close();sink.close();
      const info=statSync(path);assert.equal(info.mode&0o777,0o600);assert.ok(info.size>0);
    }
    const failedPath=join(dir,'failed-reservation.json'),failed=reserveStateModalOutput(failedPath);failed.close();assert.equal(statSync(failedPath).size,0,'failedreservedartifact is retained');
    const link=join(dir,'inside');symlinkSync(root,link);assert.throws(()=>reserveStateModalOutput(join(link,'unused.json')),/outside checkout/);
    const bad=join(dir,'bad');mkdirSync(bad,{mode:0o755});assert.throws(()=>reserveStateModalOutput(join(bad,'out.json')),/0700/);
    const result=spawnSync(process.execPath,[join(root,'packages/engine/bench/membrane-state-modal-audit.mjs'),'--matrix','full','--out',join(dir,'never.json')],{encoding:'utf8'});assert.equal(result.status,1);assert.match(result.stderr,/unknown option/);
  }finally{rmSync(dir,{recursive:true,force:true});}
  console.log('state-modal-source-io: allnewhelpers/fixture/oracles/tests bound; noaccepted dirty/fullscopeoverride; preflightdurable0700/exclusive0600 singleheldFD, emptyfailedartifact andsymlinkrefusal');
});
