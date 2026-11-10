import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,symlinkSync,openSync,closeSync,fstatSync,constants} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {makePatch} from '../bench/membrane-patch.mjs';
import {loadStateWitness,createStateProbeWorld,evaluateStateFixture,stateProbeSource,assertStateProbeSource,runStateProbes,writeStateProbeReport} from '../bench/membrane-state-probes.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const root=fileURLToPath(new URL('../../../',import.meta.url));
let witness,captured;
function fixture(){return witness??=loadStateWitness();}
function withBoundReport(path,inspect){
  const descriptor=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const info=fstatSync(descriptor,{bigint:true});return inspect({mode:info.mode&0o777n,dev:info.dev,ino:info.ino,content:readFileSync(descriptor)});}
  finally{closeSync(descriptor);}
}
function bindings(c){
  const a={x:c.x,xt:c.xt,u:c.state.u,ut:c.state.ut,mass:c.mass,h:[c.h],initialX:c.state.initialization.x,initialU:c.state.initialization.u,us:c.state.us,v:c.state.v,xs:c.xs,initialV:c.state.initialization.v,x0:c.state.x0};
  for(const p of ['authoritative','public'])for(const k of ['elasticGradient','inertiaGradient','residual'])a[p+k[0].toUpperCase()+k.slice(1)]=c.runtime[p][k];
  assert.deepEqual(Object.keys(c.stateFloat64LE).sort(),Object.keys(a).sort());assert.deepEqual(Object.keys(c.stateSHA256).sort(),Object.keys(a).sort());
  for(const [k,values]of Object.entries(a)){
    const raw=Buffer.from(c.stateFloat64LE[k],'base64');assert.equal(raw.toString('base64'),c.stateFloat64LE[k]);assert.equal(sha(raw),c.stateSHA256[k]);assert.equal(raw.length,values.length*8);assert.ok(values.every((v,i)=>Object.is(v,raw.readDoubleLE(8*i))),k);
  }
  for(const [name,x,target,gate]of [['authoritative',c.state.u,c.state.ut,'converged'],['public',c.x,c.xt,'literalForceGate']]){
    const r=c.runtime[name],inertia=x.map((v,i)=>c.mass[Math.floor(i/3)]*(1/(c.h*c.h))*(v-target[i]));assert.deepEqual(r.inertiaGradient,inertia);
    assert.deepEqual(r.residual,r.elasticGradient.map((v,i)=>v+inertia[i]));assert.equal(r.residualInfinity,Math.max(...r.residual.map(Math.abs)));assert.equal(r[gate],r.residualInfinity<=c.runtime.forceTolerance);
  }
  assert.equal(c.runtime.forceTolerance,Math.max(1e-7,1e-10*c.runtime.fixedForceScale));
  const ref=Buffer.from(c.referenceFloat64LE,'base64');assert.equal(sha(ref),c.referenceSHA256);assert.equal(ref.length,22*8*c.referenceCoefficients.elements.length);
}

test('bounded witness uses exact archived initial bytes, old public failed endpoint and separate native gates',()=>{
  const w=fixture();assert.equal(w.provenance.caseIndex,80);assert.equal(w.expectedPublicResidual,.005058552080299705);assert.equal(w.forceTolerance,8.81400646629321e-5);
  captured=evaluateStateFixture(w);bindings(captured.case);assert.equal(captured.baseline.public.literalForceGate,false);assert.equal(captured.baseline.public.residualInfinity,w.expectedPublicResidual);
  assert.equal(captured.case.state.targetValid,true);assert.equal(captured.initial.targetValid,false);assert.equal(captured.events.length,16);assert.equal(captured.checks.observerParity,true);assert.equal(captured.checks.boundarySnapshotReplay,true);
  let sub=0;
  for(const e of captured.events){
    for(const [k,a]of Object.entries(e.fields)){const raw=Buffer.from(e.float64LE[k],'base64');assert.equal(sha(raw),e.SHA256[k]);assert.ok(a.every((v,i)=>Object.is(v,raw.readDoubleLE(8*i))));}
    const moved=e.fields.afterU.some((v,i)=>v!==e.fields.beforeU[i]),samePublic=e.fields.afterX.every((v,i)=>Object.is(v,e.fields.beforeX[i]));assert.equal(e.nonzeroAuthoritativeUpdate,moved);assert.equal(e.publicPositionBytesUnchanged,samePublic);
    if(e.last.decision==='accepted'&&moved&&samePublic)sub++;
  }
  assert.equal(captured.checks.actualAcceptedSubPublicUpdates,sub);w.assertInputsUnchanged();
  console.log('state-probes-witness: archived first failed substep exactly replayed by old mode; one-step new authority/public gates and all16 native search events bound; observer/snapshot replay exact');
});

