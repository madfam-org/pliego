// Explicit represented-reference-law probes: actual searches or fixed poses; no step/solve.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, resolve, relative, sep, isAbsolute, dirname, basename } from 'node:path';
import { makePatch } from './membrane-patch.mjs';
import { captureModalReference } from './membrane-modal-runtime.mjs';
import { World } from '../src/index.js';
import { gradient } from '../src/xpbd/implicit.js';

const root=fileURLToPath(new URL('../../../',import.meta.url)),SEARCH='membrane-inertia-increment',DD='double-double',UV='uv-displacement',OLD='material-coefficients';
const defaultInput=join(root,'docs/research/evidence/membrane-increment-2026-11-10/captured-trials-input.json');
const historicalInput=join(root,'docs/research/evidence/membrane-double-double-2026-11-10/gradient-probes.json');
const hash=value=>createHash('sha256').update(value).digest('hex'),finite=value=>typeof value==='number'&&Number.isFinite(value);
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const bytes=values=>{const b=Buffer.alloc(8*values.length);values.forEach((v,i)=>b.writeDoubleLE(v,8*i));return b;};

export function referenceProbeSource(){
  const names=[];
  const visit=(dir,prefix)=>{for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    if(e.isDirectory())visit(join(dir,e.name),prefix+e.name+'/');else if(e.name.endsWith('.js'))names.push(prefix+e.name);
  }};
  visit(join(root,'packages/engine/src'),'packages/engine/src/');
  names.push(...['bench/membrane-reference-probes.mjs','test/membrane-reference-probes.test.js','bench/membrane-reference-precision.py',
    'bench/membrane-reference-binding.py','bench/membrane-gradient-precision.py','bench/membrane-increment-precision.py','bench/plane-stress-precision.py',
    'bench/plane-stress-reference.py','bench/membrane-modal-runtime.mjs','bench/membrane-patch.mjs','test/helpers/docbuilder.js'].map(p=>'packages/engine/'+p));
  for(const name of readdirSync(join(root,'packages/engine/test')).filter(p=>(p.startsWith('membrane-reference-')||['uv-reference-membrane.test.js','membrane-gradient-precision.test.js','membrane-increment-precision.test.js'].includes(p))&&p.endsWith('.test.js')))names.push('packages/engine/test/'+name);
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  return {git:git('rev-parse','HEAD'),status:git('status','--porcelain'),files:[...new Set(names)].sort().map(path=>({path,sha256:hash(readFileSync(join(root,path)))}))};
}
export function assertReferenceProbeSource(start){assert.deepEqual(referenceProbeSource(),start,'source changed during reference probes; discard output');}
function bind(value){
  const inputs={x:value.x,gradient:value.runtime.gradient};
  for(const key of ['after','direction','inertiaGradient','xt','mass'])if(value[key]!==undefined)inputs[key]=value[key];
  if(value.h!==undefined)inputs.h=[value.h];
  if(value.runtime.incrementalGradient)inputs.incrementalGradient=value.runtime.incrementalGradient;
  value.stateFloat64LE={};value.stateSHA256={};
  for(const [key,a]of Object.entries(inputs)){
    assert.ok(a.every(finite),'nonfinite captured '+key);const raw=bytes(a);
    value.stateFloat64LE[key]=raw.toString('base64');value.stateSHA256[key]=hash(raw);
  }
  return value;
}
function decode(record,key,count){
  const numeric=key==='h'?[record.h]:record[key],encoded=record.stateFloat64LE?.[key];
  assert.ok(Array.isArray(numeric)&&numeric.length===count&&numeric.every(finite),'finite archived '+key+' required');
  assert.equal(typeof encoded,'string','lossless archived '+key+' required');
  const raw=Buffer.from(encoded,'base64');assert.equal(raw.toString('base64'),encoded,'canonical base64 required');
  assert.equal(raw.length,8*count);assert.equal(hash(raw),record.stateSHA256?.[key]);
  const values=Array.from({length:count},(_,i)=>raw.readDoubleLE(8*i));assert.ok(values.every(finite)&&equal(values,numeric),'archived LE/numeric mismatch');return values;
}
function world(patch,substeps,reference){
  const w=new World(patch.doc,{...patch.options,damping:0,bendDamping:0,substeps,lineSearchArithmetic:SEARCH,membraneArithmetic:DD,...(reference===UV?{membraneReference:UV}:{})});
  assert.equal(w.opts.membraneArithmetic,DD);assert.equal(w.opts.lineSearchArithmetic,SEARCH);
  assert.equal(w.opts.membraneReference??OLD,reference);
  assert.ok(!w.fixed.some(Boolean)&&!w.terms.active.some(Boolean)&&!w.driveOn.some(Boolean)&&!w.contact&&!w.opts.gravity&&!w.opts.ground&&!w.opts.contact&&!w.opts.plasticity);
  assert.equal(w.opts.damping,0);assert.equal(w.bendDamp,0);assert.equal(w.drivers.wind,0);
  return w;
}
function unstepped(w){assert.equal(w.time,0);assert.equal(w.substepsRun,0);assert.equal(w.framesRun,0);assert.equal(w.factorCount,0);}
function evaluated(w,patch){
  const selected=w.orthotropicMembrane,elastic=new Float64Array(w.x.length),direct=new Float64Array(w.x.length);
  gradient(w,w.x,elastic);selected.addGradient(w.x,direct);assert.ok(equal(elastic,direct),'non-membrane gradient entered probe');
  const energy=selected.energy(w.x);assert.ok(finite(energy)&&selected.diagnostics(w.x).finite,'invalid fixed-pose energy/metric');
  const inertia=Array.from(w.x,(x,i)=>w.mass[Math.floor(i/3)]*(1/(w.dt*w.dt))*(x-w.xt[i]));
  const incremental=Array.from(elastic,(g,i)=>g+inertia[i]);
  const value={vertices:patch.vertices,triangles:patch.triangles,material:patch.material,grain:patch.info.grain,
    referenceCoefficients:captureModalReference({world:w}),x:Array.from(w.x),xt:Array.from(w.xt),mass:Array.from(w.mass),h:w.dt,inertiaGradient:inertia,
    runtime:{energy,gradient:Array.from(elastic),incrementalGradient:incremental,arithmetic:DD,membraneReference:w.opts.membraneReference??OLD,
      arithmeticIdentity:structuredClone(selected.configuration.arithmetic),...(selected.configuration.reference?{referenceIdentity:structuredClone(selected.configuration.reference)}:{}),
      lawConfigurationSHA256:hash(w.orthotropicMembraneSignature)},
    capture:{oracle:w.opts.membraneReference===UV?'membrane-reference-precision.py':'membrane-gradient-precision.py',
      evaluation:'actual selected elastic energy/gradient; native binary64 M*(1/(h*h))*(x-xt), then rounded elastic+inertia; no World step, Newton or factorization'}};
  if(w.opts.membraneReference===UV){
    const native=selected.elements.flatMap(e=>[...e.reference.u,...e.reference.v,...e.reference.x0,e.reference.c,e.reference.s,...e.Q,e.volume]);
    const raw=bytes(native);value.referenceFloat64LE=raw.toString('base64');value.referenceSHA256=hash(raw);
    value.referenceEncoding={version:1,order:['u[3]','v[3]','x0[9]','c','s','Q[4]','volume'],floatsPerElement:22,nativeElementOrder:true};
  }
  return value;
}
function rest(){
  const cases=[];
  for(const grain of [0,31,45,90]){
    const patch=makePatch({cells:1,grain,membraneModel:'orthotropic-stvk',membraneNu12:.293}),w=world(patch,1000,UV),before=w.X0.slice();
    for(const index of [0,2])for(const direction of [-1,1])for(const magnitude of [2**-40,2**-50]){
      w.x.set(before);w.xt.set(before);w.xs.set(before);w.v.fill(0);
      const value=evaluated(w,patch),g=Float64Array.from(value.runtime.incrementalGradient);
      w.energySearch.begin(w);w.x[index]+=direction*magnitude;const candidate=w.x.slice();w.energySearch.finish(w,g);
      const last=structuredClone(w.energySearch.increment.last);
      assert.ok(last&&Number.isInteger(last.trials)&&last.trials>=1&&last.trials<=21&&last.alpha===2**-(last.trials-1),'actual trial unavailable/inconsistent');
      const after=last.trials===1?candidate:Float64Array.from(before,(x,i)=>x+last.alpha*(candidate[i]-x));
      assert.deepEqual(w.x,last.decision==='accepted'?after:before,'actual search final state differs from decision');
      value.after=Array.from(after);value.direction=value.after.map((x,i)=>x-value.x[i]);
      Object.assign(value.runtime,last,{c1:1e-4});
      value.probe={grain,index,direction,magnitude,decision:last.decision};
      const candidateBytes=bytes(Array.from(candidate)),finalBytes=bytes(Array.from(w.x));
      value.search={candidate:Array.from(candidate),finalWorld:Array.from(w.x),candidateFloat64LE:candidateBytes.toString('base64'),finalWorldFloat64LE:finalBytes.toString('base64'),
        candidateSHA256:hash(candidateBytes),finalWorldSHA256:hash(finalBytes),
        endpoint:'x is the actual before pose; after is the actual last evaluated trial, distinct from restored finalWorld on rejection'};
      cases.push(bind(value));unstepped(w);
    }
  }
  assert.equal(cases.length,32);return cases;
}

