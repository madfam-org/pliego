import test from 'node:test';
import assert from 'node:assert/strict';
import {makePatch} from '../bench/membrane-patch.mjs';
import {loadStateModalInputs} from '../bench/membrane-state-modal-inputs.mjs';
import {createModalWorld} from '../bench/membrane-modal-runtime.mjs';
import {createStateModalWorld,observeStateModalWorld,runStateModalContext} from '../bench/membrane-state-modal-runtime.mjs';

function fixture(extra={}){
  const patch=makePatch({cells:2,grain:0,membraneModel:'orthotropic-stvk',membraneNu12:.293});
  const parameters={phi:patch.vertices.map((_,i)=>[Math.sin(i+.2),Math.cos(i+.2)]),omega:1e5,amplitude:.004,substeps:4000,newtonIterations:4,...extra};
  return {patch,parameters,context:createStateModalWorld(patch,parameters)};
}
const caches=w=>({snapshot:w.snapshot(),work:structuredClone(w.orthotropicMembrane.work),block:w.orthotropicMembrane.block.slice(),thetaPred:w.thetaPred.slice(),hingeGrad:w.hingeGrad.slice(),edgeDir:w.edgeDir.slice(),edgeComp:w.edgeComp.slice(),edgeK:w.edgeK.slice()});

test('state modal factory converts the actual historical pose once and preserves original constructor targets',()=>{
  const {patch,parameters,context:c}=fixture(),old=createModalWorld(patch,{...parameters,membraneReference:'uv-displacement',membraneArithmetic:'double-double',lineSearchArithmetic:'membrane-inertia-increment'});
  assert.deepEqual(c.world.x,old.world.x);assert.deepEqual(c.world.v,old.world.v);assert.deepEqual(c.world.xs,old.world.xs);assert.deepEqual(c.world.xt,old.world.xt);
  assert.equal(c.world.substepsRun,0);assert.equal(c.world.factorCount,0);assert.equal(c.initialization.physicalSolvesExecuted,0);
  const o=observeStateModalWorld(c);assert.equal(o.measurementValid,true,o.errors.join(';'));assert.equal(o.targetValid,false);assert.equal(o.literalForceGate,null);assert.equal(o.authoritative.converged,null);
  assert.ok(o.authoritative.initialU.every((u,i)=>Object.is(c.world.X0[i]+u,c.world.x[i])));
  assert.equal(o.stateSHA256.x,c.initialBinding.stateSHA256.x);assert.equal(o.authoritative.identity.mode,'reference-displacement');
  for(const args of [{stateCoordinates:'absolute-position'},{membraneReference:'material-coefficients'},{membraneArithmetic:'binary64'},{lineSearchArithmetic:'total-energy'},{sleep:false}])assert.throws(()=>createStateModalWorld(patch,{...parameters,...args}));
  const zeroPhi=patch.vertices.map(([u])=>[(u-20)/20,0]);assert.throws(()=>createStateModalWorld(patch,{...parameters,phi:zeroPhi}),/projection changes public bytes/);
  console.log('state-modal-initialization: actual old native x/v, untouched zero xs/xt, exact conversion; signed-zero-incompatible synthetic fixture visibly refused');
});

test('both starts obey direct-u native prediction/velocity while public difference identities remain diagnostic',()=>{
  let publicDifferenceFailures=0;
  for(const previousPoseStart of [false,true]){
    const {context:c}=fixture({previousPoseStart}),r=runStateModalContext(c,{steps:4});
    assert.equal(r.status,'completed');assert.equal(r.gates.measurementValid,true);assert.equal(r.gates.exactActualSubstepCounters,true);
    let previous=r.initial;
    for(const o of r.observations.slice(1)){
      assert.equal(o.targetValid,true);assert.deepEqual(o.authoritative.us,previous.authoritative.u);
      for(let i=0;i<o.v.length;i++){
        assert.ok(Object.is(o.authoritative.ut[i],previous.authoritative.u[i]+o.h*previous.v[i]));
        assert.ok(Object.is(o.v[i],(o.authoritative.u[i]-o.authoritative.us[i])/o.h));
        assert.ok(Object.is(o.x[i],o.authoritative.x0[i]+o.authoritative.u[i]));
        const coefficient=c.masses[Math.floor(i/3)]*(1/(o.h*o.h));
        assert.ok(Object.is(o.authoritative.residual[i],o.authoritative.elasticGradient[i]+coefficient*(o.authoritative.u[i]-o.authoritative.ut[i])));
        assert.ok(Object.is(o.residual[i],o.elasticGradient[i]+coefficient*(o.x[i]-o.xt[i])));
      }
      assert.equal(o.authoritative.converged,o.authoritative.residualInfinity<=c.forceTolerance);assert.equal(o.literalForceGate,o.residualInfinity<=c.forceTolerance);
      publicDifferenceFailures+=Number(!o.execution.velocityMatchesActualDifference||!o.execution.xtMatchesActualPredictor);
      assert.equal(o.forceScale,r.fixedInitialForceScale);assert.equal(o.forceTolerance,Math.max(1e-7,1e-10*r.fixedInitialForceScale));previous=o;
    }
  }
  assert.ok(publicDifferenceFailures>0);
  console.log('state-modal-execution: both starts, multiple nonzero-velocity steps, literal native latent/public equations; false public-difference identities are retained diagnostics');
});

