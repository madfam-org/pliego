import test from 'node:test';
import assert from 'node:assert/strict';
import {modalScales,modalTruth,measureModalFields,compareModalStates,spectralInitialReference,spectralTruth,compareAmplitudeNormalizedStates} from '../bench/membrane-modal-metrics.mjs';

const config={vertices:[[0,0],[2,0],[0,2]],mass:[1,2,3],phi:[[1,0],[0,.5],[-.25,0]],omega:7,amplitude:.02};
function sample(step,h,kind='backwardEuler'){
  const scales=modalScales(config),t=modalTruth({...scales,step,h})[kind];
  return {step,h,time:step*h,x:config.vertices.flatMap(([u,v],i)=>[u+t.coordinate*config.phi[i][0],0,-v-t.coordinate*config.phi[i][1]]),
    v:config.phi.flatMap(([u,v])=>[u*t.velocity,0,-v*t.velocity]),elasticEnergy:.5*scales.modalMass*(config.omega*t.coordinate)**2};
}
test('modal truth matches independently iterated backward Euler and retains its energy decay',()=>{
  const s=modalScales(config),h=.03;let q=config.amplitude,v=0;
  for(let n=0;n<=100;n++){
    const exact=modalTruth({...s,h,step:n}).backwardEuler;
    assert.ok(Math.abs(q-exact.coordinate)<2e-16);assert.ok(Math.abs(v-exact.velocity)<2e-15);
    const e=.5*s.modalMass*(v*v+(config.omega*q)**2);
    assert.ok(Math.abs(e-exact.energy)/s.energy<3e-15);
    const next=(q+h*v)/(1+(config.omega*h)**2);v=(v-h*config.omega**2*q)/(1+(config.omega*h)**2);q=next;
  }
  const coarse=modalTruth({...s,h,step:100});assert.ok(coarse.backwardEuler.energy<coarse.continuous.energy);
  console.log('membrane-modal-truth: 101 independently iterated BE states/energy agree; continuous energy is separate from numerical damping');
});
test('full-field errors use fixed mass/modal scales at zero crossings and expose hidden modes',()=>{
  const a=sample(7,.01),m=measureModalFields(config,a);
  assert.ok(m.errors.backwardEuler.displacement<1e-13&&m.errors.backwardEuler.velocity<1e-13);
  assert.ok(m.errors.continuous.state>.001);
  const perturbed=structuredClone(a);perturbed.x[1]=.001;
  const out=measureModalFields(config,perturbed);assert.equal(out.coordinate,m.coordinate);
  assert.ok(out.errors.backwardEuler.displacement>.01&&out.displacementLeakage>.01);
  const zero=sample(1,Math.PI/(2*config.omega),'continuous'),z=measureModalFields(config,zero);
  assert.ok(z.errors.continuous.state<1e-13&&Number.isFinite(z.errors.continuous.displacement));
  const totalMass=config.mass.reduce((s,x)=>s+x,0),s=modalScales(config);
  assert.ok(Math.abs(s.modalMass-(1+2*.25+3*.0625))<1e-15);assert.equal(s.totalMass,totalMass);
  assert.equal(s.forceTolerance,Math.max(1e-7,1e-10*s.force));
  assert.ok(compareModalStates(config,a,perturbed).state>.01);
  assert.ok(compareAmplitudeNormalizedStates(config,a,perturbed,config.amplitude,config.amplitude).state>.01);
  const half=structuredClone(a);half.x=config.vertices.flatMap(([u,v],i)=>[u+(a.x[3*i]-u)/2,a.x[3*i+1]/2,-v+(a.x[3*i+2]+v)/2]);half.v=a.v.map(v=>v/2);
  assert.ok(compareAmplitudeNormalizedStates(config,a,half,config.amplitude,config.amplitude/2).state<1e-12);
  console.log('membrane-modal-fields: fixed mass-weighted denominators survive zero crossings; out-of-plane error cannot hide in unchanged modal projection');
});
test('modal metrics reject invalid normalization and distinguish unavailable phase',()=>{
  assert.throws(()=>modalScales({...config,phi:config.phi.map(p=>p.map(x=>x*2))}),/max-node/);
  assert.throws(()=>modalScales({...config,mass:[1,0,3]}),/positive/);
  const a=sample(0,.01);a.x=config.vertices.flatMap(([u,v])=>[u,0,-v]);a.v.fill(0);a.elasticEnergy=0;
  const m=measureModalFields(config,a);assert.equal(m.errors.continuous.phaseObservable,false);assert.equal(m.errors.continuous.phaseCycles,null);
  assert.ok(m.errors.continuous.displacement>.9);assert.throws(()=>measureModalFields(config,{...a,x:[NaN]}),/finite/);
  console.log('membrane-modal-domain: invalid fields/mass/mode normalization rejected; lost mode amplitude is an unavailable phase, never a zero phase error');
});
test('complete spectral control propagates actual rounded initial translation and oscillation separately',()=>{
  const r=Math.SQRT1_2,vertices=[[0,0],[2,0]],mass=[1,1];
  const spectrum={eigenvalues:[-1e-16,0,1e-16,9],nullIndices:[0,1,2],massNormalizedModes:[[[r,0],[r,0]],[[0,r],[0,r]],[[0,-r],[0,r]],[[r,0],[-r,0]]]};
  const initial={x:[.004,0,0,1.998,0,0],v:[0,0,0,0,0,0]},ref=spectralInitialReference({vertices,mass,spectrum},initial);
  assert.ok(ref.reconstructionRelativeError<1e-15);assert.deepEqual(ref.eigenvalues,spectrum.eigenvalues);
  let q=(initial.x[0]-(initial.x[3]-2))/2,v=0;const translation=(initial.x[0]+initial.x[3]-2)/2,h=.1;
  for(let step=0;step<=100;step++){
    const truth=spectralTruth(ref,{h,step});
    assert.ok(Math.abs(truth.backwardEuler.displacement[0][0]-(translation+q))<2e-16);
    assert.ok(Math.abs(truth.backwardEuler.displacement[1][0]-(translation-q))<2e-16);
    assert.ok(Math.abs(truth.backwardEuler.velocity[0][0]-v)<2e-16);
    const next=(q+h*v)/(1+9*h*h);v=(v-9*h*q)/(1+9*h*h);q=next;
  }
  assert.throws(()=>spectralInitialReference({vertices,mass,spectrum},{...initial,v:[1,0,0,0,0,0]}),/zero initial/);
  const bad=structuredClone(spectrum);bad.massNormalizedModes[3][0][0]*=2;
  assert.throws(()=>spectralInitialReference({vertices,mass,spectrum:bad},initial),/orthogonality/);
  console.log('membrane-modal-spectral: actual rounded u0 reconstructed; rigid translation retained and independent axial recurrence matches 101 full-field discrete states; invalid basis/velocity rejected');
});