/** One genuine archived pair for focused tests; full producer below requires all85. */
export function evaluateFrozenReferencePose(record,inputIndex=0,historicalDD){
  assert.equal(record.vertices.length,9);assert.equal(record.grain,0);
  const patch=makePatch({cells:2,pattern:'forward',grain:0,membraneModel:'orthotropic-stvk',membraneNu12:record.material.nu12});
  assert.deepEqual(patch.vertices,record.vertices);assert.deepEqual(patch.triangles,record.triangles);assert.deepEqual(patch.material,record.material);
  const n=3*patch.vertices.length,before=decode(record,'before',n),after=decode(record,'after',n),xt=decode(record,'xt',n),mass=decode(record,'mass',n/3),h=decode(record,'h',1)[0];
  decode(record,'gradient',n);const substeps=Math.round(1/(60*h));assert.ok(Number.isSafeInteger(substeps)&&substeps>0);
  const cases=[];
  for(const reference of [OLD,UV]){
    const w=world(patch,substeps,reference);assert.equal(w.dt,h);assert.ok(bytes(Array.from(w.mass)).equals(bytes(mass)),'native mass changed');
    assert.ok(equal(Array.from(w.mesh.uv),record.vertices.flat()));assert.deepEqual(Array.from(w.mesh.tris),record.referenceCoefficients.triangles.flat());
    w.orthotropicMembrane.elements.forEach((e,t)=>{for(const key of ['alpha','beta','Q'])assert.ok(equal(Array.from(e[key]),record.referenceCoefficients.elements[t][key]),'unchanged legacy coefficient differs');assert.equal(e.volume,record.referenceCoefficients.elements[t].volume);});
    w.x.set(before);w.xt.set(xt);w.xs.set(before);w.v.fill(0);
    const value=evaluated(w,patch);value.direction=after.map((x,i)=>x-before[i]);
    Object.assign(value.capture,{inputIndex,cells:2,pattern:'forward',originalRuntimeDecision:record.runtime.decision});
    if(reference===OLD&&historicalDD){
      assert.equal(value.runtime.energy,historicalDD.runtime.energy,'historical DD energy replay differs');
      for(const key of ['x','xt','mass','h','direction','inertiaGradient','gradient','incrementalGradient']){
        const raw=Buffer.from(historicalDD.stateFloat64LE[key],'base64');assert.equal(hash(raw),historicalDD.stateSHA256[key]);
        const actual=key==='h'?[value.h]:['gradient','incrementalGradient'].includes(key)?value.runtime[key]:value[key];
        assert.ok(bytes(actual).equals(raw),'historical DD '+key+' replay differs');
      }
    }
    cases.push(bind(value));unstepped(w);
  }
  for(const key of ['x','xt','mass','h','direction','inertiaGradient'])assert.deepEqual(cases[0][key],cases[1][key],'fixed physical pair changed '+key);
  return cases;
}

