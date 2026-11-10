import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {makePatch} from '../bench/membrane-patch.mjs';
import {loadStateModalInputs} from '../bench/membrane-state-modal-inputs.mjs';
import {runStateModalTrajectory,stateModalSource} from '../bench/membrane-state-modal-audit.mjs';
import {stateModalProbeCase,stateModalTrajectoryProbes,assertStateModalProbeSource} from '../bench/membrane-state-modal-probes.mjs';

test('serialized capture provenance matches exact current inventory without an undefined status property',()=>{
  const before=stateModalSource(),captured=JSON.parse(JSON.stringify({...before,status:undefined,dirty:false}));
  assertStateModalProbeSource(captured,before);
  for(const mutate of [s=>{s.git='0'.repeat(40);},s=>{s.files[0].sha256='0'.repeat(64);},s=>{s.dirty=true;}]){
    const changed=structuredClone(captured);mutate(changed);assert.throws(()=>assertStateModalProbeSource(changed,before));
  }
  console.log('state-modal-probe-source: actual inventory JSON roundtrip accepted; changed commit/file/clean identity refused');
});

test('captured failed and passing endpoint roles keep original lossless words and independently evaluate',()=>{
  const p=loadStateModalInputs(),patch=makePatch({...p.geometry,membraneModel:'orthotropic-stvk',membraneNu12:.293});
  const input={...p.rows.find(r=>r.level===8&&r.budget===4&&!r.seed),steps:3};
  const row=runStateModalTrajectory(patch,p.reference,input,{instrument:false,restoreContinuation:false});
  const group={vertices:patch.vertices,triangles:patch.triangles,material:patch.material,geometry:p.geometry};
  const probes=stateModalTrajectoryProbes(group,row,0);
  assert.equal(probes.cases.length,3);assert.ok(probes.skipped.every(s=>s.step===0));
  const censored=structuredClone(row);censored.snapshots['uncertified-control']=structuredClone(row.snapshots.final);censored.snapshots['uncertified-control'].observation.targetValid=false;
  const retained=stateModalTrajectoryProbes(group,censored,0);assert.equal(retained.cases.length,3);assert.ok(retained.skipped.some(s=>s.role==='uncertified-control'&&s.reason==='uncertified target'));
  const seen=new Set();
  for(const c of probes.cases){
    assert.ok(!seen.has(c.selection.step));seen.add(c.selection.step);
    assert.equal(Object.keys(c.stateFloat64LE).length,19);assert.equal(c.referenceFloat64LE,row.referenceWords.stateFloat64LE.reference);
    const o=row.snapshots['checkpoint-'+c.selection.step].observation;
    for(const key of Object.keys(c.stateFloat64LE)){
      assert.equal(c.stateFloat64LE[key],(o.stateFloat64LE[key]??o.forceFloat64LE[key]));assert.equal(c.stateSHA256[key],(o.stateSHA256[key]??o.forceSHA256[key]));
    }
  }
  const first=probes.cases[0],oracle=fileURLToPath(new URL('../bench/membrane-state-precision.py',import.meta.url));
  const checked=spawnSync('python3',[oracle,'--digits','80'],{input:JSON.stringify({cases:[first]}),encoding:'utf8',maxBuffer:4*1024*1024});
  assert.equal(checked.status,0,checked.stderr);const truth=JSON.parse(checked.stdout).cases[0];
  assert.equal(truth.native.public.nativeAssociationVerified,true);assert.equal(truth.native.authoritative.nativeAssociationVerified,true);
  assert.equal(truth.native.public.literalForceGate,first.runtime.public.literalForceGate);assert.equal(truth.native.authoritative.converged,first.runtime.authoritative.converged);
  assert.throws(()=>stateModalProbeCase(group,row,row.snapshots.initial.observation,{}));
  const corrupt=structuredClone(row);corrupt.snapshots.final.observation.forceSHA256.publicResidual='0'.repeat(64);
  assert.throws(()=>stateModalTrajectoryProbes(group,corrupt,0));
  console.log('state-modal-probes: all3completed endpoints selected regardless force result; constructor roles explicitly skipped; original19LE/SHA+reference copied; independent exact force associations checked without additional physics calls');
});