test('boundary observer clones all mutable scratch and callbacks cannot alter actual replay',()=>{
  const {patch,parameters,context:c}=fixture(),plain=createStateModalWorld(patch,parameters);
  for(let step=0;step<4;step++){
    if(step){c.world.step(c.world.dt);plain.world.step(plain.world.dt);}
    const before=caches(c.world);observeStateModalWorld(c,{step,initial:step===0});assert.deepEqual(caches(c.world),before);assert.deepEqual(c.world.snapshot(),plain.world.snapshot());
  }
  const a=fixture().context,b=fixture().context;
  const all=runStateModalContext(a,{steps:3}),stream=runStateModalContext(b,{steps:3,retain:'initial-final',onObservation:o=>{o.authoritative.u[0]=99;o.x[0]=99;},checkpoints:[1,3]});
  assert.deepEqual(a.world.snapshot(),b.world.snapshot());assert.deepEqual(stream.final,all.final);assert.equal(stream.observedCount,4);assert.equal(stream.retainedCount,2);assert.deepEqual(Object.keys(stream.checkpoints),['1','3']);
  assert.throws(()=>runStateModalContext(a,{steps:1}),/unstepped/);
  console.log('state-modal-transparency: live force/factor/element scratch unchanged; plain, all/stream and copied callbacks replay exactly');
});

test('failed or sleeping public calls preserve raw incomplete evidence and cannot inherit a successful target',()=>{
  const c=fixture().context;c.world.step=()=>{c.world._u[0]+=.001;c.world.x[0]=c.world.X0[0]+c.world._u[0];throw new Error('injected before completion');};
  const r=runStateModalContext(c,{steps:3});assert.equal(r.status,'world-step-exception');assert.equal(r.completedSteps,0);assert.equal(r.observedCount,2);
  assert.equal(r.final.targetValid,false);assert.equal(r.final.literalForceGate,null);assert.equal(r.final.authoritative.converged,null);assert.equal(r.final.authoritative.u[0],c.world._u[0]);assert.equal(r.final.measurementValid,false);
  const sleeper=fixture().context;sleeper.world._asleep=true;const sleep=runStateModalContext(sleeper,{steps:2});
  assert.equal(sleep.status,'sleep-censored');assert.equal(sleep.completedSteps,0);assert.equal(sleep.final.literalForceGate,null);assert.equal(sleep.final.authoritative.converged,null);assert.equal(sleep.gates.noSleep,false);
  const direct=fixture().context;direct.world.step(direct.world.dt);const o=observeStateModalWorld(direct,{step:1});assert.equal(o.literalForceGate,null);assert.equal(o.authoritative.converged,null);
  console.log('state-modal-failures: exception/sleep censoring retains partial raw buffers, no completed-target certificate; direct observations without execution receipt have null gates');
});


test('all24 archived matrix initial states convert exactly with unchanged native reference/M/h/F0/budgets',()=>{
  const input=loadStateModalInputs(),patch=makePatch({...input.geometry,membraneModel:'orthotropic-stvk',membraneNu12:input.material.nu12});
  assert.deepEqual(patch.material,input.material);
  for(const row of input.rows){
    const {steps:_steps,retain:_retain,...parameters}=row.runtime.parameters;
    const c=createStateModalWorld(patch,parameters),o=observeStateModalWorld(c);
    assert.equal(o.measurementValid,true,o.errors.join(';'));assert.equal(c.forceScale,row.fixedForceScale);assert.equal(c.forceTolerance,row.forceTolerance);assert.equal(c.world.dt,row.h);
    assert.equal(c.world.opts.newtonIterations,row.budget);assert.equal(c.world.opts.previousPoseStart,row.seed);
    for(const key of ['x','xs','xt','v'])assert.equal(o.stateFloat64LE[key],row.initial.stateFloat64LE[key]);
    assert.deepEqual(c.masses,row.runtime.massProof.native);assert.deepEqual(c.referenceWords,input.referenceWords);
    assert.equal(c.world.substepsRun,0);assert.equal(c.world.factorCount,0);assert.equal(o.targetValid,false);assert.equal(o.literalForceGate,null);assert.equal(o.authoritative.converged,null);
  }
  console.log('state-modal24-initials: every archived x/xs/xt/v byte, actual mass/reference/h/F0/budget/start unchanged across24 unstepped contexts; no ideal initialization or solver call');
});