/** Re-evaluate an existing observed before state; never reconstruct a solve. */
export function evaluateObservedReferenceTrial(geometry,trial){
  const patch=makePatch({...geometry.geometry,membraneModel:'orthotropic-stvk',membraneNu12:geometry.material.nu12});
  assert.deepEqual(patch.vertices,geometry.vertices);assert.deepEqual(patch.triangles,geometry.triangles);assert.deepEqual(patch.material,geometry.material);
  const n=3*patch.vertices.length,before=decode(trial,'before',n),after=decode(trial,'after',n),xt=decode(trial,'xt',n),mass=decode(trial,'mass',n/3),h=decode(trial,'h',1)[0],full=decode(trial,'gradient',n);
  const substeps=Math.round(1/(60*h));assert.ok(Number.isSafeInteger(substeps)&&substeps>0);
  const w=world(patch,substeps,UV);assert.equal(w.dt,h);assert.ok(bytes(Array.from(w.mass)).equals(bytes(mass)),'observed native mass differs');
  const actualReference=captureModalReference({world:w});
  assert.deepEqual(JSON.parse(JSON.stringify(actualReference)),geometry.referenceCoefficients,'observed actual UV reference descriptor differs');
  w.x.set(before);w.xt.set(xt);w.xs.set(before);w.v.fill(0);
  const value=evaluated(w,patch);assert.ok(bytes(value.runtime.incrementalGradient).equals(bytes(full)),'actual observed full gradient failed bit-exact fixed-pose replay');
  value.after=after;value.direction=after.map((x,i)=>x-before[i]);
  for(const key of Object.keys(value.runtime))assert.ok(!Object.hasOwn(trial.runtime,key),'trial metadata collides with measured runtime '+key);
  Object.assign(value.runtime,structuredClone(trial.runtime));
  Object.assign(value.capture,{evaluation:'fixed-pose re-evaluation of an existing retained actual before state; full solver gradient replays bit-exact against original LE capture; no timestep, Newton solve or unsaved endpoint inference',originalTrialStateSHA256:structuredClone(trial.stateSHA256)});
  unstepped(w);return bind(value);
}
function observed(report){
  assert.equal(report.schema,'pliego-membrane-modal-audit/0.1','supported modal report required');assert.equal(report.source?.dirty,false,'source-clean captured report required');
  assert.match(report.source.git,/^[a-f0-9]{40}$/);assert.equal(report.gates?.sourceClean,true);assert.equal(report.gates?.completeDeclaredMatrix,true);assert.equal(report.gates?.measurementValid,true);
  assert.equal(report.protocol?.membraneReference,UV);assert.equal(report.protocol?.membraneArithmetic,DD);assert.equal(report.protocol?.lineSearchArithmetic,SEARCH);assert.equal(report.protocol?.instrument,true);
  assert.ok(Array.isArray(report.results)&&report.results.length>0,'nonempty actual report required');
  const cases=[],selections=[];let roles=0;
  for(const [geometryIndex,geometry]of report.results.entries()){
    assert.ok(Array.isArray(geometry.trajectories)&&geometry.trajectories.length>0,'actual trajectories required');
    for(const [trajectoryIndex,t]of geometry.trajectories.entries()){
      assert.equal(t.solveObservation?.enabled,true);
      assert.ok(Number.isSafeInteger(t.level)&&t.level>0&&Number.isSafeInteger(t.budget)&&t.budget>0&&typeof t.seed==='boolean'&&finite(t.amplitude)&&t.amplitude>=0,'complete trajectory selection metadata required');
      const seen=new Map();
      for(const [role,record]of Object.entries(t.solveObservation.snapshots)){
        if(record.incrementTrial===undefined)continue;
        assert.equal(record.valid,true,'only valid actual solve captures supported');assert.ok(Number.isSafeInteger(record.substepsRun)&&record.substepsRun>=0,'actual substep selection required');assert.ok(Number.isSafeInteger(record.iteration)&&record.iteration>0,'actual event iteration required');roles++;
        const trial=record.incrementTrial,previous=seen.get(record.iteration);
        if(previous){assert.deepEqual(trial,previous.trial,'same event has inconsistent captured role data');selections[previous.index].roles.push(role);continue;}
        const index=cases.length;seen.set(record.iteration,{index,trial});cases.push(evaluateObservedReferenceTrial(geometry,trial));
        selections.push({geometryIndex,trajectoryIndex,...geometry.geometry,level:t.level,budget:t.budget,seed:t.seed,amplitude:t.amplitude,
          iteration:record.iteration,substepsRun:record.substepsRun,roles:[role],runtimeDecision:trial.runtime.decision});
      }
    }
  }
  assert.ok(cases.length>0,'no retained actual incrementTrial captures');
  return {cases,selections,roles};
}