test('exact dyadic rigid-translation control preserves one-step physical inputs without widening material or force policy',()=>{
  const w=fixture(),patch=makePatch({...w.geometry,membraneModel:'orthotropic-stvk',membraneNu12:w.material.nu12}),x=Array.from(patch.world.X0);for(let i=0;i<x.length;i+=3)x[i]+=2**-10;
  const c={...w,initialX:x,initialV:x.map(()=>0),expected:undefined,expectedPublicResidual:undefined},r=evaluateStateFixture(c,'dyadic-control');bindings(r.case);
  assert.equal(r.case.runtime.authoritative.energy,0);assert.equal(r.case.runtime.public.energy,0);assert.equal(r.case.runtime.authoritative.converged,true);assert.equal(r.case.runtime.public.literalForceGate,true);
  assert.deepEqual(r.case.x,r.baseline.x);assert.deepEqual(r.case.state.initialization.x,x);assert.equal(r.case.h,w.h);assert.equal(r.case.runtime.forceTolerance,w.forceTolerance);
  console.log('state-probes-control: exact +2^-10mm rigid X shift; same system/mass/h/tau, zero elasticity, both gates and public coordinates agree');
});

test('state boundary API preserves initial zero buffers, refuses edits/cross-mode snapshots before mutation',()=>{
  const w=fixture(),patch=makePatch({...w.geometry,membraneModel:'orthotropic-stvk',membraneNu12:w.material.nu12}),a=createStateProbeWorld(patch,w,'reference-displacement'),b=createStateProbeWorld(patch,w);
  const initial=a.authoritativeState();assert.equal(initial.targetValid,false);assert.ok(initial.xs.every(v=>Object.is(v,0))&&initial.xt.every(v=>Object.is(v,0)));
  const s=a.snapshot(),old=b.snapshot();assert.throws(()=>b.restore(s),/snapshot|coordinate|mismatch/);assert.deepEqual(b.snapshot(),old);assert.throws(()=>a.restore(old),/snapshot|coordinate|mismatch/);assert.deepEqual(a.snapshot(),s);
  const copy=a.authoritativeState();copy.u[0]+=1;assert.deepEqual(a.snapshot(),s,'copies must not alias authority');
  a.x[0]+=1;assert.throws(()=>a.authoritativeState(),/unsynchronized/);a.x.set(initial.x);assert.deepEqual(a.snapshot(),s);
  console.log('state-probes-api: original constructor zero xs/xt retained, copied authority has no writable aliases, cross-mode restore and unsynchronized public writes refuse');
});

test('independent new state oracle consumes complete authority/public raw bindings without changing old evaluators',()=>{
  const c=(captured??evaluateStateFixture(fixture())).case,oracle=fileURLToPath(new URL('../bench/membrane-state-precision.py',import.meta.url)),python=process.env.PLIEGO_AUDIT_PYTHON||'python3';
  const outputs=[80,100].map(d=>JSON.parse(execFileSync(python,[oracle,'--digits',String(d)],{input:JSON.stringify(c),encoding:'utf8',maxBuffer:8e6})));
  for(const output of outputs)for(const c of output.cases)delete c.decimalDigits;assert.deepEqual(outputs[0],outputs[1]);
  const bad=structuredClone(c);bad.stateSHA256.authoritativeResidual='0'.repeat(64);const run=spawnSync(python,[oracle],{input:JSON.stringify(bad),encoding:'utf8'});assert.equal(run.status,1);assert.equal(run.stdout,'');
  console.log('state-probes-oracle: one native poststep case full80/100 equality except precision field; malformed independent residual binding refused; no whole-time gate closure');
});

test('source guards forbid dirty captures and output writes stay exclusive outside checkout',()=>{
  const source=stateProbeSource();assert.ok(source.files.length>50);assert.ok(source.files.some(f=>f.path.endsWith('/reference-state.js')));assert.ok(source.files.some(f=>f.path.endsWith('/membrane-state-precision.py')));assert.ok(source.files.some(f=>f.path.endsWith('/membrane-model-coordinates.test.js')));assert.ok(source.files.some(f=>f.path.endsWith('/increment-search-state.test.js')));
  assertStateProbeSource(source);const changed=structuredClone(source);changed.files[0].sha256='0'.repeat(64);assert.throws(()=>assertStateProbeSource(changed),/source changed/);if(source.status)assert.throws(()=>runStateProbes(),/clean source required/);
  const dir=mkdtempSync(join(tmpdir(),'pliego-state-probes-io-'));
  try{
    const out=join(dir,'report.json'),report={fixture:true};writeStateProbeReport(out,report);const expected=Buffer.from(JSON.stringify(report)+'\n');
    withBoundReport(out,before=>{assert.equal(before.mode,0o600n);assert.deepEqual(before.content,expected);assert.throws(()=>writeStateProbeReport(out,{}),/EEXIST/);withBoundReport(out,after=>assert.deepEqual(after,before));});
    const target=join(dir,'target'),link=join(dir,'link');writeFileSync(target,'retained');symlinkSync(target,link);assert.throws(()=>writeStateProbeReport(link,{}),/EEXIST/);assert.equal(readFileSync(target,'utf8'),'retained');
    const inside=join(dir,'inside');symlinkSync(root,inside);assert.throws(()=>writeStateProbeReport(join(inside,'unused.json'),{}),/outside checkout/);
  }finally{rmSync(dir,{recursive:true,force:true});}
  console.log('state-probes-integrity: nonempty source inventory and mismatch/dirty capture refusal; exclusive0600 writes with inode/content and symlink/path checks');
});
