import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, symlinkSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runReferenceProbes, evaluateFrozenReferencePose, referenceProbeSource, assertReferenceProbeSource, writeReferenceProbeReport } from '../bench/membrane-reference-probes.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url)),producer=fileURLToPath(new URL('../bench/membrane-reference-probes.mjs',import.meta.url));
let restFixture;
const hash=v=>createHash('sha256').update(v).digest('hex');
function bound(c){
  const fields={x:c.x,gradient:c.runtime.gradient,direction:c.direction,inertiaGradient:c.inertiaGradient,xt:c.xt,mass:c.mass,h:[c.h],incrementalGradient:c.runtime.incrementalGradient,...(c.after?{after:c.after}:{})};
  assert.deepEqual(Object.keys(c.stateFloat64LE).sort(),Object.keys(fields).sort());assert.deepEqual(Object.keys(c.stateSHA256).sort(),Object.keys(fields).sort());
  for(const [key,values]of Object.entries(fields)){
    const raw=Buffer.from(c.stateFloat64LE[key],'base64');assert.equal(raw.length,8*values.length);assert.equal(hash(raw),c.stateSHA256[key]);
    assert.ok(values.every((v,i)=>Object.is(v,raw.readDoubleLE(8*i))),'lossless '+key);
  }
  const inertia=c.x.map((x,i)=>c.mass[Math.floor(i/3)]*(1/(c.h*c.h))*(x-c.xt[i]));assert.deepEqual(c.inertiaGradient,inertia);
  assert.deepEqual(c.runtime.incrementalGradient,c.runtime.gradient.map((g,i)=>g+inertia[i]));
  if(c.runtime.membraneReference==='uv-displacement'){
    assert.deepEqual(c.referenceEncoding,{version:1,order:['u[3]','v[3]','x0[9]','c','s','Q[4]','volume'],floatsPerElement:22,nativeElementOrder:true});
    const native=c.referenceCoefficients.elements.flatMap(e=>[...e.reference.u,...e.reference.v,...e.reference.x0,e.reference.c,e.reference.s,...e.Q,e.volume]),raw=Buffer.from(c.referenceFloat64LE,'base64');
    assert.equal(raw.length,8*22*c.referenceCoefficients.elements.length);assert.equal(hash(raw),c.referenceSHA256);assert.ok(native.every((v,i)=>Object.is(v,raw.readDoubleLE(8*i))),'native reference constants/signed-zero bits');
  }else{assert.equal(c.referenceFloat64LE,undefined);assert.equal(c.referenceSHA256,undefined);assert.equal(c.referenceEncoding,undefined);}
}

test('declared32 actual UV native-rest searches retain decisions, actual last endpoint and lossless inputs',()=>{
  const r=runReferenceProbes({kind:'rest',allowDirty:true});restFixture=r.cases[0];assert.equal(r.cases.length,32);assert.equal(r.protocol.kind,'rest');
  assert.equal(r.protocol.membraneArithmetic,'double-double');assert.deepEqual(r.protocol.membraneReferences,['uv-displacement']);
  const expected=new Set();for(const g of [0,31,45,90])for(const i of [0,2])for(const d of [-1,1])for(const m of [2**-40,2**-50])expected.add([g,i,d,m].join('/'));
  for(const c of r.cases){
    expected.delete([c.probe.grain,c.probe.index,c.probe.direction,c.probe.magnitude].join('/'));bound(c);
    assert.ok(c.referenceCoefficients.elements.every(e=>e.reference.mode==='uv-displacement'));assert.equal(c.runtime.energy,0);assert.ok(c.runtime.gradient.every(g=>g===0));
    const last=c.runtime;assert.equal(last.alpha,2**-(last.trials-1));assert.ok(last.trials>=1&&last.trials<=21);
    const candidate=c.search.candidate,actualLast=last.trials===1?candidate:c.x.map((x,i)=>x+last.alpha*(candidate[i]-x));assert.deepEqual(c.after,actualLast);
    assert.deepEqual(c.search.finalWorld,last.decision==='accepted'?c.after:c.x);
    if(last.decision==='accepted')assert.ok(last.delta<0&&last.delta<=last.armijoRhs,'computed strict Armijo, no heuristic allowance');
    for(const [name,values]of [['candidate',candidate],['finalWorld',c.search.finalWorld]]){
      const raw=Buffer.from(c.search[name+'Float64LE'],'base64');assert.equal(hash(raw),c.search[name+'SHA256']);assert.ok(values.every((v,i)=>Object.is(v,raw.readDoubleLE(8*i))));
    }
  }
  assert.equal(expected.size,0);console.log('reference-probes-rest: all32 declared real EnergySearch calls; native-rest elastic truth, exact last-trial reconstruction, decisions and LE/native-inertia bindings checked; no timestep');
});