export function runReferenceProbes({kind='rest',input,allowDirty=false,...unknown}={}){
  assert.equal(Object.keys(unknown).length,0,'unknown producer option');assert.ok(['rest','frozen','observed'].includes(kind),'supported kind required');
  assert.ok(kind!=='rest'||input===undefined,'--input is only supported for frozen/observed');assert.ok(kind!=='observed'||input,'--kind observed requires --input');
  const start=referenceProbeSource();assert.ok(allowDirty||!start.status,'clean source required; --allow-dirty is development only');
  let cases,inputProof,selections,roleOccurrences;
  if(kind==='rest')cases=rest();
  else if(kind==='observed'){
    const raw=readFileSync(input),report=JSON.parse(raw),selection=observed(report);({cases,selections,roles:roleOccurrences}=selection);
    assert.ok(readFileSync(input).equals(raw),'captured modal report changed during evaluation');
    inputProof={label:'ALL retained actual UV incrementTrial snapshots',sha256:hash(raw),bytes:raw.length,sourceGit:report.source.git};
  }else{
    const path=input??defaultInput,raw=readFileSync(path),archive=JSON.parse(raw),historicalRaw=readFileSync(historicalInput),history=JSON.parse(historicalRaw);
    assert.ok(Array.isArray(archive.cases)&&archive.cases.length===85,'all85 declared archived poses required');
    assert.equal(history.cases.length,170);const controls=history.cases.filter(c=>c.runtime.arithmetic===DD);assert.equal(controls.length,85);
    cases=archive.cases.flatMap((record,i)=>{const old=controls.find(c=>c.capture.inputIndex===i);assert.ok(old,'historical DD pair missing');return evaluateFrozenReferencePose(record,i,old);});
    assert.equal(cases.length,170);assert.ok(readFileSync(path).equals(raw),'archived input changed');assert.ok(readFileSync(historicalInput).equals(historicalRaw),'historical control changed');
    inputProof={label:'immutable85-before-poses with oldDD170-case replay control',sha256:hash(raw),bytes:raw.length,historicalGradientSHA256:hash(historicalRaw),historicalGradientBytes:historicalRaw.length};
  }
  assertReferenceProbeSource(start);
  return {schema:'pliego-membrane-reference-probes/1',source:{...start,status:undefined,dirty:!!start.status},runtime:{node:process.version,arch:process.arch,platform:process.platform},
    ...(inputProof?{input:inputProof}:{}),...(selections?{selections,selectionPolicy:'ALL retained full incrementTrial roles; deduplicate only by geometry/trajectory+iteration; no unretained event inference',capturedRoleOccurrences:roleOccurrences,distinctCapturedEvents:cases.length}:{}),protocol:{kind,membraneArithmetic:DD,lineSearchArithmetic:SEARCH,membraneReferences:kind==='frozen'?[OLD,UV]:[UV],
      ...(kind==='rest'?{grains:[0,31,45,90],indices:[0,2],directions:[-1,1],magnitudesMm:[2**-40,2**-50],substeps:1000}:kind==='frozen'?{poses:85}:{observedEvents:cases.length}),
      oracleDispatch:'explicit per-case capture.oracle: oldDD uses unchanged gradient oracle; UV uses reference oracle; never reinterpret legacy polynomial',
      scope:'bounded fixed-pose native EnergySearch or paired evaluation only; no World timestep, Newton solve, force/time/material/booklet/device/performance acceptance'},cases};
}
export function writeReferenceProbeReport(output,report){
  const target=resolve(output),actual=join(realpathSync(dirname(target)),basename(target)),location=relative(realpathSync(root),actual);
  assert.ok(location&&(location.startsWith('..'+sep)||isAbsolute(location)),'--out must be outside checkout');
  writeFileSync(actual,JSON.stringify(report)+'\n',{flag:'wx',mode:0o600});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),allowed=['--kind','--input','--out'],values={};let allowDirty=false;
  for(let i=0;i<args.length;i++){
    const key=args[i];if(key==='--allow-dirty'){assert.equal(allowDirty,false,'duplicate flag');allowDirty=true;continue;}
    assert.ok(allowed.includes(key),'unknown option');assert.equal(values[key],undefined,'duplicate option');assert.ok(args[i+1]&&!args[i+1].startsWith('--'),'option requires a value');values[key]=args[++i];
  }
  const report=runReferenceProbes({kind:values['--kind']??'rest',input:values['--input'],allowDirty});
  if(values['--out'])writeReferenceProbeReport(values['--out'],report);else process.stdout.write(JSON.stringify(report)+'\n');
  console.error('reference-probes: '+report.protocol.kind+' '+report.cases.length+' actual fixed-pose cases; source/input guard exact; '+(report.source.dirty?'DEVELOPMENT dirty source':'clean source')+'; no time/force acceptance');
}
