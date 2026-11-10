// Bounded state-ABI preflight only. No replacement integrator or hidden Newton work.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join, resolve, relative, dirname, basename, sep, isAbsolute } from 'node:path';
import { World } from '../src/index.js';
import { EnergySearch } from '../src/xpbd/energy-search.js';
import { makePatch } from './membrane-patch.mjs';
import { captureModalReference } from './membrane-modal-runtime.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url)),folder=join(root,'docs/research/evidence/membrane-reference-2026-11-10');
const MODE='reference-displacement',ABS='absolute-position',SEARCH='membrane-inertia-increment';
const sha=b=>createHash('sha256').update(b).digest('hex'),finite=n=>typeof n==='number'&&Number.isFinite(n);
const raw=a=>{const b=Buffer.alloc(8*a.length);Array.from(a).forEach((n,i)=>b.writeDoubleLE(n,8*i));return b;};
const same=(a,b)=>a.length===b.length&&Array.from(a).every((n,i)=>Object.is(n,b[i]));
const copy=a=>Array.from(a),max=a=>Math.max(0,...Array.from(a,Math.abs));
const referenceWords=m=>m.elements.flatMap(e=>[...e.reference.u,...e.reference.v,...e.reference.x0,e.reference.c,e.reference.s,...e.Q,e.volume]);
const metadata=a=>({float64LE:raw(a).toString('base64'),sha256:sha(raw(a))});
function decode(encoded,hash,numeric){
  assert.equal(typeof encoded,'string');const b=Buffer.from(encoded,'base64');assert.equal(b.toString('base64'),encoded);assert.equal(b.length,numeric.length*8);assert.equal(sha(b),hash);
  const a=Array.from({length:numeric.length},(_,i)=>b.readDoubleLE(8*i));assert.ok(a.every(finite)&&a.every((n,i)=>n===numeric[i]));return a;
}
export function stateProbeSource(){
  const paths=[],visit=(dir,prefix)=>{for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){if(e.isDirectory())visit(join(dir,e.name),prefix+e.name+'/');else if(e.name.endsWith('.js'))paths.push(prefix+e.name);}};
  visit(join(root,'packages/engine/src'),'packages/engine/src/');
  paths.push(...['bench/membrane-state-probes.mjs','bench/membrane-state-precision.py','bench/membrane-reference-precision.py','bench/membrane-reference-binding.py','bench/membrane-gradient-precision.py','bench/membrane-increment-precision.py','bench/plane-stress-precision.py','bench/membrane-modal-runtime.mjs','bench/membrane-patch.mjs','test/helpers/docbuilder.js'].map(p=>'packages/engine/'+p));
  for(const name of readdirSync(join(root,'packages/engine/test')).filter(n=>n.endsWith('.test.js')&&(n.startsWith('membrane-state-')||n.startsWith('reference-state-')||n==='uv-reference-membrane.test.js'||n==='membrane-model-coordinates.test.js'||n==='increment-search-state.test.js')))paths.push('packages/engine/test/'+name);
  const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
  return {git:git('rev-parse','HEAD'),status:git('status','--porcelain'),files:[...new Set(paths)].sort().map(path=>({path,sha256:sha(readFileSync(join(root,path)))}))};
}
export function assertStateProbeSource(before){assert.deepEqual(stateProbeSource(),before,'source changed during state preflight; discard capture');}