test('single frozen49 pair preserves historical DD replay and physical fields while selecting new UV reference explicitly',()=>{
  const archive=JSON.parse(readFileSync(join(root,'docs/research/evidence/membrane-increment-2026-11-10/captured-trials-input.json')));
  const history=JSON.parse(readFileSync(join(root,'docs/research/evidence/membrane-double-double-2026-11-10/gradient-probes.json')));
  const old=history.cases.find(c=>c.capture.inputIndex===49&&c.runtime.arithmetic==='double-double');
  const [a,b]=evaluateFrozenReferencePose(archive.cases[49],49,old);bound(a);bound(b);
  for(const key of ['x','xt','mass','h','direction','inertiaGradient'])assert.deepEqual(a[key],b[key]);
  assert.equal(a.capture.oracle,'membrane-gradient-precision.py');assert.equal(b.capture.oracle,'membrane-reference-precision.py');
  assert.ok(a.referenceCoefficients.elements.every(e=>e.reference===undefined));assert.ok(b.referenceCoefficients.elements.every(e=>e.reference.mode==='uv-displacement'));
  assert.equal(a.runtime.energy,old.runtime.energy);
  const bad=structuredClone(archive.cases[49]);bad.stateSHA256.before='0'.repeat(64);assert.throws(()=>evaluateFrozenReferencePose(bad),/Assertion/);
  const changedDirection=structuredClone(archive.cases[49]);const raw=Buffer.from(changedDirection.stateFloat64LE.after,'base64');raw.writeDoubleLE(raw.readDoubleLE(0)+1e-8,0);changedDirection.after[0]=raw.readDoubleLE(0);changedDirection.stateFloat64LE.after=raw.toString('base64');changedDirection.stateSHA256.after=hash(raw);assert.throws(()=>evaluateFrozenReferencePose(changedDirection,49,old),/historical DD direction replay differs/);
  console.log('reference-probes-frozen: one actual archived pair; old DD energy/gradient replay exact and new reference descriptor explicit; all native inputs/direction/inertia fixed; corrupt lossless source refused');
});

test('observed kind re-evaluates retained actual inputs and deduplicates event roles without changing the full solver gradient',()=>{
  // Explicit parser fixture assembled from an actual fixed-pose EnergySearch
  // capture; its mocked modal header is not simulation/provenance evidence.
  const c=restFixture??runReferenceProbes({kind:'rest',allowDirty:true}).cases[0],trial={before:c.x,after:c.after,xt:c.xt,mass:c.mass,h:c.h,gradient:c.runtime.incrementalGradient,runtime:{decision:c.runtime.decision,alpha:c.runtime.alpha,trials:c.runtime.trials,delta:c.runtime.delta,slope:c.runtime.slope,armijoRhs:c.runtime.armijoRhs,c1:1e-4},stateFloat64LE:{},stateSHA256:{}};
  for(const key of ['before','after','xt','mass','h','gradient']){
    const values=key==='h'?[trial.h]:trial[key],raw=Buffer.alloc(8*values.length);values.forEach((v,i)=>raw.writeDoubleLE(v,8*i));trial.stateFloat64LE[key]=raw.toString('base64');trial.stateSHA256[key]=hash(raw);
  }
  const event={valid:true,iteration:1,substepsRun:0,incrementTrial:trial},report={schema:'pliego-membrane-modal-audit/0.1',source:{dirty:false,git:'a'.repeat(40)},
    gates:{sourceClean:true,completeDeclaredMatrix:true,measurementValid:true},protocol:{membraneReference:'uv-displacement',membraneArithmetic:'double-double',lineSearchArithmetic:'membrane-inertia-increment',instrument:true},
    results:[{geometry:{cells:1,pattern:'forward',grain:c.grain},vertices:c.vertices,triangles:c.triangles,material:c.material,referenceCoefficients:JSON.parse(JSON.stringify(c.referenceCoefficients)),
      trajectories:[{level:1,budget:1,seed:false,amplitude:0,solveObservation:{enabled:true,snapshots:{first:event,worst:structuredClone(event)}}}]}]};
  const dir=mkdtempSync(join(tmpdir(),'pliego-reference-observed-test-')),input=join(dir,'captured.json');
  const run=value=>{writeFileSync(input,JSON.stringify(value));return runReferenceProbes({kind:'observed',input,allowDirty:true});};
  try{
    const r=run(report);assert.equal(r.cases.length,1);assert.equal(r.capturedRoleOccurrences,2);assert.equal(r.distinctCapturedEvents,1);assert.deepEqual(r.selections[0].roles,['first','worst']);bound(r.cases[0]);
    assert.deepEqual(r.cases[0].runtime.incrementalGradient,c.runtime.incrementalGradient);assert.equal(r.input.sha256,hash(readFileSync(input)));
    const bad=structuredClone(report),a=bad.results[0].trajectories[0].solveObservation.snapshots;
    for(const record of Object.values(a)){
      record.incrementTrial.gradient[0]=1;const raw=Buffer.from(record.incrementTrial.stateFloat64LE.gradient,'base64');raw.writeDoubleLE(1,0);record.incrementTrial.stateFloat64LE.gradient=raw.toString('base64');record.incrementTrial.stateSHA256.gradient=hash(raw);
    }
    assert.throws(()=>run(bad),/full gradient failed bit-exact/);
    const dirty=structuredClone(report);dirty.source.dirty=true;assert.throws(()=>run(dirty),/source-clean/);
    const conflict=structuredClone(report);conflict.results[0].trajectories[0].solveObservation.snapshots.worst.incrementTrial.runtime.delta=1;assert.throws(()=>run(conflict),/inconsistent captured role/);
    const descriptor=structuredClone(report);descriptor.results[0].referenceCoefficients.elements[0].reference.c=.5;assert.throws(()=>run(descriptor),/reference descriptor differs/);
  }finally{rmSync(dir,{recursive:true,force:true});}
  console.log('reference-probes-observed: all retained roles kept, event-only dedup, captured full-gradient/native-reference replay exact; rehashed false gradient, dirty source, duplicate conflict and wrong actual descriptor refused');
});

