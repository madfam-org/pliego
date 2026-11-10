import test from 'node:test';
import assert from 'node:assert/strict';
import {measureStateModalFields,measurePublicStateModalFields,compareStateModalStates,modalScales,spectralStateInitialReference,spectralTruth} from '../bench/membrane-state-modal-metrics.mjs';
const config={vertices:[[40,0]],mass:[1],phi:[[1,0]],omega:100,amplitude:.004};
const sample=(u,v=[0,0,0])=>({step:0,h:.001,time:0,x:[40,0,0],v,elasticEnergy:0,authoritative:{u,v,elasticEnergy:0}});

test('direct-u metrics distinguish latent states with the same projected public coordinates',()=>{
  const a=sample([2**-60,0,0]),b=sample([2**-59,0,0]),ma=measureStateModalFields(config,a),mb=measureStateModalFields(config,b);
  assert.notEqual(ma.coordinate,mb.coordinate);assert.deepEqual(a.x,b.x);
  assert.equal(measurePublicStateModalFields(config,a).coordinate,0);assert.equal(measurePublicStateModalFields(config,b).coordinate,0);
  assert.ok(compareStateModalStates(config,a,b).state>0);assert.equal(ma.coordinateSystem,'authoritative-reference-displacement');
  assert.match(ma.referenceMeaning,/not selected-law\/native-C/);
  assert.throws(()=>measureStateModalFields(config,{...a,authoritative:undefined}),/authoritative/);
  console.log('state-modal-metrics-authority: identical public x retains distinct small-u fields; no absolute readdition/subtraction or inferred coordinates');
});

test('full3D leakage, actual velocity and fixed initial denominators survive zero crossings',()=>{
  const s=modalScales(config),planar=sample([0,0,0],[-.4,0,0]),outside=sample([0,.001,0],[-.4,.002,0]);
  const a=measureStateModalFields(config,planar),b=measureStateModalFields(config,outside);
  assert.deepEqual(a.scales,b.scales);assert.equal(a.scales.displacement,s.displacement);assert.equal(a.scales.velocity,s.velocity);
  assert.ok(Number.isFinite(a.errors.continuous.state));assert.ok(b.displacementLeakage>0);assert.ok(b.velocityLeakage>0);
  assert.ok(b.errors.continuous.state>a.errors.continuous.state);assert.equal(b.kinetic,.5*(.4**2+.002**2));
  assert.equal(measurePublicStateModalFields(config,outside).kinetic,b.kinetic);
  console.log('state-modal-metrics-fields: out-of-plane displacement/velocity visible, fixed scales at zero crossing, public diagnostic uses actual authoritative velocity');
});


test('independent full spectrum propagates actual small-u translation and other-mode leakage without public rounding',()=>{
  const r=Math.SQRT1_2,vertices=[[40,0],[42,0]],mass=[1,1];
  const spectrum={eigenvalues:[-1e-16,0,1e-16,9],nullIndices:[0,1,2],massNormalizedModes:[[[r,0],[r,0]],[[0,r],[0,r]],[[0,-r],[0,r]],[[r,0],[-r,0]]]};
  const u=[2**-60,0,0,-(2**-61),0,0],initial={authoritative:{u,v:Array(6).fill(0)}};
  const reference=spectralStateInitialReference({vertices,mass,spectrum},initial);
  assert.ok(reference.reconstructionRelativeError<1e-15);assert.deepEqual(reference.eigenvalues,spectrum.eigenvalues);
  const translation=(u[0]+u[3])/2,h=.1;let q=(u[0]-u[3])/2,v=0;
  for(let step=0;step<=100;step++){
    const t=spectralTruth(reference,{h,step}).backwardEuler;
    assert.ok(Math.abs(t.displacement[0][0]-(translation+q))<1e-32);assert.ok(Math.abs(t.displacement[1][0]-(translation-q))<1e-32);
    assert.ok(Math.abs(t.velocity[0][0]-v)<1e-32);
    const next=(q+h*v)/(1+9*h*h);v=(v-9*h*q)/(1+9*h*h);q=next;
  }
  assert.throws(()=>spectralStateInitialReference({vertices,mass,spectrum},{authoritative:{u,v:[1,0,0,0,0,0]}}),/zero initial/);
  const bad=structuredClone(spectrum);bad.massNormalizedModes[3][0][0]*=2;
  assert.throws(()=>spectralStateInitialReference({vertices,mass,spectrum:bad},initial),/orthogonality/);
  console.log('state-modal-spectral: small authoritative u0 retained despite unchanged absolute projection; complete basis/null leakage and101 independently iterated BE states; physical CST comparator meaning explicit');
});
