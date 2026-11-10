import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { makePatch } from '../bench/membrane-patch.mjs';
import { createModalWorld, observeModalWorld, runModalContext, captureModalReference } from '../bench/membrane-modal-runtime.mjs';
import { attachModalSolveObserver } from '../bench/membrane-modal-solve-observer.mjs';
import { validateObservation } from '../bench/membrane-modal-validation.mjs';
import { runModalAudit } from '../bench/membrane-modal-audit.mjs';

const SEARCH='membrane-inertia-increment',DD='double-double',UV='uv-displacement',OLD='material-coefficients';
const arithmetic={name:DD,version:1,productExponentLimit:450,derivative:'coherent-difference',displacement:'two-diff'};
const reference={mode:UV,version:1,metric:'actual-X0',strain:'uv-covariant',rotation:'tensor-before-voigt'};
const bench=fileURLToPath(new URL('../bench/',import.meta.url));
function fixture(membraneReference,membraneArithmetic=DD,lineSearchArithmetic=SEARCH){
  const patch=makePatch({cells:2,pattern:'forward',grain:45,membraneModel:'orthotropic-stvk',membraneNu12:.293});
  return createModalWorld(patch,{phi:patch.vertices.map(([u])=>[(u-20)/20,0]),omega:1e5,amplitude:.004,
    substeps:41667,newtonIterations:4,lineSearchArithmetic,membraneArithmetic,...(membraneReference===undefined?{}:{membraneReference})});
}
function parity(a,b){
  for(const key of ['x','xs','xt','v','g','thetaPred','hingeGrad','edgeDir','edgeComp','edgeK','factorDir'])assert.deepEqual(a[key],b[key],key);
  assert.deepEqual(a.snapshot(),b.snapshot());assert.deepEqual(a.stats(),b.stats());
  assert.deepEqual(a.orthotropicMembrane.work,b.orthotropicMembrane.work);assert.deepEqual(a._pcg,b._pcg);
}

test('omitted and explicit historical reference keep exact World and observer shapes',()=>{
  const a=fixture(),b=fixture(OLD),oa=attachModalSolveObserver(a),ob=attachModalSolveObserver(b);
  assert.deepEqual(a.options,b.options);assert.deepEqual(a.parameters,b.parameters);
  assert.equal(Object.hasOwn(a.world.opts,'membraneReference'),false);
  assert.equal(Object.hasOwn(b.world.orthotropicMembrane.configuration,'reference'),false);
  for(let i=0;i<3;i++){
    assert.deepEqual(observeModalWorld(a,{step:i,initial:i===0}),observeModalWorld(b,{step:i,initial:i===0}));
    a.world.step(a.world.dt);b.world.step(b.world.dt);parity(a.world,b.world);
  }
  assert.deepEqual(oa.records,ob.records);assert.ok(oa.records.every(r=>!Object.hasOwn(r,'membraneReference')));
  oa.detach();ob.detach();
  assert.throws(()=>fixture('unknown'),/unsupported membrane reference/);
  assert.throws(()=>fixture(UV,'binary64'),/requires explicit double-double/);
  assert.throws(()=>runModalAudit({membraneReference:'unknown'}),/unknown membrane reference/);
  assert.throws(()=>runModalAudit({membraneReference:UV}),/requires explicit double-double/);
  console.log('modal-reference-default: omitted/explicit historical reference shapes and three-step replay exact; invalid selectors rejected before audit');
});

test('actual UV-law observer steps replay unchanged and bind distinct snapshot identity',()=>{
  const a=fixture(UV),b=fixture(UV),observer=attachModalSolveObserver(a);let previous;
  const identity=a.world.orthotropicMembrane.configuration.reference;
  assert.deepEqual(identity,reference);
  const actual=captureModalReference(a);assert.equal(actual.elements.length,a.world.mesh.nT);
  assert.ok(actual.elements.every(e=>e.reference.mode===UV));
  assert.ok(a.patch.world.orthotropicMembrane.elements.every(e=>e.reference===undefined),'fixture remains old; capture must come from selected World');
  const driftBase=fixture(UV);driftBase.world.orthotropicMembrane.elements[0].reference.x0[0]+=.1;assert.throws(()=>captureModalReference(driftBase),/base differs/);
  runModalContext(a,{steps:3,retain:'all',onObservation:o=>{
    const v=validateObservation(a,o,{world:a.world,previous,referenceMass:a.massProof.independentlyLumpedMass});
    assert.equal(v.valid,true,v.errors.join('; '));if(!o.initial)assert.equal(v.converged,o.literalForceGate);
    assert.equal(o.solver.membraneReference,UV);assert.deepEqual(o.solver.membraneReferenceIdentity,identity);
    assert.equal(o.forceTolerance,Math.max(1e-7,1e-10*a.forceScale));previous=o;
  }});
  runModalContext(b,{steps:3,retain:'initial-final'});parity(a.world,b.world);
  assert.equal(observer.records.length,12);assert.equal(observer.counts.missing,0);
  for(const r of observer.records){assert.equal(r.valid,true,r.missing.join('; '));assert.equal(r.membraneReference,UV);assert.deepEqual(r.membraneReferenceIdentity,identity);}
  observer.detach();
  const old=fixture(),before=old.world.snapshot();assert.throws(()=>old.world.restore(a.world.snapshot()),/snapshot.*mismatch/);assert.deepEqual(old.world.snapshot(),before);
  const saved=a.world.snapshot();assert.throws(()=>a.world.restore(before),/snapshot.*mismatch/);assert.deepEqual(a.world.snapshot(),saved);
  const drift=fixture(UV);drift.world.opts.membraneReference=OLD;assert.throws(()=>attachModalSolveObserver(drift),/membrane reference identity/);
  console.log('modal-reference-live: 12 actual Newton events, selected identity, live force validation and exact observer/plain replay; cross-law snapshots refused');
});

