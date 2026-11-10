import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../src/index.js';
import { OrthotropicMembrane, createOrthotropicElement, evaluateOrthotropicElement } from '../src/xpbd/orthotropic-membrane.js';
import { gradient } from '../src/xpbd/implicit.js';
import { hessianTimes } from '../src/xpbd/pcg.js';
import { accurateTrialTerms } from '../src/xpbd/accurate-membrane.js';
import { makePatch } from '../bench/membrane-patch.mjs';

const norm = a => Math.hypot(...a);
function world(mode='double-double') {
  const patch=makePatch({cells:2,grain:0,membraneModel:'orthotropic-stvk',membraneNu12:.293});
  return new World(patch.doc,{...patch.options,damping:0,bendDamping:0,substeps:4000,newtonIterations:4,
    lineSearchArithmetic:'membrane-inertia-increment',membraneArithmetic:mode});
}
function fullGradient(w) {
  const g=new Float64Array(w.x.length);gradient(w,w.x,g);const idt2=1/(w.dt*w.dt);
  for(let i=0;i<g.length;i++)g[i]+=w.mass[Math.floor(i/3)]*idt2*(w.x[i]-w.xt[i]);return g;
}

test('two-word element derivative and exact/GN Hessian retain finite-deformation objectivity, stress curvature and step-halving accuracy',()=>{
  const material={E1:5.5e9,E2:2.5e9,G12:1.43e9,thickness:.1},uv=[0,0,2,.2,.3,1.5];
  const e=createOrthotropicElement(uv,material,.37,.293),x=Float64Array.of(0,0,0,2.1,.1,-.2,.32,-.08,-1.46);
  const base=evaluateOrthotropicElement(e,x,{arithmetic:'double-double'});
  let old=Infinity,cases=0;
  for(const h of [1e-3,5e-4,2.5e-4,1.25e-4]) {
    const g=new Float64Array(9),H=new Float64Array(81);
    for(let j=0;j<9;j++) {
      const a=x.slice(),b=x.slice();a[j]+=h;b[j]-=h;
      const p=evaluateOrthotropicElement(e,a,{arithmetic:'double-double'}),m=evaluateOrthotropicElement(e,b,{arithmetic:'double-double'});
      g[j]=(p.energy-m.energy)/(2*h);for(let i=0;i<9;i++)H[9*i+j]=(p.gradient[i]-m.gradient[i])/(2*h);
    }
    const error=norm(H.map((v,i)=>v-base.hessian[i]))/norm(base.hessian);
    assert.ok(error<.3*old+1e-10);old=error;assert.ok(norm(g.map((v,i)=>v-base.gradient[i]))/norm(base.gradient)<1e-4);cases++;
  }
  assert.ok(old<1e-8);
  const moved=Float64Array.from([0,1,2].flatMap(i=>[x[3*i+2]+2,x[3*i]-1,x[3*i+1]+4]));
  const rotated=evaluateOrthotropicElement(e,moved,{arithmetic:'double-double'});
  assert.ok(Math.abs(rotated.energy-base.energy)/base.energy<1e-13);
  const expected=Float64Array.from([0,1,2].flatMap(i=>[base.gradient[3*i+2],base.gradient[3*i],base.gradient[3*i+1]]));
  assert.ok(norm(rotated.gradient.map((v,i)=>v-expected[i]))/norm(expected)<1e-13);
  const normal=Float64Array.of(0,0,0,0,1,0,0,0,0),flat=createOrthotropicElement([0,0,1,0,0,1],material,0,.293);
  const compressed=evaluateOrthotropicElement(flat,Float64Array.of(0,0,0,.8,0,0,0,0,-.8),{arithmetic:'double-double'});
  assert.ok(compressed.hessian[40]<0);assert.equal(compressed.gaussNewton[40],0);assert.equal(normal[4],1);
  console.log(`double-double-element: ${cases} derivative halvings, finest exact-H error=${old}; represented finite rotation/translation; compressive stress curvature retained, GN distinct`);
});

test('native sparse and matrix-free DD GN agree with fixed/free masks; all stored material/reference coefficients remain identical',()=>{
  const w=world(),plain=world('binary64');
  assert.deepEqual(w.orthotropicMembrane.elements,plain.orthotropicMembrane.elements);
  for(let i=0;i<w.mesh.nV;i++){w.x[3*i]*=1.001;w.x[3*i+2]*=.9997;}
  const p=w.x.map((_,i)=>Math.sin(i+.37));
  for(const fixed of [false,true]) {
    const mask=w.invMass.slice();if(fixed)mask[0]=0;
    const direction=p.slice();if(fixed)direction.fill(0,0,3);
    const out=new Float64Array(p.length);w.orthotropicMembrane.addGaussNewtonTimes(w.x,direction,out,mask);
    const matrix=new Float64Array(p.length),ch=w.sys.ch;
    ch.clear();w.orthotropicMembrane.addGaussNewtonBlocks(w,w.x,ch);
    for(let c=0;c<ch.n;c++)for(let k=ch.Ap[c];k<ch.Ap[c+1];k++){
      const r=ch.Ai[k],i=ch.perm[r],j=ch.perm[c];
      for(let a=0;a<3;a++)for(let b=0;b<3;b++){
        matrix[3*i+a]+=ch.Ax[9*k+3*a+b]*direction[3*j+b];if(i!==j)matrix[3*j+b]+=ch.Ax[9*k+3*a+b]*direction[3*i+a];
      }
    }
    if(fixed)matrix.fill(0,0,3);
    const error=norm(out.map((v,i)=>v-matrix[i]))/norm(out);assert.ok(error<1e-12,`${error}`);
  }
  const all=new Float64Array(p.length);hessianTimes(w,w.x,p,all);assert.ok(all.every(Number.isFinite));
  console.log('double-double-GN: actual sparse/matrix-free triangle operators agree for free/masked inputs; reference UV, Q, volume and coefficients unchanged');
});