test('complete source fingerprints and mismatch guard bind producer, tests, kernel and independent oracle dependencies',()=>{
  const source=referenceProbeSource();assert.ok(source.files.length>50);
  for(const suffix of ['src/xpbd/uv-reference.js','bench/membrane-reference-probes.mjs','test/membrane-reference-probes.test.js','bench/membrane-reference-precision.py','bench/membrane-modal-runtime.mjs']){
    const f=source.files.find(f=>f.path.endsWith(suffix));assert.ok(f,suffix);assert.equal(f.sha256,hash(readFileSync(join(root,f.path))));
  }
  assertReferenceProbeSource(source);const changed=structuredClone(source);changed.files[0].sha256='0'.repeat(64);assert.throws(()=>assertReferenceProbeSource(changed),/source changed/);
  if(source.status)assert.throws(()=>runReferenceProbes(),/clean source required/);
  assert.throws(()=>runReferenceProbes({kind:'unknown'}),/supported kind/);assert.throws(()=>runReferenceProbes({kind:'rest',input:'unused'}),/only supported for frozen/);
  console.log('reference-probes-source: nonempty actual kernel/oracle/producer/test SHA inventory and changed source refusal; default dirty-check enforced');
});

test('public output is exclusive0600 outside checkout and refuses existing files, symlinks and malformed CLI',()=>{
  const dir=mkdtempSync(join(tmpdir(),'pliego-reference-probes-test-'));
  try{
    const out=join(dir,'report.json'),value={schema:'test'};writeReferenceProbeReport(out,value);assert.equal(readFileSync(out,'utf8'),JSON.stringify(value)+'\n');assert.equal(statSync(out).mode&0o777,0o600);
    assert.throws(()=>writeReferenceProbeReport(out,{changed:true}),/EEXIST/);assert.equal(readFileSync(out,'utf8'),JSON.stringify(value)+'\n');
    const target=join(dir,'target'),link=join(dir,'link');writeFileSync(target,'retained');symlinkSync(target,link);assert.throws(()=>writeReferenceProbeReport(link,value),/EEXIST/);assert.equal(readFileSync(target,'utf8'),'retained');
    const inside=join(dir,'inside');symlinkSync(root,inside);assert.throws(()=>writeReferenceProbeReport(join(inside,'unused-probe-test.json'),value),/outside checkout/);
    for(const args of [['--kind'],['--kind','bad'],['--unknown'],['--out'],['--kind','rest','--kind','rest']]){
      const run=spawnSync(process.execPath,[producer,...args],{encoding:'utf8'});assert.notEqual(run.status,0);assert.match(run.stderr,/requires a value|supported kind|unknown option|duplicate option/);
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
  console.log('reference-probes-io: exclusive0600 writes preserve existing files/symlink targets; parent-symlink checkout escape and malformed CLI refused');
});


test('UV reference constants retain signed-zero bits and oracle refuses corrupted reference bytes/hash/order',()=>{
  const value=restFixture??runReferenceProbes({kind:'rest',allowDirty:true}).cases[0],python=process.env.PLIEGO_AUDIT_PYTHON||'python3';
  const oracle=fileURLToPath(new URL('../bench/membrane-reference-precision.py',import.meta.url));
  const good=spawnSync(python,[oracle],{input:JSON.stringify(value),encoding:'utf8'});assert.equal(good.status,0,good.stderr);
  const raw=Buffer.from(value.referenceFloat64LE,'base64');assert.ok(Array.from({length:raw.length/8},(_,i)=>raw.readDoubleLE(8*i)).some(v=>Object.is(v,-0)),'actual native signed-zero reference witness');
  for(const mutate of [v=>{v.referenceSHA256='0'.repeat(64);},v=>{v.referenceFloat64LE='AA==';},v=>{v.referenceEncoding.order[0]='other';},
    v=>{const b=Buffer.from(v.referenceFloat64LE,'base64');b.writeDoubleLE(b.readDoubleLE(0)+.1,0);v.referenceFloat64LE=b.toString('base64');v.referenceSHA256=hash(b);}]){
    const bad=structuredClone(value);mutate(bad);const run=spawnSync(python,[oracle],{input:JSON.stringify(bad),encoding:'utf8'});assert.equal(run.status,1);assert.equal(run.stdout,'');assert.ok(JSON.parse(run.stderr).error);
  }
  console.log('reference-probes-reference-bytes: all22 actual native constants per triangle including signed zeros bound; real oracle rejects bad hash/base64/order and rehashed changed nonzero constant');
});