function report(mode){
  // Projection/mutation mocks only, never evidence of physical correctness.
  const uv=mode===UV,opts={lineSearchArithmetic:SEARCH,membraneArithmetic:DD,...(uv?{membraneReference:UV}:{})};
  const solver={newtonIterations:1,substeps:1,previousPoseStart:false,pcgMaxIterations:12,pcgRelativeTolerance:1e-3,
    lineSearchArithmetic:SEARCH,membraneArithmetic:DD,membraneArithmeticIdentity:arithmetic,...(uv?{membraneReference:UV,membraneReferenceIdentity:reference}:{})};
  const x=[0,0,0,1,0,0,0,0,-1],o={step:0,initial:true,h:1/60,time:0,x,xs:x,xt:x,v:Array(9).fill(0),rawSHA256:{x:'same'},
    displacement:[[0,0],[0,0],[0,0]],velocityUV:[[0,0],[0,0],[0,0]],forceScale:1,forceTolerance:1e-7,absoluteForceTolerance:1e-7,relativeForceTolerance:1e-10,
    modalMass:1,initialLinearModalEnergyScale:1,asleep:false,framesRun:0,substepsRun:0,execution:null,targetValid:false,planarExact:true,
    elasticEnergy:uv?0:1e-24,elasticGradient:[uv?0:1e-7,...Array(8).fill(0)],metric:{finite:true,reference:mode},rawImplicitEnergy:uv?0:1e-24,solver};
  const trace=[{step:0,forceTolerance:1e-7,solver},{step:1,residualInfinity:2e-7,forceTolerance:1e-7,literalForceGate:false,validation:{valid:true,converged:false},solver}];
  const t={...opts,level:1,budget:1,seed:false,amplitude:.004,substeps:1,steps:1,h:1/60,z:.08,fixedForceScale:1,forceTolerance:1e-7,
    modalMass:1,oracleModalMass:1,modalMassRelativeDifference:0,oracleModalMassRelativeDifference:0,initialReference:{independent:true},scales:{modalMass:1},options:opts,
    runtime:{schema:'runtime',parameters:opts,options:opts,h:1/60,requestedSteps:1,completedSteps:1,requestedHorizon:1/60,retentionPolicy:'explicit',
      massProof:{native:[1,1,1]},fixedInitialForceScale:1,forceTolerance:1e-7,modalMass:1,maximumModeNorm:1,sleepPolicy:{override:'none'},scope:'actual World'},
    snapshots:{initial:{observation:o,validation:{valid:true},stateFloat64LE:{x:'same'}}},trace,failedSteps:1,firstFailedStep:1,
    solveObservation:{enabled:true,trace:[]},gates:{literalForceEverySubstep:false,timeAccuracyAcceptance:false},classification:'force-failure',maxima:{state:.01}};
  return {schema:'pliego-membrane-modal-audit/0.1',source:{dirty:false,git:'a'.repeat(40)},runtime:{node:'same'},protocol:{...opts,instrument:true,limits:{force:1e-10}},
    oracleSelfTest:{result:{passed:true}},referenceCapture:{hash:'same'},gates:{sourceClean:true,oracleValid:true,completeDeclaredMatrix:true,literalForceEverySubstep:false,actualTimeAccuracyAcceptance:false},
    results:[{geometry:{cells:1,pattern:'forward',grain:0},vertices:[[0,0],[1,0],[0,1]],triangles:[[0,1,2]],material:{E1:1},mesh:{id:'same'},fixtureSHA256:'same',meshSHA256:'same',
      referenceCoefficients:{triangles:[[0,1,2]],elements:[{alpha:[-1,1,0],beta:[-1,0,1],Q:[1,1,0,1],volume:1,
        ...(uv?{reference:{mode:UV,version:1,u:[-1,1,0],v:[-1,0,1],x0:x,c:1,s:0}}:{})}],scope:'actual'},
      reference:{omega:1},scalarResponseProof:{pass:true},plan:{h:1/60},trajectories:[t]}]};
}
function comparison(a,b,extra=[]){
  const dir=mkdtempSync(join(tmpdir(),'pliego-reference-test-'));
  try{
    const x=join(dir,'a.json'),y=join(dir,'b.json'),out=join(dir,'out.json');writeFileSync(x,JSON.stringify(a));writeFileSync(y,JSON.stringify(b));
    const run=spawnSync(process.execPath,[join(bench,'compare-membrane-modal-audit.mjs'),'--reference-comparison',...extra,x,y,'--out',out],{encoding:'utf8'});
    return {status:run.status,error:run.stderr,result:run.status===0?JSON.parse(readFileSync(out,'utf8')):null};
  }finally{rmSync(dir,{recursive:true,force:true});}
}