test('retained actual case49 meets the predeclared slope-error gate and backtracks its real-increase candidate',()=>{
  const root=new URL('../../../docs/research/evidence/membrane-increment-2026-11-10/',import.meta.url);
  const input=JSON.parse(readFileSync(new URL('captured-trials-input.json',root))).cases[49];
  const truth=JSON.parse(readFileSync(new URL('captured-trials-100.json',root))).cases[49];
  let prior;
  for(const mode of ['binary64','double-double']) {
    const w=world(mode);w.opts.substeps=Math.round(1/(60*input.h));w.dt=input.h;
    w.x.set(input.before);w.xs.set(input.before);w.xt.set(input.xt);assert.deepEqual(Array.from(w.mass),input.mass);
    const g=fullGradient(w);
    if(mode==='binary64')assert.deepEqual(Array.from(g),input.gradient);
    const terms=mode==='double-double'?accurateTrialTerms(w,w.x,Float64Array.from(input.after),g):null;
    w.energySearch.begin(w);w.x.set(input.after);w.energySearch.finish(w,g);
    if(mode==='binary64'){assert.equal(w.energySearch.increment.last.alpha,1);prior=w.energySearch.increment.last;}
    else {
      const error=Math.abs(terms.slope-truth.meanings.storedCoefficientPolynomial.realGradientSlopeNJ);
      assert.ok(error<=1e-27);assert.ok(prior.delta<0&&truth.meanings.storedCoefficientPolynomial.potentialDeltaNJ>0);
      assert.equal(w.energySearch.increment.last.decision,'accepted');assert.ok(w.energySearch.increment.last.trials>1);
      assert.ok(w.energySearch.increment.last.delta<0);assert.equal(w.energySearch.increment.last.displacementArithmetic,'two-diff');
      console.log(`double-double-frozen49: native baseline g exact; slope error=${error}nJ <=1e-27; old real-increase alpha1 candidate now backtracks to ${w.energySearch.increment.last.alpha}; no time/force convergence claim`);
    }
  }
});

test('endpoint TwoDiff lows survive large inexact subtractions instead of changing the polynomial increment',()=>{
  const mesh={nV:3,nT:1,tris:Int32Array.of(0,1,2),triSheet:Int32Array.of(0),uv:Float64Array.of(0,0,1,0,0,1)};
  const m=new OrthotropicMembrane(mesh,[{Emd:8,Ecd:8,G12:4,t:1}],{sheets:[{grainDeg:0}]},[0],'double-double');
  const before=Float64Array.of(1,0,0,.5,0,1,.5,0,-1),after=before.slice();after[0]=2**-54;
  assert.equal(after[0]-before[0],-1);
  const result=m.energyDifferenceDetails(before,after);assert.equal(result.valid,true);assert.ok(result.difference>0);
  assert.ok(Math.abs(result.difference-2**-54)<1e-30);
  console.log(`double-double-TwoDiff: rounded displacement loses 2^-54 but stable real-endpoint increment=${result.difference}nJ retains it; algebra-only endpoint control`);
});

test('DD identity drift refuses snapshot restore atomically and unsupported arithmetic ranges stay explicit',()=>{
  const source=world(),snapshot=source.snapshot();
  for(const mutate of [w=>{w.opts.membraneArithmetic='binary64';},w=>{w.orthotropicMembrane.work.arithmetic='binary64';},w=>{w.orthotropicMembrane.configuration.arithmetic.version=9;}]) {
    const w=world();w.x[0]=.123;mutate(w);const x=w.x.slice(),t=w.time,count=w.factorCount;
    assert.throws(()=>w.restore(snapshot),/arithmetic identity/i);assert.deepEqual(w.x,x);assert.equal(w.time,t);assert.equal(w.factorCount,count);
  }
  const tiny=createOrthotropicElement([0,0,1,0,0,1],{E1:8,E2:8,G12:4,thickness:2*Number.MIN_VALUE},0,0);
  assert.throws(()=>evaluateOrthotropicElement(tiny,Float64Array.of(0,0,0,1.1,0,0,0,0,-1),{arithmetic:'double-double'}),/operand outside/);
  const w=world();w.orthotropicMembrane.elements[0].volume=2**-451;const metric=w.orthotropicMembrane.diagnostics(w.x);assert.equal(metric.finite,false);assert.match(metric.arithmeticError,/operand outside/);
  assert.throws(()=>w.energySearch.begin(w),/operand outside/);
  console.log('double-double-safety: opts/work/config drift rejects before restore writes; subnormal volume and unsupported coordinate arithmetic report guarded range errors');
});