test('live solver-policy mismatch is refused before any public solve and incomplete matrices cannot pass vacuously',()=>{
  for(const [key,value]of [['newtonIterations',1],['previousPoseStart',true],['substeps',8000]]){
    const c=fixture().context;c.world.opts[key]=value;let calls=0;const original=c.world.step;
    c.world.step=function(...args){calls++;return original.apply(this,args);};
    const r=runStateModalContext(c,{steps:2});assert.equal(r.status,'invalid-initial-observation');assert.equal(calls,0);assert.equal(r.completedSteps,0);assert.equal(r.final.measurementValid,false);
    assert.equal(r.gates.literalFinalForceEverySubstep,false);assert.equal(r.gates.authoritativeFinalForceEverySubstep,false);
  }
  const c=fixture().context;let calls=0;const original=c.world.step;c.world.step=function(...args){calls++;return original.apply(this,args);};
  const r=runStateModalContext(c,{steps:2,onObservation:o=>{if(o.step===1)c.world.opts.newtonIterations=1;}});
  assert.equal(calls,1);assert.equal(r.completedSteps,1);assert.equal(r.status,'world-step-exception');assert.equal(r.final.targetValid,false);assert.equal(r.final.literalForceGate,null);
  console.log('state-modal-policy: live budget/start/substep drift refused before stepping; callback-time drift censored before next solve; no empty/partial green force gate');
});

test('actual native transition to sleep nulls certification on the completed sleeping step',()=>{
  const c=fixture({amplitude:1e-20}).context,r=runStateModalContext(c,{steps:40});
  assert.equal(r.status,'sleep-censored');assert.ok(r.completedSteps>0&&r.completedSteps<40);assert.equal(r.final.execution.actualSubstepExecuted,true);assert.equal(r.final.asleep,true);
  assert.equal(r.final.targetValid,false);assert.equal(r.final.literalForceGate,null);assert.equal(r.final.authoritative.converged,null);assert.equal(r.final.measurementValid,false);
  assert.ok(r.final.forceFloat64LE.publicResidual);assert.ok(r.final.forceFloat64LE.authoritativeResidual);
  assert.equal(r.gates.literalFinalForceEverySubstep,false);assert.equal(r.gates.authoritativeFinalForceEverySubstep,false);
  console.log('state-modal-sleep-transition: native tiny-amplitude control crosses sleep after real completed calls; raw force tuples preserved, both certified flags null and measurement censored');
});


test('observation step labels cannot replace the actual public call counters',()=>{
  const c=fixture().context,r=runStateModalContext(c,{steps:1});
  const forged=observeStateModalWorld(c,{step:100,initial:false,execution:r.final.execution});
  assert.equal(forged.measurementValid,false);assert.equal(forged.targetValid,false);assert.equal(forged.literalForceGate,null);assert.equal(forged.authoritative.converged,null);
  const initial=observeStateModalWorld(fixture().context,{step:0,initial:false,execution:r.final.execution});
  assert.equal(initial.measurementValid,false);assert.equal(initial.targetValid,false);
  console.log('state-modal-index: forged100th-step receipt and falseinitiallabel cannot certify one actual call or constructor state');
});


test('initial signed native words are anchored and invalid NaN payload bytes remain lossless',()=>{
  for(const key of ['v','_us','_ut']){
    const c=fixture().context;c.world[key][1]=-0;const o=observeStateModalWorld(c);
    assert.equal(o.measurementValid,false);assert.match(o.errors.join(';'),/initial native-word/);
    const r=runStateModalContext(c,{steps:2});assert.equal(r.completedSteps,0);
  }
  const c=fixture().context,word=0x7ff8000000000123n;
  new DataView(c.world._u.buffer,c.world._u.byteOffset,c.world._u.byteLength).setBigUint64(0,word,true);
  const o=observeStateModalWorld(c);assert.equal(o.measurementValid,false);assert.equal(o.literalForceGate,null);
  assert.equal(Buffer.from(o.stateFloat64LE.u,'base64').readBigUInt64LE(0),word);
  assert.equal(new DataView(c.world._u.buffer).getBigUint64(0,true),word);
  console.log('state-modal-native-words: initial v/us/ut signed-zero changes refused; invalid NaN payload0x123 retained exactly without arithmetic canonicalization or repair');
});

test('callback changes to actual native boundary inputs are refused before the next solve',()=>{
  for(const mutateAt of [0,1]){
    const c=fixture().context,original=c.world.step;let calls=0;
    c.world.step=function(...args){calls++;return original.apply(this,args);};
    const r=runStateModalContext(c,{steps:3,onObservation:o=>{if(o.step===mutateAt)c.world.v[0]=1;}});
    assert.equal(calls,mutateAt);assert.equal(r.completedSteps,mutateAt);assert.equal(r.status,'world-step-exception');
    assert.match(r.error.message,/native boundary input changed/);assert.equal(r.gates.measurementValid,false);
    assert.equal(r.gates.literalFinalForceEverySubstep,false);assert.equal(r.gates.authoritativeFinalForceEverySubstep,false);
  }
  console.log('state-modal-callback-input: initial and later native word changes censored before the next actual physics call; no stale boundary certificate');
});