/** Read immutable old captures, preserving actual rounded initial and failed endpoint bytes. */
export function loadStateWitness(){
  const observedPath=join(folder,'observed.json'),reportPath=join(folder,'candidate.json.gz'),observedRaw=readFileSync(observedPath),compressed=readFileSync(reportPath),reportRaw=gunzipSync(compressed);
  assert.equal(sha(observedRaw),'1e892f80e58244130c46d2c3cd4129568c00623e02efc4f444aa5875371a4938');
  assert.equal(sha(reportRaw),'796a80bbe6b47c784eea03a9f3545b24780743f9180002a8c7172879d98307de');
  const probes=JSON.parse(observedRaw),report=JSON.parse(reportRaw),g=report.results[0],row=g.trajectories.find(t=>t.level===8&&t.budget===16&&t.seed===false),record=probes.cases[80],selection=probes.selections[80];
  assert.equal(report.source.dirty,false);assert.equal(report.source.git,'d739165c2f0d72382e2882715c33275c2967fff5');assert.equal(selection.iteration,3);assert.equal(selection.substepsRun,0);assert.equal(record.runtime.decision,'precision-limited-zero-step');
  assert.deepEqual(g.geometry,{cells:2,pattern:'forward',grain:0});assert.equal(row.amplitude,.004);assert.equal(row.forceTolerance,Math.max(1e-7,1e-10*row.fixedForceScale));
  const from=(snapshot,key)=>decode(snapshot.stateFloat64LE[key],snapshot.observation.rawSHA256[key],snapshot.observation[key]);
  const initial=row.snapshots.initial,endpoint=row.snapshots['first-force-failure'];
  const initialX=from(initial,'x'),initialV=from(initial,'v');assert.ok(initialV.every(v=>v===0));
  const expected=Object.fromEntries(['x','xs','xt','v'].map(k=>[k,from(endpoint,k)]));
  assert.ok(same(expected.x,decode(record.stateFloat64LE.x,record.stateSHA256.x,record.x)));assert.ok(same(initialX,decode(record.stateFloat64LE.xt,record.stateSHA256.xt,record.xt)));
  assert.equal(endpoint.observation.residualInfinity,.005058552080299705);assert.equal(endpoint.observation.literalForceGate,false);
  const reference=Buffer.from(record.referenceFloat64LE,'base64');assert.equal(sha(reference),record.referenceSHA256);
  return {geometry:g.geometry,material:g.material,initialX,initialV,expected,h:row.h,budget:row.budget,previousPoseStart:row.seed,forceScale:row.fixedForceScale,forceTolerance:row.forceTolerance,
    mass:record.mass,referenceBytes:reference,expectedPublicResidual:endpoint.observation.residualInfinity,
    provenance:{sourceGit:report.source.git,report:{file:'candidate.json.gz',compressedSHA256:sha(compressed),originalSHA256:sha(reportRaw),originalBytes:reportRaw.length},probes:{file:'observed.json',sha256:sha(observedRaw),bytes:observedRaw.length},caseIndex:80,selection,firstFailedStep:1},
    assertInputsUnchanged(){assert.equal(sha(readFileSync(observedPath)),sha(observedRaw));assert.equal(sha(readFileSync(reportPath)),sha(compressed));}};
}
export function createStateProbeWorld(patch,fixture,coordinates=ABS){
  assert.ok([ABS,MODE].includes(coordinates));const substeps=Math.round(1/(60*fixture.h));assert.ok(Number.isSafeInteger(substeps)&&substeps>0);
  const w=new World(patch.doc,{...patch.options,substeps,newtonIterations:fixture.budget,previousPoseStart:fixture.previousPoseStart,damping:0,bendDamping:0,gravity:false,ground:false,contact:false,plasticity:false,lineSearch:true,lineSearchArithmetic:SEARCH,membraneArithmetic:'double-double',membraneReference:'uv-displacement',...(coordinates===MODE?{stateCoordinates:MODE}:{})});
  assert.equal(w.dt,fixture.h);assert.ok(same(w.mass,fixture.mass));assert.ok(raw(referenceWords(w.orthotropicMembrane)).equals(fixture.referenceBytes));
  const xs=w.xs.slice(),xt=w.xt.slice();
  if(coordinates===MODE)w.setInitialReferencePose(fixture.initialX,fixture.initialV);else{w.x.set(fixture.initialX);w.v.set(fixture.initialV);}
  assert.ok(same(w.x,fixture.initialX)&&same(w.v,fixture.initialV)&&same(w.xs,xs)&&same(w.xt,xt),'initial physical state or constructor buffers changed');
  assert.equal(w.framesRun,0);assert.equal(w.substepsRun,0);assert.equal(w.time,0);
  return w;
}
function snapshotHash(snapshot){
  const encode=v=>ArrayBuffer.isView(v)?{type:v.constructor.name,bytes:Buffer.from(v.buffer,v.byteOffset,v.byteLength).toString('base64')}:Array.isArray(v)?v.map(encode):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,encode(v[k])])):v;
  return sha(JSON.stringify(encode(snapshot)));
}
function publicResidual(w,tolerance){
  const model=Object.create(w.orthotropicMembrane);model.work=Object.fromEntries(Object.entries(w.orthotropicMembrane.work).map(([k,v])=>[k,ArrayBuffer.isView(v)?v.slice():v]));model.block=w.orthotropicMembrane.block.slice();
  const elasticGradient=new Float64Array(w.x.length);model.addGradient(w.x,elasticGradient,ABS);
  const inertiaGradient=Float64Array.from(w.x,(x,i)=>w.mass[Math.floor(i/3)]*(1/(w.dt*w.dt))*(x-w.xt[i])),residual=Float64Array.from(elasticGradient,(g,i)=>g+inertiaGradient[i]);
  return {energy:model.energy(w.x,ABS),elasticGradient:copy(elasticGradient),inertiaGradient:copy(inertiaGradient),residual:copy(residual),residualInfinity:max(residual),literalForceGate:max(residual)<=tolerance};
}
function arrays(value){return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,ArrayBuffer.isView(v)?copy(v):v]));}
function bindCase(c){
  const fields={x:c.x,xt:c.xt,u:c.state.u,ut:c.state.ut,mass:c.mass,h:[c.h],initialX:c.state.initialization.x,initialU:c.state.initialization.u,
    us:c.state.us,v:c.state.v,xs:c.xs,initialV:c.state.initialization.v,x0:c.state.x0};
  for(const prefix of ['authoritative','public'])for(const k of ['elasticGradient','inertiaGradient','residual'])fields[prefix+k[0].toUpperCase()+k.slice(1)]=c.runtime[prefix][k];
  c.stateFloat64LE={};c.stateSHA256={};for(const [k,a]of Object.entries(fields)){assert.ok(a.every(finite),k);c.stateFloat64LE[k]=raw(a).toString('base64');c.stateSHA256[k]=sha(raw(a));}return c;
}
function authorityCase(w,patch,fixture,label){
  const a=w.authoritativeState(),residuals=w.authoritativeResiduals(fixture.forceTolerance);assert.equal(a.targetValid,true);assert.equal(residuals.targetValid,true);
  assert.ok(same(a.x,w.x)&&same(a.xt,w.xt)&&same(a.mass,w.mass)&&same(a.x0,w.X0));assert.ok(raw(a.coefficients).equals(fixture.referenceBytes));
  const reference=raw(a.coefficients);
  return bindCase({fixture:label,vertices:patch.vertices,triangles:patch.triangles,material:patch.material,grain:patch.info.grain,
    referenceCoefficients:captureModalReference({world:w}),referenceFloat64LE:reference.toString('base64'),referenceSHA256:sha(reference),
    referenceEncoding:{version:1,order:['u[3]','v[3]','x0[9]','c','s','Q[4]','volume'],floatsPerElement:22,nativeElementOrder:true},
    x:copy(a.x),xs:copy(a.xs),xt:copy(a.xt),mass:copy(a.mass),h:a.h,
    state:{...a.identity,u:copy(a.u),us:copy(a.us),ut:copy(a.ut),v:copy(a.v),x0:copy(a.x0),targetValid:a.targetValid,initialization:{x:copy(a.initialX),u:copy(a.initialU),v:copy(a.initialV)}},
    runtime:{forceTolerance:fixture.forceTolerance,fixedForceScale:fixture.forceScale,authoritative:arrays(residuals.authoritative),public:arrays(residuals.public)},
    execution:{time:w.time,framesRun:w.framesRun,substepsRun:w.substepsRun,factorCount:w.factorCount,pcgIterations:w.pcgIterations},
    scope:'one actual public substep; authoritative and projected public native force gates are distinct, same frozen tolerance; independent oracle required; no24-matrix/time/material/booklet acceptance'});
}
/** Transparent small observer of realized u proposals/decisions. No old modal observer is changed. */
function observeSearch(w){
  const search=w.energySearch,originalBegin=search.begin,originalFinish=search.finish,beginDescriptor=Object.getOwnPropertyDescriptor(search,'begin'),finishDescriptor=Object.getOwnPropertyDescriptor(search,'finish'),events=[];let before=null;
  assert.equal(originalBegin,EnergySearch.prototype.begin);assert.equal(originalFinish,EnergySearch.prototype.finish);
  search.begin=function(world){const result=originalBegin.call(this,world);before={u:world._u.slice(),x:world.x.slice(),ut:world._ut.slice(),us:world._us.slice()};return result;};
  search.finish=function(world,g){
    assert.ok(before);const candidate=world._u.slice(),candidatePublicView=world.x.slice(),gradient=g.slice(),result=originalFinish.call(this,world,g),after=world._u.slice(),publicAfter=world.x.slice(),last=structuredClone(this.increment.last);
    assert.ok(publicAfter.every((x,i)=>Object.is(world.X0[i]+after[i],x)),'finish did not publish actual projection');
    const fields={beforeU:before.u,beforeX:before.x,candidateU:candidate,candidatePublicBeforeFinish:candidatePublicView,afterU:after,afterX:publicAfter,ut:before.ut,us:before.us,gradient};
    events.push({iteration:events.length+1,last,nonzeroAuthoritativeUpdate:after.some((u,i)=>u!==before.u[i]),publicPositionBytesUnchanged:same(before.x,publicAfter),
      fields:Object.fromEntries(Object.entries(fields).map(([k,a])=>[k,copy(a)])),float64LE:Object.fromEntries(Object.entries(fields).map(([k,a])=>[k,raw(a).toString('base64')])),SHA256:Object.fromEntries(Object.entries(fields).map(([k,a])=>[k,sha(raw(a))])),
      scope:'actual mid-Newton buffers; candidatePublicBeforeFinish is a raw view, not an asserted candidate projection; before/after are actual projected boundaries of search, not public substep snapshots'});before=null;return result;
  };
  return {events,detach(){if(beginDescriptor)Object.defineProperty(search,'begin',beginDescriptor);else delete search.begin;if(finishDescriptor)Object.defineProperty(search,'finish',finishDescriptor);else delete search.finish;}};
}
export function evaluateStateFixture(fixture,label='witness'){
  const patch=makePatch({...fixture.geometry,membraneModel:'orthotropic-stvk',membraneNu12:fixture.material.nu12});assert.deepEqual(patch.material,fixture.material);
  const old=createStateProbeWorld(patch,fixture,ABS),native=createStateProbeWorld(patch,fixture,MODE),plain=createStateProbeWorld(patch,fixture,MODE);
  const initial=native.authoritativeState();assert.equal(initial.targetValid,false);assert.ok(same(initial.x,old.x)&&same(initial.xs,old.xs)&&same(initial.xt,old.xt)&&same(initial.v,old.v));
  const snapshot=native.snapshot(),observer=observeSearch(native);let nativeReturned;
  try{nativeReturned=native.step(native.dt);}finally{observer.detach();}
  assert.equal(nativeReturned,1);assert.equal(old.step(old.dt),1);assert.equal(plain.step(plain.dt),1);
  assert.equal(native.substepsRun,1);assert.equal(native.framesRun,1);assert.equal(native.time,fixture.h);
  assert.deepEqual(native.snapshot(),plain.snapshot(),'observer changed actual new-state replay');
  const actual=authorityCase(native,patch,fixture,label),end=native.snapshot(),endpointHash=snapshotHash(end);
  native.restore(snapshot);assert.equal(native.step(native.dt),1);assert.deepEqual(native.snapshot(),end,'same-mode boundary snapshot replay differs');
  const baseline={stateCoordinates:ABS,x:copy(old.x),xs:copy(old.xs),xt:copy(old.xt),v:copy(old.v),public:publicResidual(old,fixture.forceTolerance),raw:Object.fromEntries(['x','xs','xt','v'].map(k=>[k,metadata(old[k])]))};
  if(fixture.expected){for(const k of ['x','xs','xt','v'])assert.ok(same(old[k],fixture.expected[k]),'historical baseline endpoint changed '+k);assert.equal(baseline.public.residualInfinity,fixture.expectedPublicResidual);assert.equal(baseline.public.literalForceGate,false);}
  const separation=observer.events.filter(e=>e.last.decision==='accepted'&&e.nonzeroAuthoritativeUpdate&&e.publicPositionBytesUnchanged);
  return {case:actual,baseline,events:observer.events,initial:{identity:initial.identity,targetValid:false,raw:Object.fromEntries(['u','us','ut','x','xs','xt','v','initialX','initialU','initialV'].map(k=>[k,metadata(initial[k])]))},
    checks:{observerParity:true,boundarySnapshotReplay:true,completeNewtonEvents:observer.events.length===fixture.budget,actualAcceptedSubPublicUpdates:separation.length,endpointSnapshotTypedBytesSHA256:endpointHash,snapshotHashScope:'all typed-array bytes retained; scalar JSON semantics; deepStrictEqual separately verifies replay'},
    outcomes:{authoritativeConverged:actual.runtime.authoritative.converged,publicLiteralForceGate:actual.runtime.public.literalForceGate,baselineLiteralForceGate:baseline.public.literalForceGate}};
}
export function runStateProbes(){
  const before=stateProbeSource();assert.equal(before.status,'','clean source required; no dirty capture override for this preflight');
  const witness=loadStateWitness();
  // Construct the control directly from the SAME actual native reference grid.
  const controlPatch=makePatch({...witness.geometry,membraneModel:'orthotropic-stvk',membraneNu12:witness.material.nu12});
  const controlInitial=copy(controlPatch.world.X0);for(let i=0;i<controlInitial.length;i+=3)controlInitial[i]+=2**-10;
  const control={...witness,initialX:controlInitial,initialV:Array(controlInitial.length).fill(0),expected:undefined,expectedPublicResidual:undefined};
  const results=[evaluateStateFixture(witness,'frozen-case80-first-substep'),evaluateStateFixture(control,'exact-dyadic-rigid-translation')];
  witness.assertInputsUnchanged();assertStateProbeSource(before);
  return {schema:'pliego-membrane-state-probes/1',source:{...before,status:undefined,dirty:false},runtime:{node:process.version,arch:process.arch,platform:process.platform},input:witness.provenance,
    protocol:{stage:'bounded-one-substep-preflight',representedEnergyErrorLimitNJ:1e-12,representedGradientComponentErrorLimitMicroN:1e-9,precisionEquality:'whole parsed80/100 except only cases[].decimalDigits',fixtures:2,actualSubstepsPerRun:1,newtonIterations:witness.budget,h:witness.h,forceTolerance:witness.forceTolerance,fixedForceScale:witness.forceScale,
      initialization:'actual archived initial x/zero-v, exact one-word conversion with zero low and projection bit check; constructor xs/xt zero buffers retained targetValid:false',
      control:'same native material/reference/mass/h/tau; exact +2^-10mm rigid X translation of X0; diagnostic force scale inherited unchanged from witness, no modal-time claim',
      acceptance:'authoritative/public gates separate; no old public field repurposed, no force tolerance waiver, no24-trajectory/time/material/booklet/device acceptance'},
    cases:results.map(r=>r.case),results:results.map(({case:_case,...r})=>r),
    gates:{sourceClean:true,oldWitnessExactReplay:true,allObserverAndSnapshotParity:results.every(r=>r.checks.observerParity&&r.checks.boundarySnapshotReplay&&r.checks.completeNewtonEvents),
      actualAcceptedSubPublicUpdate:results[0].checks.actualAcceptedSubPublicUpdates>0,authoritativeWitness:results[0].outcomes.authoritativeConverged,publicWitness:results[0].outcomes.publicLiteralForceGate,exactControlBothGates:results[1].outcomes.authoritativeConverged&&results[1].outcomes.publicLiteralForceGate,
      wholeTimeAccuracyAcceptance:false,physicalStockCalibration:'not measured',newModelBooklet:'not measured',interactionPerformance:'not measured'}};
}
export function writeStateProbeReport(output,report){
  const target=resolve(output),actual=join(realpathSync(dirname(target)),basename(target)),location=relative(realpathSync(root),actual);assert.ok(location&&(location.startsWith('..'+sep)||isAbsolute(location)),'output must be outside checkout');
  writeFileSync(actual,JSON.stringify(report)+'\n',{flag:'wx',mode:0o600});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);assert.ok(args.length===0||args.length===2&&args[0]==='--out'&&args[1]&&!args[1].startsWith('--'),'only --out fresh-path is supported; no dirty capture override');
  const report=runStateProbes();if(args.length)writeStateProbeReport(args[1],report);else process.stdout.write(JSON.stringify(report)+'\n');
  console.error('membrane-state-probes: two bounded fixtures, one actual substep per run; native/public gates retained separately; no fullmatrix/time acceptance');
}
