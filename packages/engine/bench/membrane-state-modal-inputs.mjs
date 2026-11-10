// Deterministic extraction/verification only: no engine, solver or oracle imports.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const sha=data=>createHash('sha256').update(data).digest('hex');
const ARCHIVE='docs/research/evidence/membrane-reference-2026-11-10/candidate.json.gz';
const OBSERVED='docs/research/evidence/membrane-reference-2026-11-10/observed.json';
export const STATE_MODAL_INPUT_PATH='packages/engine/bench/fixtures/membrane-state-modal-input.json';
export const STATE_MODAL_INPUT_SHA256='e8f006ab770da4ed3790cd8fb8e2a2108be725ec9e4525d227c18b185452d620';
export const STATE_MODAL_ARCHIVE_GIT='d739165c2f0d72382e2882715c33275c2967fff5';
const RAW_SHA='796a80bbe6b47c784eea03a9f3545b24780743f9180002a8c7172879d98307de';
let cached=null;
function freeze(value){if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}

/** Run explicitly once when preparing the committed small fixture. */
export function extractStateModalInputs(){
  const compressed=readFileSync(join(root,ARCHIVE)),bytes=gunzipSync(compressed);assert.equal(sha(bytes),RAW_SHA);
  const old=JSON.parse(bytes);assert.equal(old.schema,'pliego-membrane-modal-audit/0.1');assert.equal(old.source.git,STATE_MODAL_ARCHIVE_GIT);assert.equal(old.source.dirty,false);
  assert.equal(old.results.length,1);assert.equal(old.protocol.stage,'diagnostic');assert.equal(old.protocol.matrix,'smoke');
  const g=old.results[0];assert.deepEqual(g.geometry,{cells:2,pattern:'forward',grain:0});
  const observed=readFileSync(join(root,OBSERVED));assert.equal(sha(observed),'1e892f80e58244130c46d2c3cd4129568c00623e02efc4f444aa5875371a4938');
  const point=JSON.parse(observed).cases[80],reference=Buffer.from(point.referenceFloat64LE,'base64');assert.equal(sha(reference),point.referenceSHA256);
  const rows=g.trajectories.map(t=>({level:t.level,budget:t.budget,seed:t.seed,amplitude:t.amplitude,substeps:t.substeps,steps:t.steps,h:t.h,
    fixedForceScale:t.fixedForceScale,forceTolerance:t.forceTolerance,modalMass:t.modalMass,options:t.options,
    runtime:{massProof:t.runtime.massProof,parameters:t.runtime.parameters,options:t.runtime.options,fixedInitialForceScale:t.runtime.fixedInitialForceScale,forceTolerance:t.runtime.forceTolerance,modalMass:t.runtime.modalMass},
    initial:t.snapshots.initial,trace:t.trace.map(o=>({step:o.step,time:o.time,literalForceGate:o.literalForceGate,residualInfinity:o.residualInfinity}))}));
  const program=old.source.tools.find(t=>t.path==='membrane-modal-reference.py');assert.ok(program);
  return {schema:'pliego-state-modal-inputs/1',geometry:g.geometry,vertices:g.vertices,triangles:g.triangles,material:g.material,mesh:g.mesh,
    fixtureSHA256:g.fixtureSHA256,meshSHA256:g.meshSHA256,reference:g.reference,referenceCoefficients:g.referenceCoefficients,
    scalarResponseProof:g.scalarResponseProof,plan:g.plan,rows,referenceFloat64LE:point.referenceFloat64LE,referenceSHA256:point.referenceSHA256,
    oracleSelfTest:old.oracleSelfTest,referenceCapture:old.referenceCapture,
    provenance:{archive:ARCHIVE,compressedSHA256:sha(compressed),rawSHA256:sha(bytes),rawBytes:bytes.length,sourceGit:STATE_MODAL_ARCHIVE_GIT,
      observed:OBSERVED,observedSHA256:sha(observed),referenceProgramSHA256:program.sha256,
      extractor:'packages/engine/bench/membrane-state-modal-inputs.mjs',extractorVersion:1,
      scope:'deterministic extraction only, no World/oracle/solver calls; immutable actual initial native bytes,24plans and complete old public force classifications; full old report retained separately'}};
}
export function stateModalInputBytes(){return Buffer.from(JSON.stringify(extractStateModalInputs())+'\n');}
export function verifyStateModalInputs(data){
  assert.equal(data.schema,'pliego-state-modal-inputs/1');assert.equal(data.provenance.sourceGit,STATE_MODAL_ARCHIVE_GIT);assert.equal(data.provenance.rawSHA256,RAW_SHA);
  assert.equal(data.plan.S0,22422);assert.equal(data.plan.N0,79);assert.equal(data.rows.length,24);const keys=new Set();
  let steps=0,events=0,failures=0;
  for(const t of data.rows){assert.ok([1,2,4,8].includes(t.level)&&[1,4,16].includes(t.budget)&&[false,true].includes(t.seed));
    const key=[t.level,t.budget,t.seed].join(':');assert.ok(!keys.has(key));keys.add(key);
    assert.equal(t.amplitude,.004);assert.equal(t.substeps,22422*t.level);assert.equal(t.steps,79*t.level);assert.equal(t.h,1/(60*t.substeps));
    assert.equal(t.trace.length,t.steps+1);assert.equal(t.forceTolerance,Math.max(1e-7,1e-10*t.fixedForceScale));assert.equal(t.initial.observation.initial,true);
    for(const [i,o]of t.trace.entries()){assert.equal(o.step,i);if(i){assert.equal(o.literalForceGate,o.residualInfinity<=t.forceTolerance);failures+=Number(!o.literalForceGate);}}
    steps+=t.steps;events+=t.steps*t.budget;
  }
  assert.equal(steps,7110);assert.equal(events,49770);assert.equal(failures,6968);
  const reference=Buffer.from(data.referenceFloat64LE,'base64');assert.equal(reference.toString('base64'),data.referenceFloat64LE);assert.equal(sha(reference),data.referenceSHA256);assert.equal(reference.length%8,0);
  return {trajectories:keys.size,poststeps:steps,newtonEvents:events,archivedPublicFailures:failures};
}
/** Small fixture hash + original compressed source identity, without112MB parsing. */
export function loadStateModalInputs(){
  if(cached)return cached;
  const bytes=readFileSync(join(root,STATE_MODAL_INPUT_PATH));assert.equal(sha(bytes),STATE_MODAL_INPUT_SHA256,'committed state input fixture changed');
  const data=JSON.parse(bytes);verifyStateModalInputs(data);
  assert.equal(sha(readFileSync(join(root,ARCHIVE))),data.provenance.compressedSHA256,'immutable old archive changed');
  assert.equal(sha(readFileSync(join(root,OBSERVED))),data.provenance.observedSHA256);
  assert.equal(sha(readFileSync(join(root,'packages/engine/bench/membrane-modal-reference.py'))),data.provenance.referenceProgramSHA256,'independent archived reference source changed');
  const raw=Buffer.from(data.referenceFloat64LE,'base64');data.referenceWords=Array.from({length:raw.length/8},(_,i)=>raw.readDoubleLE(8*i));
  data.provenance={...data.provenance,smallFixture:STATE_MODAL_INPUT_PATH,smallFixtureSHA256:STATE_MODAL_INPUT_SHA256,smallFixtureBytes:bytes.length};
  cached=freeze(data);return cached;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);assert.ok(args.length===2&&args[0]==='--extract'&&!args[1].startsWith('--'),'only --extract fresh-output is supported');
  const data=stateModalInputBytes();verifyStateModalInputs(JSON.parse(data));writeFileSync(resolve(args[1]),data,{flag:'wx',mode:0o600});
  console.error('state-modal-inputs:24actualinitial bindings,7110old statuses,49770declared Newton events, no stepping; bytes='+data.length+' SHA256='+sha(data));
}