test('named reference comparison fixes physical inputs but retains changed law/evaluation outcomes',()=>{
  const a=report(OLD),b=report(UV),r=comparison(a,b);assert.equal(r.status,0,r.error);assert.equal(r.result.mode,'reference-law');
  assert.equal(r.result.commonInputsExactlyEqual,true);assert.equal(r.result.outcomes[0][0].failedSteps,1);assert.equal(r.result.outcomes[1][0].failedSteps,1);
  assert.notDeepEqual(r.result.outcomes[0][0].initialEvaluation,r.result.outcomes[1][0].initialEvaluation);
  assert.notDeepEqual(r.result.outcomes[0][0].representedReferenceCoefficients,r.result.outcomes[1][0].representedReferenceCoefficients);
  assert.notEqual(comparison(a,b,['--membrane-arithmetic-comparison']).status,0);
  console.log('modal-reference-comparison: physical inputs exact, changed reference definitions/initial energy/gradient/metric retained, force failures preserved');
});

test('reference comparison rejects missing/mutated physics, actual reference and numeric force bindings',()=>{
  const mutations=[
    r=>{r.source.git='b'.repeat(40);},r=>{delete r.source;},r=>{r.results[0].material.E1=2;},
    r=>{r.results[0].vertices[0][0]=.5;},r=>{r.results[0].referenceCoefficients.elements[0].Q[0]=2;},
    r=>{delete r.results[0].referenceCoefficients.elements[0].reference;},r=>{r.results[0].referenceCoefficients.elements[0].reference.x0[0]=.5;},
    r=>{r.results[0].referenceCoefficients.elements[0].reference.c=.5;},r=>{r.results[0].referenceCoefficients.elements[0].reference.u[1]=2;},
    r=>{r.results[0].trajectories[0].runtime.massProof.native[0]=2;},r=>{r.results[0].trajectories[0].h=.1;},
    r=>{r.results[0].trajectories[0].forceTolerance=1;},r=>{r.results[0].trajectories[0].trace[1].literalForceGate=true;},
    r=>{r.results[0].trajectories[0].trace[1].step=2;},r=>{delete r.results[0].trajectories[0].options.membraneReference;},
    r=>{delete r.results[0].trajectories[0].snapshots.initial.observation.solver.membraneReferenceIdentity;},
    r=>{r.results[0].trajectories[0].trace[1].solver={};},r=>{r.protocol.membraneArithmetic='binary64';}];
  for(const change of mutations){const b=report(UV);change(b);const r=comparison(report(OLD),b);assert.notEqual(r.status,0,change.toString());}
  console.log('modal-reference-mutations: '+mutations.length+' missing/changed source, material, UV/base/rotation/operator, mass/time and force/selector corruptions refused');
});


test('reference CLI rejects missing/unknown values and unsupported combinations before source/oracle work',()=>{
  for(const args of [['--membrane-reference'],['--membrane-reference','unknown'],['--membrane-reference',UV]]){
    const run=spawnSync(process.execPath,[join(bench,'membrane-modal-audit.mjs'),...args],{encoding:'utf8'});
    assert.notEqual(run.status,0);assert.match(run.stderr,/membrane-reference needs a supported value|requires explicit double-double/);
    assert.doesNotMatch(run.stderr,/clean source required|oracle/);
  }
  console.log('modal-reference-cli: three malformed or unsupported selector combinations rejected before any oracle or simulation');
});
